package handler

import (
	"context"
	"encoding/json"
	"log"
	"sync"
	"time"

	"realtime-backend/internal/config"

	"github.com/gofiber/contrib/websocket"
	"github.com/livekit/protocol/livekit"
	lksdk "github.com/livekit/server-sdk-go/v2"
)

// VoiceParticipantsWSHandler 음성 참가자 WebSocket 핸들러
type VoiceParticipantsWSHandler struct {
	clients map[int64]map[*websocket.Conn]bool // workspaceId -> connections
	mu      sync.RWMutex
	cfg     *config.Config
}

// VoiceParticipantWSMessage WebSocket 메시지 타입
type VoiceParticipantWSMessage struct {
	Type    string      `json:"type"` // connected, join, leave, ping, pong
	Payload interface{} `json:"payload,omitempty"`
}

// VoiceParticipantInfo 참가자 정보
type VoiceParticipantInfo struct {
	Identity   string `json:"identity"`
	Name       string `json:"name"`
	ChannelId  string `json:"channelId"`
	ProfileImg string `json:"profileImg,omitempty"`
	JoinedAt   int64  `json:"joinedAt,omitempty"`
}

// ParticipantJoinPayload 참가자 입장 페이로드
type ParticipantJoinPayload struct {
	ChannelId  string `json:"channelId"`
	Identity   string `json:"identity"`
	Name       string `json:"name"`
	ProfileImg string `json:"profileImg,omitempty"`
}

// ParticipantLeavePayload 참가자 퇴장 페이로드
type ParticipantLeavePayload struct {
	ChannelId string `json:"channelId"`
	Identity  string `json:"identity"`
}

// ConnectedPayload 연결 시 초기 데이터
type ConnectedPayload struct {
	Participants map[string][]VoiceParticipantInfo `json:"participants"` // roomName -> participants
}

// 글로벌 인스턴스 (싱글톤)
var voiceParticipantsWSHandler *VoiceParticipantsWSHandler
var voiceParticipantsWSOnce sync.Once

// GetVoiceParticipantsWSHandler 싱글톤 인스턴스 반환
func GetVoiceParticipantsWSHandler() *VoiceParticipantsWSHandler {
	voiceParticipantsWSOnce.Do(func() {
		voiceParticipantsWSHandler = &VoiceParticipantsWSHandler{
			clients: make(map[int64]map[*websocket.Conn]bool),
		}
	})
	return voiceParticipantsWSHandler
}

// NewVoiceParticipantsWSHandler 핸들러 생성
func NewVoiceParticipantsWSHandler(cfg *config.Config) *VoiceParticipantsWSHandler {
	handler := GetVoiceParticipantsWSHandler()
	handler.cfg = cfg
	return handler
}

// HandleWebSocket WebSocket 연결 처리
func (h *VoiceParticipantsWSHandler) HandleWebSocket(c *websocket.Conn) {
	// 패닉 복구 - 어떤 상황에서도 서버가 죽지 않도록
	defer func() {
		if r := recover(); r != nil {
			log.Printf("음성 참가자 WebSocket 패닉 복구: %v", r)
		}
	}()

	// 안전한 type assertion
	workspaceID, ok := c.Locals("workspaceId").(int64)
	if !ok {
		log.Printf("음성 참가자 WebSocket: workspaceId 타입 오류")
		c.Close()
		return
	}
	userID, ok := c.Locals("userId").(int64)
	if !ok {
		log.Printf("음성 참가자 WebSocket: userId 타입 오류")
		c.Close()
		return
	}

	// 클라이언트 등록
	h.mu.Lock()
	if h.clients[workspaceID] == nil {
		h.clients[workspaceID] = make(map[*websocket.Conn]bool)
	}
	h.clients[workspaceID][c] = true
	h.mu.Unlock()

	log.Printf("음성 참가자 WebSocket 연결: workspace=%d, user=%d", workspaceID, userID)

	// 연결 해제 시 정리
	defer func() {
		h.mu.Lock()
		delete(h.clients[workspaceID], c)
		if len(h.clients[workspaceID]) == 0 {
			delete(h.clients, workspaceID)
		}
		h.mu.Unlock()
		c.Close()
		log.Printf("음성 참가자 WebSocket 연결 해제: workspace=%d, user=%d", workspaceID, userID)
	}()

	// 연결 시 현재 참가자 목록 전송
	h.sendInitialParticipants(c, workspaceID)

	// 메시지 수신 루프
	for {
		_, msgBytes, err := c.ReadMessage()
		if err != nil {
			break
		}

		var msg VoiceParticipantWSMessage
		if err := json.Unmarshal(msgBytes, &msg); err != nil {
			continue
		}

		switch msg.Type {
		case "ping":
			pong := VoiceParticipantWSMessage{Type: "pong"}
			pongBytes, _ := json.Marshal(pong)
			c.WriteMessage(websocket.TextMessage, pongBytes)

		case "join":
			// 클라이언트에서 입장 알림을 보내면 다른 클라이언트에게 브로드캐스트
			if payload, ok := msg.Payload.(map[string]interface{}); ok {
				h.broadcastJoin(workspaceID, payload, c)
			}

		case "leave":
			// 클라이언트에서 퇴장 알림을 보내면 다른 클라이언트에게 브로드캐스트
			if payload, ok := msg.Payload.(map[string]interface{}); ok {
				h.broadcastLeave(workspaceID, payload, c)
			}
		}
	}
}

