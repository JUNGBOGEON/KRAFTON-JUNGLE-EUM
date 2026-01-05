package presence

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// PresenceStatus 상태 상수
type PresenceStatus string

const (
	StatusOnline  PresenceStatus = "ONLINE"
	StatusIdle    PresenceStatus = "IDLE"
	StatusDND     PresenceStatus = "DND"
	StatusOffline PresenceStatus = "OFFLINE"
)

// PresenceData Redis에 저장될 상태 데이터
type PresenceData struct {
	UserID             int64          `json:"user_id"`
	Status             PresenceStatus `json:"status"`
	StatusMessage      *string        `json:"status_message,omitempty"`       // 캐싱된 상태 메시지 텍스트
	StatusMessageEmoji *string        `json:"status_message_emoji,omitempty"` // 캐싱된 상태 메시지 이모지
	LastHeartbeat      int64          `json:"last_heartbeat"`
	ServerID           string         `json:"server_id"` // 멀티 서버 확장 대비
}

// Manager Presence 관리자
type Manager struct {
	client *redis.Client
	ctx    context.Context
}

// NewManager 생성자
func NewManager(addr string, password string, db int) *Manager {
	rdb := redis.NewClient(&redis.Options{
		Addr:     addr,
		Password: password,
		DB:       db,
	})

	return &Manager{
		client: rdb,
		ctx:    context.Background(),
	}
}

// Key 생성 유틸
func (m *Manager) getUserKey(userID int64) string {
	return fmt.Sprintf("presence:user:%d", userID)
}

// SetPresence 상태 업데이트 (Connect, Change Status)
func (m *Manager) SetPresence(userID int64, status PresenceStatus, serverID string, message *string, emoji *string) error {
	data := PresenceData{
		UserID:             userID,
		Status:             status,
		LastHeartbeat:      time.Now().Unix(),
		ServerID:           serverID,
		StatusMessage:      message,
		StatusMessageEmoji: emoji,
	}

	jsonData, err := json.Marshal(data)
	if err != nil {
		return err
	}

	// 60초 TTL (Heartbeat는 30초마다)
	return m.client.Set(m.ctx, m.getUserKey(userID), jsonData, 60*time.Second).Err()
}

// UpdateHeartbeat 생존 신고 (TTL 연장)
func (m *Manager) UpdateHeartbeat(userID int64) error {
	// 키가 존재할 때만 Expiration 갱신 (XX 옵션과 유사한 효과를 내기 위해 Expire 사용)
	// 하지만 단순히 값 덮어쓰기가 아니라 TTL만 늘려야 하므로 Expire 사용
	result, err := m.client.Expire(m.ctx, m.getUserKey(userID), 60*time.Second).Result()
	if err != nil {
		return err
	}
	if !result {
		return fmt.Errorf("user %d not found (offline)", userID)
	}
	return nil
}

// RemovePresence 상태 삭제 (Disconnect)
func (m *Manager) RemovePresence(userID int64) error {
	return m.client.Del(m.ctx, m.getUserKey(userID)).Err()
}

// GetPresence 상태 조회
func (m *Manager) GetPresence(userID int64) (*PresenceData, error) {
	val, err := m.client.Get(m.ctx, m.getUserKey(userID)).Result()
	if err == redis.Nil {
		return nil, nil // Offline
	}
	if err != nil {
		return nil, err
	}

	var data PresenceData
	if err := json.Unmarshal([]byte(val), &data); err != nil {
		return nil, err
	}
	return &data, nil
}

// GetMultiPresence 여러 유저 상태 조회 (워크스페이스 멤버 목록 조회용)
func (m *Manager) GetMultiPresence(userIDs []int64) (map[int64]*PresenceData, error) {
	if len(userIDs) == 0 {
		return map[int64]*PresenceData{}, nil
	}

	keys := make([]string, len(userIDs))
	for i, id := range userIDs {
		keys[i] = m.getUserKey(id)
	}

	// MGET으로 한 번에 조회
	results, err := m.client.MGet(m.ctx, keys...).Result()
	if err != nil {
		return nil, err
	}

	presenceMap := make(map[int64]*PresenceData)
	for i, result := range results {
		if result == nil {
			continue // Offline
		}

		strVal, ok := result.(string)
		if !ok {
			continue
		}

		var data PresenceData
		if err := json.Unmarshal([]byte(strVal), &data); err == nil {
			presenceMap[userIDs[i]] = &data
		}
	}

	return presenceMap, nil
}

// PublishPresence 상태 변경 이벤트 발행
func (m *Manager) PublishPresence(data PresenceData) error {
	jsonData, err := json.Marshal(data)
	if err != nil {
		return err
	}
	return m.client.Publish(m.ctx, "presence_updates", jsonData).Err()
}

// SubscribePresence 상태 변경 이벤트 구독 (채널 반환)
func (m *Manager) SubscribePresence() *redis.PubSub {
	return m.client.Subscribe(m.ctx, "presence_updates")
}
