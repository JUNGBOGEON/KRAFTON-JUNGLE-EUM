package handler

import (
	"log"
	"math/rand"
	"time"

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

// CreateChatRoomRequest 채팅방 생성 요청
type CreateChatRoomRequest struct {
	Title string `json:"title"`
}

// ChatRoomResponse 채팅방 응답
type ChatRoomResponse struct {
	ID           int64  `json:"id"`
	WorkspaceID  int64  `json:"workspace_id"`
	Title        string `json:"title"`
	CreatedAt    string `json:"created_at"`
	MessageCount int64  `json:"message_count"`
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

	// 권한 확인
	hasPermission, err := auth.CheckPermission(h.db, int64(workspaceID), claims.UserID, "SEND_MESSAGES")
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to check permission"})
	}
	if !hasPermission {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "you do not have permission to send messages"})
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
		Where("workspace_id = ? AND user_id = ? AND status = ?", workspaceID, userID, model.MemberStatusActive.String()).
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
	seededRand := rand.New(rand.NewSource(time.Now().UnixNano()))
	code := make([]byte, 10)
	for i := range code {
		code[i] = charset[seededRand.Intn(len(charset))]
	}
	return string(code)
}

// =============================================
// 채팅방 관련 엔드포인트 (다중 채팅방 지원)
// =============================================

// GetChatRooms 워크스페이스 채팅방 목록 조회
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

	// 기존 WORKSPACE_CHAT이 있으면 CHAT_ROOM으로 변환 (lazy migration)
	h.db.Model(&model.Meeting{}).
		Where("workspace_id = ? AND type = ?", workspaceID, "WORKSPACE_CHAT").
		Update("type", "CHAT_ROOM")

	// 채팅방이 없으면 "일반" 채팅방 자동 생성
	var count int64
	h.db.Model(&model.Meeting{}).
		Where("workspace_id = ? AND type = ?", workspaceID, "CHAT_ROOM").
		Count(&count)

	if count == 0 {
		defaultRoom := model.Meeting{
			WorkspaceID: func() *int64 { id := int64(workspaceID); return &id }(),
			HostID:      claims.UserID,
			Title:       "일반",
			Code:        generateMeetingCode(),
			Type:        "CHAT_ROOM",
			Status:      "ACTIVE",
		}
		if err := h.db.Create(&defaultRoom).Error; err != nil {
			log.Printf("warning: failed to create default chat room for workspace %d: %v", workspaceID, err)
		}
	}

	// 채팅방 목록 조회
	var rooms []model.Meeting
	err = h.db.
		Where("workspace_id = ? AND type = ?", workspaceID, "CHAT_ROOM").
		Order("created_at ASC").
		Find(&rooms).Error

	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to get chat rooms",
		})
	}

	// 각 채팅방의 메시지 수 조회
	responses := make([]ChatRoomResponse, len(rooms))
	for i, room := range rooms {
		var msgCount int64
		h.db.Model(&model.ChatLog{}).Where("meeting_id = ?", room.ID).Count(&msgCount)

		responses[i] = ChatRoomResponse{
			ID:           room.ID,
			WorkspaceID:  int64(workspaceID),
			Title:        room.Title,
			CreatedAt:    room.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
			MessageCount: msgCount,
		}
	}

	return c.JSON(fiber.Map{
		"rooms": responses,
		"total": len(responses),
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

	// 권한 확인
	hasPermission, err := auth.CheckPermission(h.db, int64(workspaceID), claims.UserID, "MANAGE_CHANNELS")
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to check permission"})
	}
	if !hasPermission {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "you do not have permission to create chat rooms"})
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

	// 제목 정제
	req.Title = sanitizeString(req.Title)
	if len(req.Title) > 100 {
		req.Title = req.Title[:100]
	}

	// 채팅방 생성
	room := model.Meeting{
		WorkspaceID: func() *int64 { id := int64(workspaceID); return &id }(),
		HostID:      claims.UserID,
		Title:       req.Title,
		Code:        generateMeetingCode(),
		Type:        "CHAT_ROOM",
		Status:      "ACTIVE",
	}

	if err := h.db.Create(&room).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to create chat room",
		})
	}

	return c.Status(fiber.StatusCreated).JSON(ChatRoomResponse{
		ID:           room.ID,
		WorkspaceID:  int64(workspaceID),
		Title:        room.Title,
		CreatedAt:    room.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		MessageCount: 0,
	})
}