// sendInitialParticipants 연결 시 현재 참가자 목록 전송
func (h *VoiceParticipantsWSHandler) sendInitialParticipants(c *websocket.Conn, workspaceID int64) {
	// 패닉 복구
	defer func() {
		if r := recover(); r != nil {
			log.Printf("초기 참가자 전송 패닉 복구: %v", r)
		}
	}()

	// 연결 상태 확인
	if c == nil {
		log.Printf("WebSocket 연결이 nil입니다")
		return
	}

	if h.cfg == nil {
		log.Printf("Config not set for VoiceParticipantsWSHandler")
		// config가 없어도 빈 목록 전송
		h.sendEmptyParticipants(c)
		return
	}

	// LiveKit 설정 확인
	if h.cfg.LiveKit.Host == "" || h.cfg.LiveKit.APIKey == "" || h.cfg.LiveKit.APISecret == "" {
		log.Printf("LiveKit 설정이 완전하지 않습니다")
		h.sendEmptyParticipants(c)
		return
	}

	// LiveKit RoomService 클라이언트 생성
	roomClient := lksdk.NewRoomServiceClient(
		h.cfg.LiveKit.Host,
		h.cfg.LiveKit.APIKey,
		h.cfg.LiveKit.APISecret,
	)

	// 타임아웃 설정 (5초)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// 워크스페이스의 모든 방 목록 조회
	listRes, err := roomClient.ListRooms(ctx, &livekit.ListRoomsRequest{})
	if err != nil {
		log.Printf("방 목록 조회 실패: %v", err)
		h.sendEmptyParticipants(c)
		return
	}

	result := make(map[string][]VoiceParticipantInfo)

	// 워크스페이스에 해당하는 방만 필터링
	prefix := "workspace-" + intToString(workspaceID) + "-"

	for _, room := range listRes.Rooms {
		if room == nil || !hasPrefix(room.Name, prefix) {
			continue
		}

		// 방의 참가자 조회
		participantsRes, err := roomClient.ListParticipants(ctx, &livekit.ListParticipantsRequest{
			Room: room.Name,
		})
		if err != nil {
			result[room.Name] = []VoiceParticipantInfo{}
			continue
		}

		if participantsRes == nil {
			result[room.Name] = []VoiceParticipantInfo{}
			continue
		}

		participants := make([]VoiceParticipantInfo, 0, len(participantsRes.Participants))
		for _, p := range participantsRes.Participants {
			if p == nil {
				continue
			}
			var metadata ParticipantMetadata
			if p.Metadata != "" {
				json.Unmarshal([]byte(p.Metadata), &metadata)
			}

			participants = append(participants, VoiceParticipantInfo{
				Identity:   p.Identity,
				Name:       p.Name,
				ChannelId:  room.Name,
				ProfileImg: metadata.ProfileImg,
				JoinedAt:   p.JoinedAt,
			})
		}
		result[room.Name] = participants
	}

	// 초기 데이터 전송
	msg := VoiceParticipantWSMessage{
		Type: "connected",
		Payload: ConnectedPayload{
			Participants: result,
		},
	}

	msgBytes, err := json.Marshal(msg)
	if err != nil {
		log.Printf("초기 참가자 목록 직렬화 실패: %v", err)
		return
	}

	if err := c.WriteMessage(websocket.TextMessage, msgBytes); err != nil {
		log.Printf("초기 참가자 목록 전송 실패: %v", err)
	}
}

