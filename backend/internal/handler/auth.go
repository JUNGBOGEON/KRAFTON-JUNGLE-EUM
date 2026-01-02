package handler

import (
	"context"
	"regexp"
	"time"

	"github.com/gofiber/fiber/v2"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"realtime-backend/internal/auth"
	"realtime-backend/internal/model"
)

var (
	// 이메일 검증 정규식
	emailRegex = regexp.MustCompile(`^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`)
	// 닉네임 검증 (2-50자, 특수문자 제한)
	nicknameRegex = regexp.MustCompile(`^[a-zA-Z0-9가-힣\s]{2,50}$`)
)

// validateEmail 이메일 검증
func validateEmail(email string) bool {
	if len(email) < 5 || len(email) > 255 {
		return false
	}
	return emailRegex.MatchString(email)
}

// validateNickname 닉네임 검증
func validateNickname(nickname string) bool {
	if len(nickname) < 2 || len(nickname) > 50 {
		return false
	}
	return nicknameRegex.MatchString(nickname)
}

// sanitizeString XSS 방지를 위한 문자열 정제
func sanitizeString(s string) string {
	// HTML 태그 제거
	re := regexp.MustCompile(`<[^>]*>`)
	return re.ReplaceAllString(s, "")
}

// AuthHandler 인증 핸들러
type AuthHandler struct {
	db           *gorm.DB
	jwtManager   *auth.JWTManager
	googleAuth   *auth.GoogleAuthenticator
	secureCookie bool
}

// NewAuthHandler AuthHandler 생성
func NewAuthHandler(db *gorm.DB, jwtManager *auth.JWTManager, googleAuth *auth.GoogleAuthenticator, secureCookie bool) *AuthHandler {
	return &AuthHandler{
		db:           db,
		jwtManager:   jwtManager,
		googleAuth:   googleAuth,
		secureCookie: secureCookie,
	}
}

// GoogleLoginRequest Google 로그인 요청
type GoogleLoginRequest struct {
	IDToken string `json:"id_token"`
}

// AuthResponse 인증 응답
type AuthResponse struct {
	User      UserResponse `json:"user"`
	ExpiresIn int64        `json:"expires_in"`
}

// UserResponse 사용자 응답
type UserResponse struct {
	ID         int64   `json:"id"`
	Email      string  `json:"email"`
	Nickname   string  `json:"nickname"`
	ProfileImg *string `json:"profile_img,omitempty"`
	Provider   *string `json:"provider,omitempty"`
}

// GoogleLogin Google OAuth 로그인
func (h *AuthHandler) GoogleLogin(c *fiber.Ctx) error {
	var req GoogleLoginRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid request body",
		})
	}

	if req.IDToken == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "id_token is required",
		})
	}

	// Google ID Token 검증
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	googleUser, err := h.googleAuth.VerifyIDToken(ctx, req.IDToken)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "invalid google token",
		})
	}

	// 입력값 검증
	if !validateEmail(googleUser.Email) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid email format",
		})
	}

	// 닉네임 정제 및 검증
	sanitizedName := sanitizeString(googleUser.Name)
	if !validateNickname(sanitizedName) {
		// 닉네임이 유효하지 않으면 이메일 앞부분 사용
		sanitizedName = googleUser.Email[:min(len(googleUser.Email), 20)]
	}

	// 사용자 조회 또는 생성 (Race condition 방지를 위해 Upsert 사용)
	provider := "google"
	var user model.User

	// 트랜잭션으로 원자적 처리
	err = h.db.Transaction(func(tx *gorm.DB) error {
		// 먼저 기존 사용자 조회
		result := tx.Where("email = ?", googleUser.Email).First(&user)

		if result.Error == gorm.ErrRecordNotFound {
			// 신규 사용자 생성 (ON CONFLICT로 중복 방지)
			user = model.User{
				Email:      googleUser.Email,
				Nickname:   sanitizedName,
				ProfileImg: &googleUser.Picture,
				Provider:   &provider,
				ProviderID: &googleUser.ID,
			}
			if err := tx.Clauses(clause.OnConflict{
				Columns:   []clause.Column{{Name: "email"}},
				DoUpdates: clause.AssignmentColumns([]string{"profile_img", "provider", "provider_id"}),
			}).Create(&user).Error; err != nil {
				return err
			}

			// Upsert 후 최신 데이터 다시 조회 (ID 확보)
			if err := tx.Where("email = ?", googleUser.Email).First(&user).Error; err != nil {
				return err
			}
		} else if result.Error != nil {
			return result.Error
		} else {
			// 기존 사용자 업데이트
			updates := map[string]interface{}{
				"profile_img": googleUser.Picture,
			}
			// Provider가 없거나 다르면 업데이트
			if user.Provider == nil || *user.Provider != "google" {
				updates["provider"] = provider
				updates["provider_id"] = googleUser.ID
			}
			if err := tx.Model(&user).Updates(updates).Error; err != nil {
				return err
			}
		}
		return nil
	})

	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to process user",
		})
	}

	// JWT 토큰 생성
	accessToken, err := h.jwtManager.GenerateAccessToken(user.ID, user.Email, user.Nickname)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to generate token",
		})
	}

	refreshToken, err := h.jwtManager.GenerateRefreshToken(user.ID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to generate refresh token",
		})
	}

	// HTTP-Only 쿠키로 액세스 토큰 설정 (XSS 방지)
	c.Cookie(&fiber.Cookie{
		Name:     "access_token",
		Value:    accessToken,
		Path:     "/",
		MaxAge:   15 * 60, // 15분 (보안 강화)
		Secure:   h.secureCookie,
		HTTPOnly: true,
		SameSite: "Lax",
	})

	// HTTP-Only 쿠키로 리프레시 토큰 설정
	c.Cookie(&fiber.Cookie{
		Name:     "refresh_token",
		Value:    refreshToken,
		Path:     "/",
		MaxAge:   7 * 24 * 60 * 60, // 7일
		Secure:   h.secureCookie,
		HTTPOnly: true,
		SameSite: "Lax",
	})

	return c.JSON(AuthResponse{
		User: UserResponse{
			ID:         user.ID,
			Email:      user.Email,
			Nickname:   user.Nickname,
			ProfileImg: user.ProfileImg,
			Provider:   user.Provider,
		},
		ExpiresIn: 900, // 15분
	})
}