// GetChatRoomMessages 특정 채팅방 메시지 조회
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
	var room model.Meeting
	err = h.db.Where("id = ? AND workspace_id = ? AND type IN ?", roomID, workspaceID, []string{model.MeetingTypeChatRoom.String(), model.MeetingTypeDM.String()}).First(&room).Error
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "chat room not found",
		})
	}

	// 채팅 로그 조회
	var chatLogs []model.ChatLog
	limit := c.QueryInt("limit", 50)
	offset := c.QueryInt("offset", 0)

	err = h.db.
		Where("meeting_id = ?", room.ID).
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

	// LastReadAt 업데이트 (메시지 읽음 처리)
	now := time.Now()
	h.db.Model(&model.Participant{}).
		Where("meeting_id = ? AND user_id = ?", room.ID, claims.UserID).
		Update("last_read_at", now)

	return c.JSON(fiber.Map{
		"room_id":  room.ID,
		"messages": chatLogs,
		"total":    len(chatLogs), // Pagination logic might need total count separatel but for now simple length
	})

}

// SendChatRoomMessage 특정 채팅방에 메시지 전송
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

	// 권한 확인
	hasPermission, err := auth.CheckPermission(h.db, int64(workspaceID), claims.UserID, "SEND_MESSAGES")
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to check permission"})
	}
	if !hasPermission {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "you do not have permission to send messages"})
	}

	// 채팅방 확인
	var room model.Meeting
	err = h.db.Where("id = ? AND workspace_id = ? AND type IN ?", roomID, workspaceID, []string{model.MeetingTypeChatRoom.String(), model.MeetingTypeDM.String()}).First(&room).Error
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "chat room not found",
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
		MeetingID: room.ID,
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

// UpdateChatRoom 채팅방 수정
func (h *ChatHandler) UpdateChatRoom(c *fiber.Ctx) error {
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

	// 권한 확인
	hasPermission, err := auth.CheckPermission(h.db, int64(workspaceID), claims.UserID, "MANAGE_CHANNELS")
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to check permission"})
	}
	if !hasPermission {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "you do not have permission to update chat rooms"})
	}

	// 채팅방 확인
	var room model.Meeting
	err = h.db.Where("id = ? AND workspace_id = ? AND type = ?", roomID, workspaceID, "CHAT_ROOM").First(&room).Error
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "chat room not found",
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

	// 제목 정제
	req.Title = sanitizeString(req.Title)
	if len(req.Title) > 100 {
		req.Title = req.Title[:100]
	}

	// 채팅방 업데이트
	room.Title = req.Title
	if err := h.db.Save(&room).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to update chat room",
		})
	}

	// 메시지 수 조회
	var msgCount int64
	h.db.Model(&model.ChatLog{}).Where("meeting_id = ?", room.ID).Count(&msgCount)

	return c.JSON(ChatRoomResponse{
		ID:           room.ID,
		WorkspaceID:  int64(workspaceID),
		Title:        room.Title,
		CreatedAt:    room.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		MessageCount: msgCount,
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

	// 권한 확인
	hasPermission, err := auth.CheckPermission(h.db, int64(workspaceID), claims.UserID, "MANAGE_CHANNELS")
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to check permission"})
	}
	if !hasPermission {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "you do not have permission to delete chat rooms"})
	}

	// 채팅방 확인
	var room model.Meeting
	err = h.db.Where("id = ? AND workspace_id = ? AND type = ?", roomID, workspaceID, "CHAT_ROOM").First(&room).Error
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "chat room not found",
		})
	}

	// 채팅 로그 삭제
	if err := h.db.Where("meeting_id = ?", room.ID).Delete(&model.ChatLog{}).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to delete chat logs",
		})
	}

	// 채팅방 삭제
	if err := h.db.Delete(&room).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to delete chat room",
		})
	}

	return c.JSON(fiber.Map{
		"message": "chat room deleted successfully",
	})
}

// MarkAsRead 채팅방 읽음 처리
func (h *ChatHandler) MarkAsRead(c *fiber.Ctx) error {
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

	// 채팅방 확인 (존재 여부만 체크)
	var count int64
	h.db.Table("meetings").Where("id = ? AND workspace_id = ?", roomID, workspaceID).Count(&count)
	if count == 0 {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "chat room not found",
		})
	}

	now := time.Now()
	if err := h.db.Model(&model.Participant{}).
		Where("meeting_id = ? AND user_id = ?", roomID, claims.UserID).
		Update("last_read_at", now).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to mark as read",
		})
	}

	return c.JSON(fiber.Map{
		"message": "marked as read",
		"read_at": now,
	})
}
