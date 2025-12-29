package handler

import (
	"math/rand"

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
	UpdatedAt *string       `json:"updated_at,omitempty"`
	Sender    *UserResponse `json:"sender,omitempty"`
}

// SendMessageRequest 메시지 전송 요청
type SendMessageRequest struct {
	Message string `json:"message"`
	Type    string `json:"type,omitempty"` // TEXT, SYSTEM
}

// CreateChatRoomRequest 채팅방 생성 요청
type CreateChatRoomRequest struct {
	Title string `json:"title"`
}

// ChatRoomResponse 채팅방 응답
type ChatRoomResponse struct {
	ID           int64   `json:"id"`
	WorkspaceID  int64   `json:"workspace_id"`
	Title        string  `json:"title"`
	CreatedAt    string  `json:"created_at"`
	MessageCount int64   `json:"message_count"`
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

// GetChatRooms 채팅방 목록 조회
func (h *ChatHandler) GetChatRooms(c *fiber.Ctx) error {
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

	// 기존 WORKSPACE_CHAT을 CHAT_ROOM으로 마이그레이션
	h.db.Model(&model.Meeting{}).
		Where("workspace_id = ? AND type = ?", workspaceID, "WORKSPACE_CHAT").
		Update("type", "CHAT_ROOM")

	// 채팅방 목록 조회 (CHAT_ROOM 타입)
	var meetings []model.Meeting
	err = h.db.
		Where("workspace_id = ? AND type = ?", workspaceID, "CHAT_ROOM").
		Order("id ASC").
		Find(&meetings).Error

	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to get chat rooms",
		})
	}

	// 각 채팅방의 메시지 수 조회
	responses := make([]ChatRoomResponse, len(meetings))
	for i, m := range meetings {
		var msgCount int64
		h.db.Model(&model.ChatLog{}).Where("meeting_id = ?", m.ID).Count(&msgCount)

		responses[i] = ChatRoomResponse{
			ID:           m.ID,
			WorkspaceID:  *m.WorkspaceID,
			Title:        m.Title,
			CreatedAt:    m.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
			MessageCount: msgCount,
		}
	}

	return c.JSON(fiber.Map{
		"chatrooms": responses,
		"total":     len(responses),
	})
}

// CreateChatRoom 채팅방 생성
func (h *ChatHandler) CreateChatRoom(c *fiber.Ctx) error {
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

	var req CreateChatRoomRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid request body",
		})
	}

	if req.Title == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "title is required",
		})
	}

	req.Title = sanitizeString(req.Title)
	if len(req.Title) > 100 {
		req.Title = req.Title[:100]
	}

	// 채팅방 생성 (Meeting 타입: CHAT_ROOM)
	wsID := int64(workspaceID)
	meeting := model.Meeting{
		WorkspaceID: &wsID,
		HostID:      claims.UserID,
		Title:       req.Title,
		Code:        generateMeetingCode(),
		Type:        "CHAT_ROOM",
		Status:      "ACTIVE",
	}

	if err := h.db.Create(&meeting).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to create chat room",
		})
	}

	return c.Status(fiber.StatusCreated).JSON(ChatRoomResponse{
		ID:           meeting.ID,
		WorkspaceID:  wsID,
		Title:        meeting.Title,
		CreatedAt:    meeting.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		MessageCount: 0,
	})
}

// GetChatRoomMessages 채팅방 메시지 조회
func (h *ChatHandler) GetChatRoomMessages(c *fiber.Ctx) error {
	claims := c.Locals("claims").(*auth.Claims)
	workspaceID, err := c.ParamsInt("workspaceId")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid workspace id",
		})
	}
	roomID, err := c.ParamsInt("roomId")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid room id",
		})
	}

	// 멤버 확인
	if !h.isWorkspaceMember(int64(workspaceID), claims.UserID) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "you are not a member of this workspace",
		})
	}

	// 채팅방 확인
	var meeting model.Meeting
	err = h.db.Where("id = ? AND workspace_id = ? AND type = ?", roomID, workspaceID, "CHAT_ROOM").First(&meeting).Error
	if err == gorm.ErrRecordNotFound {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "chat room not found",
		})
	}
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to get chat room",
		})
	}

	// 채팅 로그 조회
	var chatLogs []model.ChatLog
	limit := c.QueryInt("limit", 50)
	offset := c.QueryInt("offset", 0)

	err = h.db.
		Where("meeting_id = ?", roomID).
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
		"room_id":  roomID,
		"messages": responses,
		"total":    len(responses),
	})
}

