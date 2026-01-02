package handler

import (
	"encoding/json"
	"log"
	"sync"

	"github.com/gofiber/contrib/websocket"
)

// NotificationWSHandler 알림 WebSocket 핸들러
type NotificationWSHandler struct {
	clients map[int64]map[*websocket.Conn]bool // userID -> connections
	mu      sync.RWMutex
}

// NotificationWSMessage 알림 WebSocket 메시지
type NotificationWSMessage struct {
	Type    string      `json:"type"` // notification, ping, pong
	Payload interface{} `json:"payload,omitempty"`
}

// NotificationPayload 알림 페이로드
type NotificationPayload struct {
	ID          int64         `json:"id"`
	Type        string        `json:"type"`
	Content     string        `json:"content"`
	IsRead      bool          `json:"is_read"`
	RelatedType *string       `json:"related_type,omitempty"`
	RelatedID   *int64        `json:"related_id,omitempty"`
	CreatedAt   string        `json:"created_at"`
	Sender      *UserResponse `json:"sender,omitempty"`
}

// 글로벌 인스턴스 (싱글톤)
var notificationWSHandler *NotificationWSHandler
var notificationWSOnce sync.Once

// GetNotificationWSHandler 싱글톤 인스턴스 반환
func GetNotificationWSHandler() *NotificationWSHandler {
	notificationWSOnce.Do(func() {
		notificationWSHandler = &NotificationWSHandler{
			clients: make(map[int64]map[*websocket.Conn]bool),
		}
	})
	return notificationWSHandler
}

// NewNotificationWSHandler NotificationWSHandler 생성
func NewNotificationWSHandler() *NotificationWSHandler {
	return GetNotificationWSHandler()
}

// HandleWebSocket WebSocket 연결 처리
func (h *NotificationWSHandler) HandleWebSocket(c *websocket.Conn) {
	// 패닉 복구 - 서버 크래시 방지
	defer func() {
		if r := recover(); r != nil {
			log.Printf("알림 WebSocket 패닉 복구: %v", r)
		}
	}()

	userIDInterface := c.Locals("userId")
	userID, ok := userIDInterface.(int64)
	if !ok {
		c.WriteMessage(websocket.TextMessage, []byte(`{"type":"error","message":"invalid session"}`))
		c.Close()
		return
	}

	// 클라이언트 등록
	h.mu.Lock()
	if h.clients[userID] == nil {
		h.clients[userID] = make(map[*websocket.Conn]bool)
	}
	h.clients[userID][c] = true
	h.mu.Unlock()

	log.Printf("알림 WebSocket 연결: user=%d", userID)

	// 연결 해제 시 정리
	defer func() {
		h.mu.Lock()
		delete(h.clients[userID], c)
		if len(h.clients[userID]) == 0 {
			delete(h.clients, userID)
		}
		h.mu.Unlock()
		c.Close()
		log.Printf("알림 WebSocket 연결 해제: user=%d", userID)
	}()

	// 연결 유지를 위한 ping/pong 처리
	for {
		_, msgBytes, err := c.ReadMessage()
		if err != nil {
			break
		}

		var msg NotificationWSMessage
		if err := json.Unmarshal(msgBytes, &msg); err != nil {
			continue
		}

		// ping 메시지에 pong 응답
		if msg.Type == "ping" {
			pong := NotificationWSMessage{Type: "pong"}
			pongBytes, _ := json.Marshal(pong)
			c.WriteMessage(websocket.TextMessage, pongBytes)
		}
	}
}

// SendToUser 특정 사용자에게 알림 전송
func (h *NotificationWSHandler) SendToUser(userID int64, notification NotificationPayload) {
	h.mu.RLock()
	connections := h.clients[userID]
	h.mu.RUnlock()

	if len(connections) == 0 {
		return
	}

	msg := NotificationWSMessage{
		Type:    "notification",
		Payload: notification,
	}

	msgBytes, err := json.Marshal(msg)
	if err != nil {
		log.Printf("알림 직렬화 실패: %v", err)
		return
	}

	h.mu.RLock()
	defer h.mu.RUnlock()

	for conn := range h.clients[userID] {
		if err := conn.WriteMessage(websocket.TextMessage, msgBytes); err != nil {
			log.Printf("알림 전송 실패: user=%d, err=%v", userID, err)
		}
	}
}

// GetConnectedUsers 연결된 사용자 수 반환
func (h *NotificationWSHandler) GetConnectedUsers() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}
