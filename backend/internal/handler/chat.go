package handler

import (
	"github.com/gofiber/fiber/v2"
	"gorm.io/gorm"

	"realtime-backend/internal/auth"
	"realtime-backend/internal/model"
)

// ChatHandler 채팅 핸들러
type ChatHandler struct {
	db *gorm.DB
}

// NewChatHandler ChatHandler 생성
func NewChatHandler(db *gorm.DB) *ChatHandler {
	return &ChatHandler{db: db}
}

// ChatLogResponse 채팅 메시지 응답
type ChatLogResponse struct {
	ID        int64         `json:"id"`
	MeetingID int64         `json:"meeting_id"`
	SenderID  *int64        `json:"sender_id,omitempty"`
	Message   string        `json:"message"`
	Type      string        `json:"type"`
	CreatedAt string        `json:"created_at"`
	Sender    *UserResponse `json:"sender,omitempty"`
}

// SendMessageRequest 메시지 전송 요청
type SendMessageRequest struct {
	Message string `json:"message"`
	Type    string `json:"type,omitempty"` // TEXT, SYSTEM
}

// GetWorkspaceChats 워크스페이스 채팅 목록 조회
func (h *ChatHandler) GetWorkspaceChats(c *fiber.Ctx) error {
	claims := c.Locals("claims").(*auth.Claims)
	workspaceID, err := c.ParamsInt("workspaceId")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid workspace id",
		})
	}

	// 멤버 확인
	if !h.isWorkspaceMember(int64(workspaceID), claims.UserID) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "you are not a member of this workspace",
		})
	}

	// 워크스페이스에 연결된 미팅의 채팅 조회 (또는 워크스페이스 전용 채팅)
	// 여기서는 워크스페이스용 기본 미팅을 생성하거나 조회
	var meeting model.Meeting
	err = h.db.Where("workspace_id = ? AND type = ?", workspaceID, "WORKSPACE_CHAT").First(&meeting).Error
	if err == gorm.ErrRecordNotFound {
		// 워크스페이스 채팅용 미팅 생성
		meeting = model.Meeting{
			WorkspaceID: func() *int64 { id := int64(workspaceID); return &id }(),
			HostID:      claims.UserID,
			Title:       "팀 채팅",
			Code:        generateMeetingCode(),
			Type:        "WORKSPACE_CHAT",
			Status:      "ACTIVE",
		}
		if err := h.db.Create(&meeting).Error; err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "failed to create workspace chat",
			})
		}
	} else if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to get workspace chat",
		})
	}

	// 채팅 로그 조회
	var chatLogs []model.ChatLog
	limit := c.QueryInt("limit", 50)
	offset := c.QueryInt("offset", 0)

	err = h.db.
		Where("meeting_id = ?", meeting.ID).
		Preload("Sender").
		Order("created_at DESC").
		Limit(limit).
		Offset(offset).
		Find(&chatLogs).Error

	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to get chat logs",
		})
	}

	// 응답 변환 (역순으로 정렬하여 시간순으로)
	responses := make([]ChatLogResponse, len(chatLogs))
	for i, log := range chatLogs {
		responses[len(chatLogs)-1-i] = h.toChatLogResponse(&log)
	}

	return c.JSON(fiber.Map{
		"meeting_id": meeting.ID,
		"messages":   responses,
		"total":      len(responses),
	})
}

// SendMessage 메시지 전송
func (h *ChatHandler) SendMessage(c *fiber.Ctx) error {
	claims := c.Locals("claims").(*auth.Claims)
	workspaceID, err := c.ParamsInt("workspaceId")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid workspace id",
		})
	}

	// 멤버 확인
	if !h.isWorkspaceMember(int64(workspaceID), claims.UserID) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "you are not a member of this workspace",
		})
	}

	var req SendMessageRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid request body",
		})
	}

	if req.Message == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "message is required",
		})
	}

	// 메시지 정제
	req.Message = sanitizeString(req.Message)
	if len(req.Message) > 2000 {
		req.Message = req.Message[:2000]
	}

	if req.Type == "" {
		req.Type = "TEXT"
	}

	// 워크스페이스 채팅 미팅 조회
	var meeting model.Meeting
	err = h.db.Where("workspace_id = ? AND type = ?", workspaceID, "WORKSPACE_CHAT").First(&meeting).Error
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "workspace chat not found",
		})
	}

	// 채팅 로그 생성
	chatLog := model.ChatLog{
		MeetingID: meeting.ID,
		SenderID:  &claims.UserID,
		Message:   &req.Message,
		Type:      req.Type,
	}

	if err := h.db.Create(&chatLog).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to send message",
		})
	}

	// Sender 정보 로드
	h.db.Preload("Sender").First(&chatLog, chatLog.ID)

	return c.Status(fiber.StatusCreated).JSON(h.toChatLogResponse(&chatLog))
}

// 헬퍼 함수
func (h *ChatHandler) isWorkspaceMember(workspaceID, userID int64) bool {
	var count int64
	h.db.Model(&model.WorkspaceMember{}).
		Where("workspace_id = ? AND user_id = ?", workspaceID, userID).
		Count(&count)
	return count > 0
}

func (h *ChatHandler) toChatLogResponse(log *model.ChatLog) ChatLogResponse {
	resp := ChatLogResponse{
		ID:        log.ID,
		MeetingID: log.MeetingID,
		SenderID:  log.SenderID,
		Type:      log.Type,
		CreatedAt: log.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
	}

	if log.Message != nil {
		resp.Message = *log.Message
	}

	if log.Sender != nil && log.Sender.ID != 0 {
		resp.Sender = &UserResponse{
			ID:         log.Sender.ID,
			Email:      log.Sender.Email,
			Nickname:   log.Sender.Nickname,
			ProfileImg: log.Sender.ProfileImg,
		}
	}

	return resp
}

// 미팅 코드 생성
func generateMeetingCode() string {
	const charset = "abcdefghijklmnopqrstuvwxyz0123456789"
	code := make([]byte, 10)
	for i := range code {
		code[i] = charset[i%len(charset)]
	}
	return string(code)
}