// SendChatRoomMessage 채팅방 메시지 전송
func (h *ChatHandler) SendChatRoomMessage(c *fiber.Ctx) error {
	claims := c.Locals("claims").(*auth.Claims)
	workspaceID, err := c.ParamsInt("workspaceId")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid workspace id",
		})
	}
	roomID, err := c.ParamsInt("roomId")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid room id",
		})
	}

	// 멤버 확인
	if !h.isWorkspaceMember(int64(workspaceID), claims.UserID) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "you are not a member of this workspace",
		})
	}

	// 채팅방 확인
	var meeting model.Meeting
	err = h.db.Where("id = ? AND workspace_id = ? AND type = ?", roomID, workspaceID, "CHAT_ROOM").First(&meeting).Error
	if err == gorm.ErrRecordNotFound {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "chat room not found",
		})
	}
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to get chat room",
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

	// 채팅 로그 생성
	chatLog := model.ChatLog{
		MeetingID: int64(roomID),
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

// UpdateMessageRequest 메시지 수정 요청
type UpdateMessageRequest struct {
	Message string `json:"message"`
}

// UpdateChatMessage 채팅 메시지 수정
func (h *ChatHandler) UpdateChatMessage(c *fiber.Ctx) error {
	claims := c.Locals("claims").(*auth.Claims)
	workspaceID, err := c.ParamsInt("workspaceId")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid workspace id",
		})
	}
	roomID, err := c.ParamsInt("roomId")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid room id",
		})
	}
	messageID, err := c.ParamsInt("messageId")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid message id",
		})
	}

	// 멤버 확인
	if !h.isWorkspaceMember(int64(workspaceID), claims.UserID) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "you are not a member of this workspace",
		})
	}

	// 메시지 조회
	var chatLog model.ChatLog
	err = h.db.Where("id = ? AND meeting_id = ?", messageID, roomID).First(&chatLog).Error
	if err == gorm.ErrRecordNotFound {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "message not found",
		})
	}
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to get message",
		})
	}

	// 본인 메시지인지 확인
	if chatLog.SenderID == nil || *chatLog.SenderID != claims.UserID {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "you can only edit your own messages",
		})
	}

	var req UpdateMessageRequest
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

	// 메시지 수정
	chatLog.Message = &req.Message
	if err := h.db.Save(&chatLog).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to update message",
		})
	}

	// Sender 정보 로드
	h.db.Preload("Sender").First(&chatLog, chatLog.ID)

	return c.JSON(h.toChatLogResponse(&chatLog))
}

// DeleteChatMessage 채팅 메시지 삭제
func (h *ChatHandler) DeleteChatMessage(c *fiber.Ctx) error {
	claims := c.Locals("claims").(*auth.Claims)
	workspaceID, err := c.ParamsInt("workspaceId")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid workspace id",
		})
	}
	roomID, err := c.ParamsInt("roomId")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid room id",
		})
	}
	messageID, err := c.ParamsInt("messageId")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid message id",
		})
	}

	// 멤버 확인
	if !h.isWorkspaceMember(int64(workspaceID), claims.UserID) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "you are not a member of this workspace",
		})
	}

	// 메시지 조회
	var chatLog model.ChatLog
	err = h.db.Where("id = ? AND meeting_id = ?", messageID, roomID).First(&chatLog).Error
	if err == gorm.ErrRecordNotFound {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "message not found",
		})
	}
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to get message",
		})
	}

	// 본인 메시지인지 확인
	if chatLog.SenderID == nil || *chatLog.SenderID != claims.UserID {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "you can only delete your own messages",
		})
	}

	// 메시지 삭제
	if err := h.db.Delete(&chatLog).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to delete message",
		})
	}

	return c.JSON(fiber.Map{
		"message": "message deleted successfully",
	})
}

// DeleteChatRoom 채팅방 삭제
func (h *ChatHandler) DeleteChatRoom(c *fiber.Ctx) error {
	claims := c.Locals("claims").(*auth.Claims)
	workspaceID, err := c.ParamsInt("workspaceId")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid workspace id",
		})
	}
	roomID, err := c.ParamsInt("roomId")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid room id",
		})
	}

	// 멤버 확인
	if !h.isWorkspaceMember(int64(workspaceID), claims.UserID) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "you are not a member of this workspace",
		})
	}

	// 채팅방 확인
	var meeting model.Meeting
	err = h.db.Where("id = ? AND workspace_id = ? AND type = ?", roomID, workspaceID, "CHAT_ROOM").First(&meeting).Error
	if err == gorm.ErrRecordNotFound {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "chat room not found",
		})
	}
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to get chat room",
		})
	}

	// 트랜잭션으로 채팅 로그와 채팅방 삭제
	err = h.db.Transaction(func(tx *gorm.DB) error {
		// 채팅 로그 삭제
		if err := tx.Where("meeting_id = ?", roomID).Delete(&model.ChatLog{}).Error; err != nil {
			return err
		}
		// 채팅방 삭제
		if err := tx.Delete(&meeting).Error; err != nil {
			return err
		}
		return nil
	})

	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to delete chat room",
		})
	}

	return c.JSON(fiber.Map{
		"message": "chat room deleted successfully",
	})
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

	// 수정된 메시지인 경우 updated_at 포함
	if log.UpdatedAt != nil && !log.UpdatedAt.Equal(log.CreatedAt) {
		updatedAt := log.UpdatedAt.Format("2006-01-02T15:04:05Z07:00")
		resp.UpdatedAt = &updatedAt
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
		code[i] = charset[rand.Intn(len(charset))]
	}
	return string(code)
}
