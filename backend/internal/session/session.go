package session

import (
	"context"
	"sync"
	"time"

	"github.com/google/uuid"

	"realtime-backend/internal/model"
)

// State WebSocket 연결 상태
type State int

const (
	StateAwaitingHeader State = iota // 헤더 수신 대기
	StateReceivingAudio              // 오디오 수신 중
	StateClosed                      // 연결 종료
)

// String 상태를 문자열로 반환
func (s State) String() string {
	switch s {
	case StateAwaitingHeader:
		return "awaiting_header"
	case StateReceivingAudio:
		return "receiving_audio"
	case StateClosed:
		return "closed"
	default:
		return "unknown"
	}
}

// TranscriptMessage 자막 메시지
type TranscriptMessage struct {
	Type          string `json:"type"`
	ParticipantID string `json:"participantId"` // 발화자 식별 ID
	Text          string `json:"text"`          // 번역된 텍스트 (하위 호환)
	Original      string `json:"original"`      // 원본 STT 텍스트
	Translated    string `json:"translated"`    // 번역된 텍스트
	Language      string `json:"language"`      // 번역 대상 언어 (ko, en, ja, zh)
	IsFinal       bool   `json:"isFinal"`
}

// Session 클라이언트 세션 (Thread-Safe)
type Session struct {
	ID            string
	State         State
	Metadata      *model.AudioMetadata
	ConnectedAt   time.Time
	AudioBytes    int64
	PacketCount   uint64
	Language      string // 번역 대상 언어 (ko, en, ja, zh)
	ParticipantID string // 발화자 식별 ID (원격 참가자의 identity)

	// 동시성 제어
	mu sync.RWMutex

	// 비동기 처리
	AudioPackets chan *model.AudioPacket
	ctx          context.Context
	cancel       context.CancelFunc

	// 에코 응답용 채널
	EchoPackets chan []byte

	// 자막(Transcript) 전송용 채널
	TranscriptChan chan *TranscriptMessage
}

// New 새 세션 생성
func New(bufferSize int) *Session {
	ctx, cancel := context.WithCancel(context.Background())

	return &Session{
		ID:             uuid.New().String(),
		State:          StateAwaitingHeader,
		ConnectedAt:    time.Now(),
		AudioPackets:   make(chan *model.AudioPacket, bufferSize),
		EchoPackets:    make(chan []byte, bufferSize),
		TranscriptChan: make(chan *TranscriptMessage, 50), // 자막 버퍼
		ctx:            ctx,
		cancel:         cancel,
	}
}

// Context 세션 컨텍스트 반환
func (s *Session) Context() context.Context {
	return s.ctx
}

// SetMetadata 메타데이터 설정 및 상태 전환
func (s *Session) SetMetadata(metadata *model.AudioMetadata) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.Metadata = metadata
	s.State = StateReceivingAudio
}

// GetMetadata 메타데이터 조회
func (s *Session) GetMetadata() *model.AudioMetadata {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return s.Metadata
}

// SetLanguage 번역 대상 언어 설정
func (s *Session) SetLanguage(lang string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.Language = lang
}

// GetLanguage 번역 대상 언어 조회
func (s *Session) GetLanguage() string {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.Language == "" {
		return "en" // 기본값: 영어
	}
	return s.Language
}

// SetParticipantID 발화자 식별 ID 설정
func (s *Session) SetParticipantID(participantID string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.ParticipantID = participantID
}

// GetParticipantID 발화자 식별 ID 조회
func (s *Session) GetParticipantID() string {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return s.ParticipantID
}

// GetState 현재 상태 조회
func (s *Session) GetState() State {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return s.State
}

// IncrementPacketCount 패킷 카운트 증가
func (s *Session) IncrementPacketCount() uint64 {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.PacketCount++
	return s.PacketCount
}

// AddAudioBytes 오디오 바이트 수 증가
func (s *Session) AddAudioBytes(n int64) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.AudioBytes += n
}

// GetStats 통계 조회
func (s *Session) GetStats() (packetCount uint64, audioBytes int64) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return s.PacketCount, s.AudioBytes
}

// Duration 연결 유지 시간
func (s *Session) Duration() time.Duration {
	return time.Since(s.ConnectedAt)
}

// Close 세션 정리
func (s *Session) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.State == StateClosed {
		return
	}

	s.State = StateClosed
	s.cancel()
	close(s.AudioPackets)
	close(s.EchoPackets)
	close(s.TranscriptChan)
}

// IsClosed 세션 종료 여부 확인
func (s *Session) IsClosed() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return s.State == StateClosed
}
