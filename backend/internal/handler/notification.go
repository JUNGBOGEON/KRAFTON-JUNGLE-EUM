package handler

import (
	"fmt"

	"github.com/gofiber/fiber/v2"
	"gorm.io/gorm"

	"realtime-backend/internal/auth"
	"realtime-backend/internal/model"
)

// NotificationHandler 알림 핸들러
type NotificationHandler struct {
	db *gorm.DB
}

// NewNotificationHandler NotificationHandler 생성
func NewNotificationHandler(db *gorm.DB) *NotificationHandler {
	return &NotificationHandler{db: db}
}

// NotificationResponse 알림 응답
type NotificationResponse struct {
	ID          int64         `json:"id"`
	Type        string        `json:"type"`
	Content     string        `json:"content"`
	IsRead      bool          `json:"is_read"`
	RelatedType *string       `json:"related_type,omitempty"`
	RelatedID   *int64        `json:"related_id,omitempty"`
	CreatedAt   string        `json:"created_at"`
	Sender      *UserResponse `json:"sender,omitempty"`
}

// GetMyNotifications 내 알림 목록 조회
func (h *NotificationHandler) GetMyNotifications(c *fiber.Ctx) error {
	claims := c.Locals("claims").(*auth.Claims)

	var notifications []model.Notification
	err := h.db.
		Where("receiver_id = ? AND is_read = ?", claims.UserID, false).
		Preload("Sender").
		Order("created_at DESC").
		Limit(50).
		Find(&notifications).Error

	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to get notifications",
		})
	}

	responses := make([]NotificationResponse, len(notifications))
	for i, n := range notifications {
		responses[i] = h.toNotificationResponse(&n)
	}

	return c.JSON(fiber.Map{
		"notifications": responses,
		"total":         len(responses),
	})
}

// AcceptInvitation 초대 수락 (WORKSPACE_INVITE 타입의 알림)
func (h *NotificationHandler) AcceptInvitation(c *fiber.Ctx) error {
	claims := c.Locals("claims").(*auth.Claims)
	notificationID, err := c.ParamsInt("id")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid notification id",
		})
	}

	// 알림 조회
	var notification model.Notification
	if err := h.db.First(&notification, notificationID).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "notification not found",
		})
	}

	// 본인 알림인지 확인
	if notification.ReceiverID != claims.UserID {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "this notification is not for you",
		})
	}

	// 초대 알림인지 확인
	if notification.Type != model.NotificationTypeWorkspaceInvite.String() {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "this is not an invitation notification",
		})
	}

	if notification.RelatedID == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid invitation notification",
		})
	}

	workspaceID := *notification.RelatedID

	// 트랜잭션으로 처리
	tx := h.db.Begin()

	// 알림 읽음 처리
	if err := tx.Model(&notification).Update("is_read", true).Error; err != nil {
		tx.Rollback()
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to process notification",
		})
	}

	// 해당 멤버십 조회 (PENDING 상태의 멤버)
	var member model.WorkspaceMember
	err = tx.Where("workspace_id = ? AND user_id = ?", workspaceID, claims.UserID).First(&member).Error
	if err != nil {
		tx.Rollback()
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "membership not found",
		})
	}

	// 멤버십 활성화
	if err := tx.Model(&member).Update("status", model.MemberStatusActive.String()).Error; err != nil {
		tx.Rollback()
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to activate membership",
		})
	}

	// 기본 역할(Default Role) 찾기 및 할당
	var defaultRole model.Role
	if err := tx.Where("workspace_id = ? AND is_default = ?", workspaceID, true).First(&defaultRole).Error; err == nil {
		// 기본 역할이 있으면 할당
		if err := tx.Model(&member).Update("role_id", defaultRole.ID).Error; err != nil {
			// 역할 할당 실패는 로그만 남기고 계속 진행 (치명적이지 않음)
			fmt.Printf("Failed to assign default role to user %d in workspace %d: %v\n", claims.UserID, workspaceID, err)
		}
	}

	tx.Commit()

	return c.JSON(fiber.Map{
		"message":      "invitation accepted",
		"workspace_id": workspaceID,
	})
}

