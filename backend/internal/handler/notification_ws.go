package handler

import (
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/gofiber/contrib/websocket"
	"gorm.io/gorm"

	"realtime-backend/internal/model"
	"realtime-backend/internal/presence"
)

// NotificationWSHandler 알림 WebSocket 핸들러
type NotificationWSHandler struct {
	clients         map[int64]map[*websocket.Conn]bool // userID -> connections
	subscriptions   map[int64]map[int64]bool           // targetUserID -> set of subscriberUserIDs
	presenceManager *presence.Manager
	db              *gorm.DB

	mu    sync.RWMutex // clients 보호용
	subMu sync.RWMutex // subscriptions 보호용
}

// NotificationWSMessage 알림 WebSocket 메시지
type NotificationWSMessage struct {
	Type    string      `json:"type"` // notification, ping, pong, heartbeat, change_status
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
	return notificationWSHandler
}

// NewNotificationWSHandler NotificationWSHandler 생성 및 초기화
func NewNotificationWSHandler(db *gorm.DB, pm *presence.Manager) *NotificationWSHandler {
	notificationWSOnce.Do(func() {
		notificationWSHandler = &NotificationWSHandler{
			clients:         make(map[int64]map[*websocket.Conn]bool),
			subscriptions:   make(map[int64]map[int64]bool),
			presenceManager: pm,
			db:              db,
		}

		// Redis Pub/Sub 리스너 시작
		if pm != nil {
			go notificationWSHandler.listenPresenceUpdates()
		}
	})
	return notificationWSHandler
}

// listenPresenceUpdates Redis로부터 상태 변경 이벤트 수신 및 브로드캐스트
func (h *NotificationWSHandler) listenPresenceUpdates() {
	pubsub := h.presenceManager.SubscribePresence()
	defer pubsub.Close()

	ch := pubsub.Channel()
	for msg := range ch {
		var data presence.PresenceData
		if err := json.Unmarshal([]byte(msg.Payload), &data); err != nil {
			log.Printf("Presence update unmarshal error: %v", err)
			continue
		}

		h.broadcastPresenceUpdate(data)
	}
}

