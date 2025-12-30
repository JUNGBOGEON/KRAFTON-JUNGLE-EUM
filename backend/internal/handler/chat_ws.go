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
	rooms map[int64]*ChatRoom // roomId -> ChatRoom
	mu    sync.RWMutex
}

// ChatRoom 채팅방
type ChatRoom struct {
	clients map[*websocket.Conn]*ChatClient
	mu      sync.RWMutex
}

// ChatClient 채팅 클라이언트
type ChatClient struct {
	UserID      int64
	Nickname    string
	Conn        *websocket.Conn
	Permissions []string
	IsOwner     bool
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
func (h *ChatWSHandler) getOrCreateRoom(roomID int64) *ChatRoom {
	h.mu.Lock()
	defer h.mu.Unlock()

	if room, ok := h.rooms[roomID]; ok {
		return room
	}

	room := &ChatRoom{
		clients: make(map[*websocket.Conn]*ChatClient),
	}
	h.rooms[roomID] = room
	return room
}

// HandleWebSocket WebSocket 연결 처리
func (h *ChatWSHandler) HandleWebSocket(c *websocket.Conn) {
	// 쿼리 파라미터에서 정보 추출 (안전한 타입 변환)
	roomIDInterface := c.Locals("roomId")
	userIDInterface := c.Locals("userId")
	nicknameInterface := c.Locals("nickname")

	roomID, ok1 := roomIDInterface.(int64)
	workspaceID, ok2 := c.Locals("workspaceId").(int64)
	userID, ok3 := userIDInterface.(int64)
	nickname, ok4 := nicknameInterface.(string)

	if !ok1 || !ok2 || !ok3 || !ok4 {
		c.WriteMessage(websocket.TextMessage, []byte(`{"type":"error","message":"invalid session"}`))
		c.Close()
		return
	}

	// 권한 확인
	var permissions []string
	h.db.Table("role_permissions").
		Joins("JOIN workspace_members ON workspace_members.role_id = role_permissions.role_id").
		Where("workspace_members.workspace_id = ? AND workspace_members.user_id = ?", workspaceID, userID).
		Pluck("permission_code", &permissions)

	var isOwner bool
	var workspace model.Workspace
	if err := h.db.First(&workspace, workspaceID).Error; err == nil && workspace.OwnerID == userID {
		isOwner = true
	}

	room := h.getOrCreateRoom(roomID)

	client := &ChatClient{
		UserID:      userID,
		Nickname:    nickname,
		Conn:        c,
		Permissions: permissions,
		IsOwner:     isOwner,
	}

	// 클라이언트 등록
	room.mu.Lock()
	room.clients[c] = client
	room.mu.Unlock()

	log.Printf("채팅 클라이언트 연결: room=%d, user=%d", roomID, userID)

	// 연결 해제 시 정리
	defer func() {
		room.mu.Lock()
		delete(room.clients, c)
		room.mu.Unlock()
		c.Close()
		log.Printf("채팅 클라이언트 연결 해제: room=%d, user=%d", roomID, userID)
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
			// 권한 체크
			canSend := client.IsOwner
			if !canSend {
				for _, p := range client.Permissions {
					if p == "SEND_MESSAGES" {
						canSend = true
						break
					}
				}
			}

			if canSend {
				h.handleMessage(room, client, roomID, msg.Payload)
			} else {
				c.WriteMessage(websocket.TextMessage, []byte(`{"type":"error","message":"no permission to send messages"}`))
			}
		case "typing":
			h.broadcastTyping(room, client, true)
		case "stop_typing":
			h.broadcastTyping(room, client, false)
		}
	}
}

// handleMessage 메시지 처리
func (h *ChatWSHandler) handleMessage(room *ChatRoom, client *ChatClient, roomID int64, payload interface{}) {
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

	// DB에 저장 (roomID가 meeting.ID)
	message := chatPayload.Message
	chatLog := model.ChatLog{
		MeetingID: roomID,
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