// sendEmptyParticipants 빈 참가자 목록 전송
func (h *VoiceParticipantsWSHandler) sendEmptyParticipants(c *websocket.Conn) {
	msg := VoiceParticipantWSMessage{
		Type: "connected",
		Payload: ConnectedPayload{
			Participants: make(map[string][]VoiceParticipantInfo),
		},
	}
	msgBytes, err := json.Marshal(msg)
	if err != nil {
		return
	}
	c.WriteMessage(websocket.TextMessage, msgBytes)
}

// broadcastJoin 참가자 입장 브로드캐스트 (보낸 클라이언트 제외)
func (h *VoiceParticipantsWSHandler) broadcastJoin(workspaceID int64, payload map[string]interface{}, sender *websocket.Conn) {
	msg := VoiceParticipantWSMessage{
		Type:    "join",
		Payload: payload,
	}
	h.broadcastToWorkspace(workspaceID, msg, sender)
}

// broadcastLeave 참가자 퇴장 브로드캐스트 (보낸 클라이언트 제외)
func (h *VoiceParticipantsWSHandler) broadcastLeave(workspaceID int64, payload map[string]interface{}, sender *websocket.Conn) {
	msg := VoiceParticipantWSMessage{
		Type:    "leave",
		Payload: payload,
	}
	h.broadcastToWorkspace(workspaceID, msg, sender)
}

// BroadcastParticipantJoin 외부에서 호출 가능한 입장 브로드캐스트
func (h *VoiceParticipantsWSHandler) BroadcastParticipantJoin(workspaceID int64, payload ParticipantJoinPayload) {
	msg := VoiceParticipantWSMessage{
		Type:    "join",
		Payload: payload,
	}
	h.broadcastToWorkspace(workspaceID, msg, nil)
}

// BroadcastParticipantLeave 외부에서 호출 가능한 퇴장 브로드캐스트
func (h *VoiceParticipantsWSHandler) BroadcastParticipantLeave(workspaceID int64, payload ParticipantLeavePayload) {
	msg := VoiceParticipantWSMessage{
		Type:    "leave",
		Payload: payload,
	}
	h.broadcastToWorkspace(workspaceID, msg, nil)
}

// broadcastToWorkspace 워크스페이스의 모든 클라이언트에 브로드캐스트
func (h *VoiceParticipantsWSHandler) broadcastToWorkspace(workspaceID int64, msg VoiceParticipantWSMessage, exclude *websocket.Conn) {
	// 패닉 복구
	defer func() {
		if r := recover(); r != nil {
			log.Printf("브로드캐스트 패닉 복구: %v", r)
		}
	}()

	msgBytes, err := json.Marshal(msg)
	if err != nil {
		log.Printf("메시지 직렬화 실패: %v", err)
		return
	}

	h.mu.RLock()
	connections := h.clients[workspaceID]
	if len(connections) == 0 {
		h.mu.RUnlock()
		return
	}

	// 연결 목록 복사 (락을 빨리 해제하기 위해)
	connList := make([]*websocket.Conn, 0, len(connections))
	for conn := range connections {
		if conn != exclude {
			connList = append(connList, conn)
		}
	}
	h.mu.RUnlock()

	// 복사된 목록으로 브로드캐스트
	for _, conn := range connList {
		if conn == nil {
			continue
		}
		if err := conn.WriteMessage(websocket.TextMessage, msgBytes); err != nil {
			log.Printf("음성 참가자 브로드캐스트 실패: %v", err)
		}
	}
}

// GetConnectedCount 연결된 클라이언트 수 반환
func (h *VoiceParticipantsWSHandler) GetConnectedCount(workspaceID int64) int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients[workspaceID])
}

// 헬퍼 함수: int64를 문자열로 변환
func intToString(n int64) string {
	if n == 0 {
		return "0"
	}
	var result []byte
	negative := n < 0
	if negative {
		n = -n
	}
	for n > 0 {
		result = append([]byte{byte('0' + n%10)}, result...)
		n /= 10
	}
	if negative {
		result = append([]byte{'-'}, result...)
	}
	return string(result)
}

// 헬퍼 함수: 문자열 prefix 확인
func hasPrefix(s, prefix string) bool {
	if len(s) < len(prefix) {
		return false
	}
	return s[:len(prefix)] == prefix
}
