package handler

import (
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/gofiber/contrib/websocket"
	"gorm.io/gorm"

	"realtime-backend/internal/model"
)

// ChatWSHandler WebSocket 채팅 핸들러
type ChatWSHandler struct {
	db    *gorm.DB
	rooms map[int64]*ChatRoom // workspaceID -> ChatRoom
	mu    sync.RWMutex
}

// ChatRoom 채팅방
type ChatRoom struct {
	clients map[*websocket.Conn]*ChatClient
	mu      sync.RWMutex
}

// ChatClient 채팅 클라이언트
type ChatClient struct {
	UserID   int64
	Nickname string
	Conn     *websocket.Conn
}

// WSMessage WebSocket 메시지
type WSMessage struct {
	Type    string      `json:"type"` // message, typing, stop_typing, join, leave
	Payload interface{} `json:"payload,omitempty"`
}

// ChatPayload 채팅 메시지 페이로드
type ChatPayload struct {
	ID        int64  `json:"id,omitempty"`
	Message   string `json:"message"`
	SenderID  int64  `json:"sender_id"`
	Nickname  string `json:"nickname"`
	CreatedAt string `json:"created_at,omitempty"`
}

// TypingPayload 타이핑 페이로드
type TypingPayload struct {
	UserID   int64  `json:"user_id"`
	Nickname string `json:"nickname"`
}

// NewChatWSHandler ChatWSHandler 생성
func NewChatWSHandler(db *gorm.DB) *ChatWSHandler {
	return &ChatWSHandler{
		db:    db,
		rooms: make(map[int64]*ChatRoom),
	}
}

// getOrCreateRoom 채팅방 조회 또는 생성
func (h *ChatWSHandler) getOrCreateRoom(workspaceID int64) *ChatRoom {
	h.mu.Lock()
	defer h.mu.Unlock()

	if room, ok := h.rooms[workspaceID]; ok {
		return room
	}

	room := &ChatRoom{
		clients: make(map[*websocket.Conn]*ChatClient),
	}
	h.rooms[workspaceID] = room
	return room
}

// HandleWebSocket WebSocket 연결 처리
func (h *ChatWSHandler) HandleWebSocket(c *websocket.Conn) {
	// 쿼리 파라미터에서 정보 추출
	workspaceID := c.Locals("workspaceId").(int64)
	userID := c.Locals("userId").(int64)
	nickname := c.Locals("nickname").(string)

	room := h.getOrCreateRoom(workspaceID)

	client := &ChatClient{
		UserID:   userID,
		Nickname: nickname,
		Conn:     c,
	}

	// 클라이언트 등록
	room.mu.Lock()
	room.clients[c] = client
	room.mu.Unlock()

	log.Printf("채팅 클라이언트 연결: workspace=%d, user=%d", workspaceID, userID)

	// 연결 해제 시 정리
	defer func() {
		room.mu.Lock()
		delete(room.clients, c)
		room.mu.Unlock()
		c.Close()
		log.Printf("채팅 클라이언트 연결 해제: workspace=%d, user=%d", workspaceID, userID)
	}()

	// 메시지 수신 루프
	for {
		_, msgBytes, err := c.ReadMessage()
		if err != nil {
			break
		}

		var msg WSMessage
		if err := json.Unmarshal(msgBytes, &msg); err != nil {
			continue
		}

		switch msg.Type {
		case "message":
			h.handleMessage(room, client, workspaceID, msg.Payload)
		case "typing":
			h.broadcastTyping(room, client, true)
		case "stop_typing":
			h.broadcastTyping(room, client, false)
		}
	}
}

// handleMessage 메시지 처리
func (h *ChatWSHandler) handleMessage(room *ChatRoom, client *ChatClient, workspaceID int64, payload interface{}) {
	payloadBytes, _ := json.Marshal(payload)
	var chatPayload ChatPayload
	if err := json.Unmarshal(payloadBytes, &chatPayload); err != nil {
		return
	}

	if chatPayload.Message == "" {
		return
	}

	// 메시지 길이 제한
	if len(chatPayload.Message) > 2000 {
		chatPayload.Message = chatPayload.Message[:2000]
	}

	// 워크스페이스 채팅 미팅 조회
	var meeting model.Meeting
	err := h.db.Where("workspace_id = ? AND type = ?", workspaceID, "WORKSPACE_CHAT").First(&meeting).Error
	if err != nil {
		return
	}

	// DB에 저장
	message := chatPayload.Message
	chatLog := model.ChatLog{
		MeetingID: meeting.ID,
		SenderID:  &client.UserID,
		Message:   &message,
		Type:      "TEXT",
	}

	if err := h.db.Create(&chatLog).Error; err != nil {
		return
	}

	// 브로드캐스트 메시지 생성
	broadcastMsg := WSMessage{
		Type: "message",
		Payload: ChatPayload{
			ID:        chatLog.ID,
			Message:   message,
			SenderID:  client.UserID,
			Nickname:  client.Nickname,
			CreatedAt: chatLog.CreatedAt.Format(time.RFC3339),
		},
	}

	h.broadcast(room, broadcastMsg)
}

// broadcastTyping 타이핑 상태 브로드캐스트
func (h *ChatWSHandler) broadcastTyping(room *ChatRoom, client *ChatClient, isTyping bool) {
	msgType := "typing"
	if !isTyping {
		msgType = "stop_typing"
	}

	msg := WSMessage{
		Type: msgType,
		Payload: TypingPayload{
			UserID:   client.UserID,
			Nickname: client.Nickname,
		},
	}

	// 자신을 제외한 모든 클라이언트에게 브로드캐스트
	room.mu.RLock()
	defer room.mu.RUnlock()

	msgBytes, _ := json.Marshal(msg)
	for conn, c := range room.clients {
		if c.UserID != client.UserID {
			conn.WriteMessage(websocket.TextMessage, msgBytes)
		}
	}
}

// broadcast 모든 클라이언트에게 메시지 전송
func (h *ChatWSHandler) broadcast(room *ChatRoom, msg WSMessage) {
	room.mu.RLock()
	defer room.mu.RUnlock()

	msgBytes, _ := json.Marshal(msg)
	for conn := range room.clients {
		if err := conn.WriteMessage(websocket.TextMessage, msgBytes); err != nil {
			log.Printf("메시지 전송 실패: %v", err)
		}
	}
}
