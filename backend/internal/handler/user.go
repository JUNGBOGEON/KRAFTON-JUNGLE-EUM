package handler

import (
	"strings"

	"github.com/gofiber/fiber/v2"
	"gorm.io/gorm"

	"realtime-backend/internal/auth"
	"realtime-backend/internal/model"
)

// UserHandler 유저 핸들러
type UserHandler struct {
	db *gorm.DB
}

// NewUserHandler UserHandler 생성
func NewUserHandler(db *gorm.DB) *UserHandler {
	return &UserHandler{db: db}
}

// SearchUsersResponse 유저 검색 응답
type SearchUsersResponse struct {
	Users []UserResponse `json:"users"`
	Total int64          `json:"total"`
}

// SearchUsers 유저 검색 (닉네임 또는 이메일)
func (h *UserHandler) SearchUsers(c *fiber.Ctx) error {
	// 현재 로그인한 사용자 정보
	claims := c.Locals("claims").(*auth.Claims)

	// 검색어 가져오기
	query := strings.TrimSpace(c.Query("q"))
	if query == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "search query is required",
		})
	}

	// 최소 2글자 이상
	if len(query) < 2 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "search query must be at least 2 characters",
		})
	}

	// 검색어 정제 (XSS 방지)
	query = sanitizeString(query)

	// 검색 쿼리 생성 (ILIKE로 대소문자 무시)
	searchPattern := "%" + query + "%"

	var users []model.User
	var total int64

	// 닉네임 또는 이메일로 검색 (본인 제외, 최대 10명)
	result := h.db.Model(&model.User{}).
		Where("id != ?", claims.UserID).
		Where("nickname ILIKE ? OR email ILIKE ?", searchPattern, searchPattern).
		Count(&total)

	if result.Error != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to search users",
		})
	}

	result = h.db.
		Where("id != ?", claims.UserID).
		Where("nickname ILIKE ? OR email ILIKE ?", searchPattern, searchPattern).
		Limit(10).
		Find(&users)

	if result.Error != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to search users",
		})
	}

	// 응답 변환
	userResponses := make([]UserResponse, len(users))
	for i, user := range users {
		userResponses[i] = UserResponse{
			ID:         user.ID,
			Email:      user.Email,
			Nickname:   user.Nickname,
			ProfileImg: user.ProfileImg,
		}
	}

	return c.JSON(SearchUsersResponse{
		Users: userResponses,
		Total: total,
	})
}