// DeclineInvitation 초대 거절
func (h *NotificationHandler) DeclineInvitation(c *fiber.Ctx) error {
	claims := c.Locals("claims").(*auth.Claims)
	notificationID, err := c.ParamsInt("id")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid notification id",
		})
	}

	// 알림 조회
	var notification model.Notification
	if err := h.db.First(&notification, notificationID).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "notification not found",
		})
	}

	// 본인 알림인지 확인
	if notification.ReceiverID != claims.UserID {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "this notification is not for you",
		})
	}

	// 초대 알림인지 확인
	if notification.Type != model.NotificationTypeWorkspaceInvite.String() {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "this is not an invitation notification",
		})
	}

	if notification.RelatedID == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid invitation notification",
		})
	}

	workspaceID := *notification.RelatedID

	// 트랜잭션으로 처리
	tx := h.db.Begin()

	// 알림 읽음 처리
	if err := tx.Model(&notification).Update("is_read", true).Error; err != nil {
		tx.Rollback()
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to process notification",
		})
	}

	// PENDING 상태의 멤버십 삭제
	if err := tx.Where("workspace_id = ? AND user_id = ? AND status = ?", workspaceID, claims.UserID, model.MemberStatusPending.String()).Delete(&model.WorkspaceMember{}).Error; err != nil {
		tx.Rollback()
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to decline invitation",
		})
	}

	tx.Commit()

	return c.JSON(fiber.Map{
		"message": "invitation declined",
	})
}

// MarkAsRead 알림 읽음 처리
func (h *NotificationHandler) MarkAsRead(c *fiber.Ctx) error {
	claims := c.Locals("claims").(*auth.Claims)
	notificationID, err := c.ParamsInt("id")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid notification id",
		})
	}

	result := h.db.Model(&model.Notification{}).
		Where("id = ? AND receiver_id = ?", notificationID, claims.UserID).
		Update("is_read", true)

	if result.Error != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to mark notification as read",
		})
	}

	return c.JSON(fiber.Map{
		"message": "notification marked as read",
	})
}

// 헬퍼: 알림 생성 (다른 핸들러에서 사용)
func CreateNotification(db *gorm.DB, receiverID int64, senderID *int64, notificationType, content string, relatedType *string, relatedID *int64) error {
	notification := model.Notification{
		ReceiverID:  receiverID,
		SenderID:    senderID,
		Type:        notificationType,
		Content:     content,
		RelatedType: relatedType,
		RelatedID:   relatedID,
	}

	if err := db.Create(&notification).Error; err != nil {
		return err
	}

	// WebSocket으로 실시간 푸시
	go func() {
		// Sender 정보 로드
		var sender *model.User
		if senderID != nil {
			var user model.User
			if err := db.First(&user, *senderID).Error; err == nil {
				sender = &user
			}
		}

		payload := NotificationPayload{
			ID:          notification.ID,
			Type:        notification.Type,
			Content:     notification.Content,
			IsRead:      notification.IsRead,
			RelatedType: notification.RelatedType,
			RelatedID:   notification.RelatedID,
			CreatedAt:   notification.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		}

		if sender != nil {
			payload.Sender = &UserResponse{
				ID:         sender.ID,
				Email:      sender.Email,
				Nickname:   sender.Nickname,
				ProfileImg: sender.ProfileImg,
			}
		}

		GetNotificationWSHandler().SendToUser(receiverID, payload)
	}()

	return nil
}

// 헬퍼: 초대 알림 생성
func CreateWorkspaceInviteNotification(db *gorm.DB, inviterID, inviteeID, workspaceID int64, workspaceName, inviterName string) error {
	content := fmt.Sprintf("%s님이 %s 워크스페이스에 초대했습니다.", inviterName, workspaceName)
	relatedType := "WORKSPACE"
	return CreateNotification(db, inviteeID, &inviterID, model.NotificationTypeWorkspaceInvite.String(), content, &relatedType, &workspaceID)
}

// 응답 변환
func (h *NotificationHandler) toNotificationResponse(n *model.Notification) NotificationResponse {
	resp := NotificationResponse{
		ID:          n.ID,
		Type:        n.Type,
		Content:     n.Content,
		IsRead:      n.IsRead,
		RelatedType: n.RelatedType,
		RelatedID:   n.RelatedID,
		CreatedAt:   n.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
	}

	if n.Sender != nil && n.Sender.ID != 0 {
		resp.Sender = &UserResponse{
			ID:         n.Sender.ID,
			Email:      n.Sender.Email,
			Nickname:   n.Sender.Nickname,
			ProfileImg: n.Sender.ProfileImg,
		}
	}

	return resp
}
