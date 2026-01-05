package handler

import (
	"fmt"
	"time"

	"realtime-backend/internal/auth"
	"realtime-backend/internal/model"

	"github.com/gofiber/fiber/v2"
)

// GetOrCreateDMRoom DM 방 생성 또는 조회
func (h *ChatHandler) GetOrCreateDMRoom(c *fiber.Ctx) error {
	claims := c.Locals("claims").(*auth.Claims)
	workspaceID, err := c.ParamsInt("workspaceId")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid workspace id"})
	}

	var req struct {
		TargetUserID int64 `json:"target_user_id"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
	}

	// Self-DM 차단: 자신에게 DM을 보낼 수 없음
	if req.TargetUserID == claims.UserID {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "자신에게 DM을 보낼 수 없습니다"})
	}

	// 0. 타겟 유저 존재 및 워크스페이스 멤버십 확인
	// 유저 존재 확인
	var count int64
	if err := h.db.Model(&model.User{}).Where("id = ?", req.TargetUserID).Count(&count).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to check user existence"})
	}
	if count == 0 {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "target user not found"})
	}

	// 워크스페이스 멤버십 확인
	var memberCount int64
	if err := h.db.Table("workspace_members").
		Where("workspace_id = ? AND user_id = ? AND status = ?", workspaceID, req.TargetUserID, "ACTIVE").
		Count(&memberCount).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to check workspace membership"})
	}
	if memberCount == 0 {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "target user is not a member of this workspace"})
	}

	// 1. 이미 존재하는 DM 방 확인 (Self-DM은 이제 불가능하므로 Pair-DM만 체크)
	var existingRoom model.Meeting
	dbErr := h.db.Table("meetings").
		Joins("JOIN participants p1 ON meetings.id = p1.meeting_id AND p1.user_id = ?", claims.UserID).
		Joins("JOIN participants p2 ON meetings.id = p2.meeting_id AND p2.user_id = ?", req.TargetUserID).
		Where("meetings.type = ? AND meetings.workspace_id = ?", "DM", workspaceID).
		First(&existingRoom).Error

	if dbErr == nil && existingRoom.ID != 0 {
		return c.JSON(fiber.Map{"id": existingRoom.ID})
	}

	// 2. 없으면 생성
	tx := h.db.Begin()

	// DM 방 생성
	wsID := int64(workspaceID)
	newRoom := model.Meeting{
		WorkspaceID: &wsID,
		HostID:      claims.UserID,
		Title:       "DM",
		Code:        generateMeetingCode(),
		Type:        model.MeetingTypeDM.String(),
		Status:      "ACTIVE",
	}
	if err := tx.Create(&newRoom).Error; err != nil {
		tx.Rollback()
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to create dm room"})
	}

	// 참가자 추가 (나 자신)
	now := time.Now()
	if err := tx.Create(&model.Participant{
		MeetingID:  newRoom.ID,
		UserID:     &claims.UserID,
		Role:       "MEMBER",
		LastReadAt: &now, // Initialize to current time
	}).Error; err != nil {
		tx.Rollback()
		fmt.Printf("Failed to add participant (me): %v\n", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to add participant", "details": err.Error()})
	}

	// 참가자 추가 (상대방)
	if err := tx.Create(&model.Participant{
		MeetingID:  newRoom.ID,
		UserID:     &req.TargetUserID,
		Role:       "MEMBER",
		LastReadAt: &now, // Initialize to current time
	}).Error; err != nil {
		tx.Rollback()
		fmt.Printf("Failed to add target participant: %v\n", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to add target participant", "details": err.Error()})
	}

	tx.Commit()

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"id": newRoom.ID})
}

// DMRoomResponse DM 방 응답 (상대방 정보 포함)
type DMRoomResponse struct {
	ID          int64        `json:"id"`
	TargetUser  UserResponse `json:"target_user"`
	LastMessage *string      `json:"last_message,omitempty"`
	UnreadCount int64        `json:"unread_count"`
	UpdatedAt   time.Time    `json:"updated_at"`
}

// GetMyDMs 내 DM 목록 조회 (N+1 쿼리 최적화)
func (h *ChatHandler) GetMyDMs(c *fiber.Ctx) error {
	claims := c.Locals("claims").(*auth.Claims)
	workspaceID, err := c.ParamsInt("workspaceId")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid workspace id"})
	}

	// 최적화된 쿼리: 한 번에 모든 정보 가져오기
	type DMResult struct {
		MeetingID      int64      `gorm:"column:meeting_id"`
		CreatedAt      time.Time  `gorm:"column:created_at"`
		MyLastReadAt   *time.Time `gorm:"column:my_last_read_at"`
		TargetUserID   *int64     `gorm:"column:target_user_id"`
		TargetNickname *string    `gorm:"column:target_nickname"`
		TargetEmail    *string    `gorm:"column:target_email"`
		TargetProfile  *string    `gorm:"column:target_profile"`
		UnreadCount    int64      `gorm:"column:unread_count"`
	}

	var results []DMResult

	// 단일 쿼리로 모든 DM 정보 + unread count 조회
	err = h.db.Raw(`
		SELECT 
			m.id as meeting_id,
			m.created_at,
			my_p.last_read_at as my_last_read_at,
			target_p.user_id as target_user_id,
			target_u.nickname as target_nickname,
			target_u.email as target_email,
			target_u.profile_img as target_profile,
			COALESCE(
				(SELECT COUNT(*) 
				 FROM chat_logs cl 
				 WHERE cl.meeting_id = m.id 
				   AND cl.sender_id != ?
				   AND (my_p.last_read_at IS NULL OR cl.created_at > my_p.last_read_at)),
				0
			) as unread_count
		FROM meetings m
		INNER JOIN participants my_p ON m.id = my_p.meeting_id AND my_p.user_id = ?
		LEFT JOIN participants target_p ON m.id = target_p.meeting_id AND target_p.user_id != ?
		LEFT JOIN users target_u ON target_p.user_id = target_u.id
		WHERE m.workspace_id = ? AND m.type = 'DM'
		ORDER BY m.created_at DESC
	`, claims.UserID, claims.UserID, claims.UserID, workspaceID).Scan(&results).Error

	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to fetch dms"})
	}

	response := []DMRoomResponse{}
	for _, r := range results {
		// Self-DM 처리: target_user_id가 NULL이면 본인 정보 사용
		var targetUser *UserResponse
		if r.TargetUserID != nil {
			targetUser = &UserResponse{
				ID:         *r.TargetUserID,
				Nickname:   *r.TargetNickname,
				Email:      *r.TargetEmail,
				ProfileImg: r.TargetProfile,
			}
		} else {
			// Self-DM: 본인 정보 조회 필요
			var user model.User
			if err := h.db.First(&user, claims.UserID).Error; err == nil {
				targetUser = &UserResponse{
					ID:         user.ID,
					Nickname:   user.Nickname,
					Email:      user.Email,
					ProfileImg: user.ProfileImg,
				}
			}
		}

		if targetUser != nil {
			response = append(response, DMRoomResponse{
				ID:          r.MeetingID,
				TargetUser:  *targetUser,
				UnreadCount: r.UnreadCount,
				UpdatedAt:   r.CreatedAt,
			})
		}
	}

	return c.JSON(response)
}