// RefreshToken 토큰 갱신
func (h *AuthHandler) RefreshToken(c *fiber.Ctx) error {
	refreshToken := c.Cookies("refresh_token")
	if refreshToken == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "refresh token not found",
		})
	}

	// 리프레시 토큰 검증
	userID, err := h.jwtManager.ValidateRefreshToken(refreshToken)
	if err != nil {
		// 쿠키 삭제
		c.Cookie(&fiber.Cookie{
			Name:     "refresh_token",
			Value:    "",
			Path:     "/",
			MaxAge:   -1,
			Secure:   h.secureCookie,
			HTTPOnly: true,
		})
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "invalid or expired refresh token",
		})
	}

	// 사용자 조회
	var user model.User
	if err := h.db.First(&user, "id = ?", userID).Error; err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "user not found",
		})
	}

	// 새 액세스 토큰 발급
	accessToken, err := h.jwtManager.GenerateAccessToken(user.ID, user.Email, user.Nickname)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to generate token",
		})
	}

	// HTTP-Only 쿠키로 액세스 토큰 설정
	c.Cookie(&fiber.Cookie{
		Name:     "access_token",
		Value:    accessToken,
		Path:     "/",
		MaxAge:   15 * 60, // 15분
		Secure:   h.secureCookie,
		HTTPOnly: true,
		SameSite: "Lax",
	})

	return c.JSON(fiber.Map{
		"expires_in": 900,
	})
}

// Logout 로그아웃
func (h *AuthHandler) Logout(c *fiber.Ctx) error {
	// 액세스 토큰 쿠키 삭제
	c.Cookie(&fiber.Cookie{
		Name:     "access_token",
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		Secure:   h.secureCookie,
		HTTPOnly: true,
	})

	// 리프레시 토큰 쿠키 삭제
	c.Cookie(&fiber.Cookie{
		Name:     "refresh_token",
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		Secure:   h.secureCookie,
		HTTPOnly: true,
	})

	return c.JSON(fiber.Map{
		"message": "logged out successfully",
	})
}

// GetMe 현재 사용자 정보
func (h *AuthHandler) GetMe(c *fiber.Ctx) error {
	claims, err := auth.GetClaimsFromContext(c)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "authentication required",
		})
	}

	var user model.User
	if err := h.db.First(&user, "id = ?", claims.UserID).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "user not found",
		})
	}

	return c.JSON(UserResponse{
		ID:         user.ID,
		Email:      user.Email,
		Nickname:   user.Nickname,
		ProfileImg: user.ProfileImg,
		Provider:   user.Provider,
	})
}