// broadcastPresenceUpdate 구독자들에게 상태 변경 전송
func (h *NotificationWSHandler) broadcastPresenceUpdate(data presence.PresenceData) {
	h.subMu.RLock()
	subscribers := h.subscriptions[data.UserID]

	// 구독자가 없으면 복사하지 않고 종료
	if len(subscribers) == 0 {
		h.subMu.RUnlock()
		return
	}

	// 구독자 목록 복사 (데드락 방지)
	targetUserIDs := make([]int64, 0, len(subscribers))
	for userID := range subscribers {
		targetUserIDs = append(targetUserIDs, userID)
	}
	h.subMu.RUnlock()

	msg := NotificationWSMessage{
		Type:    "presence_update",
		Payload: data,
	}

	msgBytes, _ := json.Marshal(msg)

	h.mu.RLock()
	defer h.mu.RUnlock()

	for _, userID := range targetUserIDs {
		if conns, ok := h.clients[userID]; ok {
			for conn := range conns {
				conn.WriteMessage(websocket.TextMessage, msgBytes)
			}
		}
	}
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

	// Presence: Online 설정 (DB에서 커스텀 상태 조회)
	if h.presenceManager != nil {
		status := presence.StatusOnline
		var statusMsg *string
		var statusEmoji *string

		// DB에서 사용자 조회 (커스텀 상태 확인)
		if h.db != nil {
			var user model.User
			if err := h.db.Select("default_status, custom_status_text, custom_status_emoji").First(&user, userID).Error; err == nil {
				if user.DefaultStatus != "" {
					status = presence.PresenceStatus(user.DefaultStatus)
				}
				if user.CustomStatusText != nil && *user.CustomStatusText != "" {
					statusMsg = user.CustomStatusText
				}
				if user.CustomStatusEmoji != nil && *user.CustomStatusEmoji != "" {
					statusEmoji = user.CustomStatusEmoji
				}
			}
		}

		// Redis에 초기 상태 설정 (DB 값 포함)
		if err := h.presenceManager.SetPresence(userID, status, "server-1", statusMsg, statusEmoji); err != nil {
			log.Printf("Presence 설정 실패: %v", err)
		}

		// 연결 직후 브로드캐스트 (내 상태를 다른 사람들에게 알림)
		data := presence.PresenceData{
			UserID:             userID,
			Status:             status,
			LastHeartbeat:      time.Now().Unix(),
			ServerID:           "server-1",
			StatusMessage:      statusMsg,
			StatusMessageEmoji: statusEmoji,
		}
		h.presenceManager.PublishPresence(data)
	}

	log.Printf("알림 WebSocket 연결: user=%d", userID)

	// 연결 해제 시 정리
	defer func() {
		h.mu.Lock()
		delete(h.clients[userID], c)
		if len(h.clients[userID]) == 0 {
			delete(h.clients, userID)
			// 마지막 연결이 끊기면 Offline 처리
			if h.presenceManager != nil {
				h.presenceManager.RemovePresence(userID)
				// FIX: Broadcast offline status
				offData := presence.PresenceData{
					UserID:   userID,
					Status:   presence.StatusOffline,
					ServerID: "server-1",
				}
				h.presenceManager.PublishPresence(offData)
			}
		}
		h.mu.Unlock()
		c.Close()
		log.Printf("알림 WebSocket 연결 해제: user=%d", userID)
	}()

	// 연결 유지를 위한 ping/pong 및 Presence 처리
	for {
		_, msgBytes, err := c.ReadMessage()
		if err != nil {
			break
		}

		var msg NotificationWSMessage
		if err := json.Unmarshal(msgBytes, &msg); err != nil {
			continue
		}

		switch msg.Type {
		case "ping":
			pong := NotificationWSMessage{Type: "pong"}
			pongBytes, _ := json.Marshal(pong)
			c.WriteMessage(websocket.TextMessage, pongBytes)

		case "heartbeat":
			// 생존 신고 (TTL 연장)
			if h.presenceManager != nil {
				h.presenceManager.UpdateHeartbeat(userID)
			}

		case "change_status":
			// 상태 변경 요청 (online, idle, dnd, offline)
			if h.presenceManager != nil {
				if payloadMap, ok := msg.Payload.(map[string]interface{}); ok {
					if statusStr, ok := payloadMap["status"].(string); ok {
						// 대소문자 통일 (일단 그대로 사용하되, 필요시 strings.ToUpper 사용)
						// 프론트엔드에서 "online" 등을 보내므로, DB 저장 시에도 동일하게 저장하거나
						// Redis 상수와 맞추는 작업 필요. 여기서는 그대로 둠.

						// FIX: 퍼시스턴스 (DB 업데이트)
						if h.db != nil {
							// default_status 컬럼 업데이트
							if err := h.db.Model(&model.User{}).Where("id = ?", userID).Update("default_status", statusStr).Error; err != nil {
								log.Printf("DB Status update failed: %v", err)
							}
						}

						// 기존 커스텀 메시지 유지를 위해 현재 상태 조회
						var currentMsg *string
						var currentEmoji *string
						if cached, err := h.presenceManager.GetPresence(userID); err == nil && cached != nil {
							currentMsg = cached.StatusMessage
							currentEmoji = cached.StatusMessageEmoji
						}

						status := presence.PresenceStatus(statusStr)
						// Update Redis with preserved message/emoji
						h.presenceManager.SetPresence(userID, status, "server-1", currentMsg, currentEmoji)

						// 변경된 상태 전파
						data := presence.PresenceData{
							UserID:             userID,
							Status:             status,
							LastHeartbeat:      time.Now().Unix(),
							ServerID:           "server-1",
							StatusMessage:      currentMsg,
							StatusMessageEmoji: currentEmoji,
						}
						h.presenceManager.PublishPresence(data)
					}
				}
			}

		case "change_status_message":
			// 커스텀 상태 메시지 변경 요청 (text, emoji)
			if h.presenceManager != nil {
				if payloadMap, ok := msg.Payload.(map[string]interface{}); ok {
					text, _ := payloadMap["text"].(string)
					emoji, _ := payloadMap["emoji"].(string)

					// DB 업데이트
					if h.db != nil {
						updates := map[string]interface{}{
							"custom_status_text":  text,
							"custom_status_emoji": emoji,
						}
						// expires_at 등은 추후 구현
						if err := h.db.Model(&model.User{}).Where("id = ?", userID).Updates(updates).Error; err != nil {
							log.Printf("DB Custom Status update failed: %v", err)
						}
					}

					// Redis Pub/Sub 전파
					// 현재 PresenceData 구조체에 Message 필드가 없어서 추가 필요할 수 있음
					// 하지만 임시로 SetPresence는 status만 다루므로,
					// PublishPresence 할 때 데이터를 풍부하게 만들어서 보냄.

					// Redis 상태 업데이트 & 전파
					// 현재 상태(Online/Idle 등) 가져오기
					currentStatus := presence.StatusOnline // 기본값
					if cached, err := h.presenceManager.GetPresence(userID); err == nil && cached != nil {
						currentStatus = cached.Status
					}

					// Redis 업데이트 (새로운 메시지/이모지 반영)
					h.presenceManager.SetPresence(userID, currentStatus, "server-1", &text, &emoji)

					data := presence.PresenceData{
						UserID:             userID,
						Status:             currentStatus,
						LastHeartbeat:      time.Now().Unix(),
						ServerID:           "server-1",
						StatusMessage:      &text,
						StatusMessageEmoji: &emoji,
					}
					// 만약 PresenceData에 StatusMessage 필드가 없다면 지금은 무시됨.
					// redis.go 파일의 PresenceData 구조체 확인 필요.
					// 아까 redis.go 봤을 때 StatusMessage 필드 있었음 (*string)

					h.presenceManager.PublishPresence(data)
				}
			}

		case "subscribe_presence":
			// 특정 유저들의 상태 구독 요청 & 초기 상태 동기화 (Sync)
			if payloadMap, ok := msg.Payload.(map[string]interface{}); ok {
				if userIDsInterface, ok := payloadMap["user_ids"].([]interface{}); ok {
					var targetIDs []int64
					h.subMu.Lock()
					for _, uVal := range userIDsInterface {
						if uidFloat, ok := uVal.(float64); ok {
							targetID := int64(uidFloat)
							if h.subscriptions[targetID] == nil {
								h.subscriptions[targetID] = make(map[int64]bool)
							}
							h.subscriptions[targetID][userID] = true
							targetIDs = append(targetIDs, targetID)
						}
					}
					h.subMu.Unlock()

					// FIX: Send current status of these users immediately (Bulk Sync)
					if len(targetIDs) > 0 {
						presenceMap, err := h.presenceManager.GetMultiPresence(targetIDs)
						if err == nil {
							syncMsg := NotificationWSMessage{
								Type:    "presence_state_sync",
								Payload: presenceMap,
							}
							syncBytes, _ := json.Marshal(syncMsg)
							c.WriteMessage(websocket.TextMessage, syncBytes)
						}
					}
				}
			}
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
