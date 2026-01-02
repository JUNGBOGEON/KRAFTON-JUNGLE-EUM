package ai

import (
	"context"
	"io"
	"log"
	"sync"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/keepalive"

	"realtime-backend/pb"
)

const (
	// 채널 버퍼 크기
	SendChannelSize = 100
	RecvChannelSize = 100

	// gRPC 연결 설정
	MaxRetries       = 3
	RetryBackoff     = time.Second
	KeepAliveTime    = 10 * time.Second
	KeepAliveTimeout = 5 * time.Second
	MaxRecvMsgSize   = 4 * 1024 * 1024 // 4MB
	MaxSendMsgSize   = 4 * 1024 * 1024 // 4MB
)

// GrpcClient Python AI 서버와 통신하는 gRPC 클라이언트
type GrpcClient struct {
	conn   *grpc.ClientConn
	client pb.ConversationServiceClient
	addr   string
}

// TranscriptMessage STT/번역 결과 메시지
type TranscriptMessage struct {
	ID               string
	Speaker          *pb.SpeakerInfo
	OriginalText     string
	OriginalLanguage string
	Translations     []*pb.TranslationEntry
	IsPartial        bool
	IsFinal          bool
	TimestampMs      uint64
	Confidence       float32
}

// AudioMessage TTS 오디오 메시지
type AudioMessage struct {
	TranscriptID         string
	TargetLanguage       string
	TargetParticipantIDs []string
	AudioData            []byte
	Format               string
	SampleRate           uint32
	DurationMs           uint32
	SpeakerParticipantID string
}

// ChatStream 양방향 스트리밍을 위한 채널 묶음
type ChatStream struct {
	SendChan       chan<- []byte            // 오디오 전송용
	RecvChan       <-chan []byte            // 오디오 수신용 (레거시 호환)
	TranscriptChan <-chan *TranscriptMessage // STT/번역 결과
	AudioChan      <-chan *AudioMessage      // TTS 오디오 (타겟별)
	ErrChan        <-chan error              // 에러 수신용
	Cancel         context.CancelFunc
}

// ParticipantConfig 참가자 설정
type ParticipantConfig struct {
	ParticipantID      string
	Nickname           string
	ProfileImg         string
	TargetLanguage     string
	TranslationEnabled bool
}

// SpeakerConfig 발화자 설정
type SpeakerConfig struct {
	ParticipantID  string
	Nickname       string
	ProfileImg     string
	SourceLanguage string
}

// SessionConfig 세션 설정 정보
type SessionConfig struct {
	SampleRate     uint32
	Channels       uint32
	BitsPerSample  uint32
	SourceLanguage string              // 발화자 언어 (ko, en, ja, zh)
	Participants   []ParticipantConfig // 회의실 참가자 목록
	Speaker        *SpeakerConfig      // 발화자 정보
}

// NewGrpcClient 새 gRPC 클라이언트 생성 및 연결
func NewGrpcClient(addr string) (*GrpcClient, error) {
	// gRPC 연결 옵션
	opts := []grpc.DialOption{
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithDefaultCallOptions(
			grpc.MaxCallRecvMsgSize(MaxRecvMsgSize),
			grpc.MaxCallSendMsgSize(MaxSendMsgSize),
		),
		grpc.WithKeepaliveParams(keepalive.ClientParameters{
			Time:                KeepAliveTime,
			Timeout:             KeepAliveTimeout,
			PermitWithoutStream: true,
		}),
	}

	// 연결 시도 (재시도 로직 포함)
	var conn *grpc.ClientConn
	var err error

	for i := 0; i < MaxRetries; i++ {
		conn, err = grpc.NewClient(addr, opts...)
		if err == nil {
			break
		}
		log.Printf("⚠️ gRPC connection attempt %d failed: %v", i+1, err)
		time.Sleep(RetryBackoff * time.Duration(i+1))
	}

	if err != nil {
		return nil, err
	}

	return &GrpcClient{
		conn:   conn,
		client: pb.NewConversationServiceClient(conn),
		addr:   addr,
	}, nil
}

// Close 연결 종료
func (c *GrpcClient) Close() error {
	if c.conn != nil {
		return c.conn.Close()
	}
	return nil
}

// StartChatStream 양방향 스트리밍 시작
func (c *GrpcClient) StartChatStream(ctx context.Context, sessionID, roomID string, config *SessionConfig) (*ChatStream, error) {
	// 취소 가능한 컨텍스트 생성
	streamCtx, cancel := context.WithCancel(ctx)

	// gRPC 스트림 생성
	stream, err := c.client.StreamChat(streamCtx)
	if err != nil {
		cancel()
		return nil, err
	}

	// SessionInit 메시지 전송 (스트림 시작 시)
	if config != nil {
		// 참가자 목록 변환
		participants := make([]*pb.ParticipantInfo, len(config.Participants))
		for i, p := range config.Participants {
			participants[i] = &pb.ParticipantInfo{
				ParticipantId:      p.ParticipantID,
				Nickname:           p.Nickname,
				ProfileImg:         p.ProfileImg,
				TargetLanguage:     p.TargetLanguage,
				TranslationEnabled: p.TranslationEnabled,
			}
		}

		// 발화자 정보 변환
		var speaker *pb.SpeakerInfo
		if config.Speaker != nil {
			speaker = &pb.SpeakerInfo{
				ParticipantId:  config.Speaker.ParticipantID,
				Nickname:       config.Speaker.Nickname,
				ProfileImg:     config.Speaker.ProfileImg,
				SourceLanguage: config.Speaker.SourceLanguage,
			}
		}

		initReq := &pb.ChatRequest{
			SessionId:     sessionID,
			RoomId:        roomID,
			ParticipantId: config.Speaker.ParticipantID,
			Payload: &pb.ChatRequest_SessionInit{
				SessionInit: &pb.SessionInit{
					SampleRate:     config.SampleRate,
					Channels:       config.Channels,
					BitsPerSample:  config.BitsPerSample,
					SourceLanguage: config.SourceLanguage,
					Participants:   participants,
					Speaker:        speaker,
				},
			},
		}
		if err := stream.Send(initReq); err != nil {
			cancel()
			return nil, err
		}
		log.Printf("📤 [%s] SessionInit sent: srcLang=%s, participants=%d, rate=%d",
			sessionID, config.SourceLanguage, len(participants), config.SampleRate)
	}

	// 채널 생성
	sendChan := make(chan []byte, SendChannelSize)
	recvChan := make(chan []byte, RecvChannelSize)           // 레거시 호환
	transcriptChan := make(chan *TranscriptMessage, 50)       // STT/번역 결과
	audioChan := make(chan *AudioMessage, RecvChannelSize)    // TTS 오디오
	errChan := make(chan error, 1)

	var wg sync.WaitGroup
	wg.Add(2)

	// Send Routine: 채널 → gRPC
	go func() {
		defer wg.Done()
		defer stream.CloseSend()

		participantID := ""
		if config != nil && config.Speaker != nil {
			participantID = config.Speaker.ParticipantID
		}

		for {
			select {
			case <-streamCtx.Done():
				log.Printf("ℹ️ [%s] Send routine: context cancelled", sessionID)
				return

			case data, ok := <-sendChan:
				if !ok {
					log.Printf("ℹ️ [%s] Send routine: channel closed", sessionID)
					return
				}

				// ChatRequest로 패키징
				req := &pb.ChatRequest{
					SessionId:     sessionID,
					RoomId:        roomID,
					ParticipantId: participantID,
					Payload: &pb.ChatRequest_AudioChunk{
						AudioChunk: data,
					},
				}

				if err := stream.Send(req); err != nil {
					if err != io.EOF {
						log.Printf("❌ [%s] gRPC send error: %v", sessionID, err)
						select {
						case errChan <- err:
						default:
						}
					}
					return
				}
			}
		}
	}()

	// Recv Routine: gRPC → 채널
	go func() {
		defer wg.Done()
		defer close(recvChan)
		defer close(transcriptChan)
		defer close(audioChan)

		for {
			resp, err := stream.Recv()
			if err != nil {
				if err == io.EOF {
					log.Printf("ℹ️ [%s] gRPC stream ended (EOF)", sessionID)
				} else {
					select {
					case <-streamCtx.Done():
						// 컨텍스트 취소로 인한 종료
					default:
						log.Printf("❌ [%s] gRPC recv error: %v", sessionID, err)
						select {
						case errChan <- err:
						default:
						}
					}
				}
				return
			}

			// 응답 타입별 처리
			switch payload := resp.Payload.(type) {
			case *pb.ChatResponse_Transcript:
				// STT + 번역 결과
				tr := payload.Transcript
				msg := &TranscriptMessage{
					ID:               tr.Id,
					Speaker:          tr.Speaker,
					OriginalText:     tr.OriginalText,
					OriginalLanguage: tr.OriginalLanguage,
					Translations:     tr.Translations,
					IsPartial:        tr.IsPartial,
					IsFinal:          tr.IsFinal,
					TimestampMs:      tr.TimestampMs,
					Confidence:       tr.Confidence,
				}

				select {
				case transcriptChan <- msg:
				default:
					log.Printf("⚠️ [%s] Transcript channel full, dropping", sessionID)
				}

				// Latency tracking
				now := time.Now().UnixMilli()
				latencyMs := int64(0)
				if tr.TimestampMs > 0 {
					latencyMs = now - int64(tr.TimestampMs)
				}

				if tr.IsPartial {
					log.Printf("🗣️ [%s] STT Partial: %s (latency: %dms)", sessionID, tr.OriginalText, latencyMs)
				} else if tr.IsFinal {
					transInfo := ""
					for _, t := range tr.Translations {
						transInfo += t.TargetLanguage + ":" + t.TranslatedText[:min(20, len(t.TranslatedText))] + "... "
					}
					log.Printf("✅ [%s] STT Final: '%s' → [%s] (conf: %.2f, latency: %dms)",
						sessionID, tr.OriginalText, transInfo, tr.Confidence, latencyMs)
				}

			case *pb.ChatResponse_Audio:
				// TTS 오디오 응답
				audio := payload.Audio
				msg := &AudioMessage{
					TranscriptID:         audio.TranscriptId,
					TargetLanguage:       audio.TargetLanguage,
					TargetParticipantIDs: audio.TargetParticipantIds,
					AudioData:            audio.AudioData,
					Format:               audio.Format,
					SampleRate:           audio.SampleRate,
					DurationMs:           audio.DurationMs,
					SpeakerParticipantID: audio.SpeakerParticipantId,
				}

				select {
				case audioChan <- msg:
				default:
					log.Printf("⚠️ [%s] Audio channel full, dropping TTS audio", sessionID)
				}

				// 레거시 호환: recvChan에도 오디오 데이터 전송
				select {
				case recvChan <- audio.AudioData:
				default:
				}

				log.Printf("🔊 [%s] TTS Audio: lang=%s, format=%s, targets=%v, size=%d bytes",
					sessionID, audio.TargetLanguage, audio.Format,
					audio.TargetParticipantIds, len(audio.AudioData))

			case *pb.ChatResponse_Error:
				// 에러 응답
				errResp := payload.Error
				log.Printf("❌ [%s] Error from AI server: code=%s, msg=%s, details=%s",
					sessionID, errResp.Code, errResp.Message, errResp.Details)

			case *pb.ChatResponse_Status:
				// 세션 상태 업데이트
				status := payload.Status
				log.Printf("📊 [%s] Session status: %s - %s", sessionID, status.Status, status.Message)
				if status.BufferingStrategy != nil {
					log.Printf("📊 [%s] Buffering: src=%s, strategy=%s",
						sessionID, status.BufferingStrategy.SourceLanguage, status.BufferingStrategy.Strategy)
				}
			}
		}
	}()

	// 정리 고루틴
	go func() {
		wg.Wait()
		close(errChan)
		log.Printf("📤 [%s] ChatStream goroutines terminated", sessionID)
	}()

	return &ChatStream{
		SendChan:       sendChan,
		RecvChan:       recvChan,
		TranscriptChan: transcriptChan,
		AudioChan:      audioChan,
		ErrChan:        errChan,
		Cancel:         cancel,
	}, nil
}

// UpdateParticipantSettings 참가자 설정 업데이트 (타겟 언어 변경 등)
func (c *GrpcClient) UpdateParticipantSettings(ctx context.Context, roomID, participantID, targetLanguage string, translationEnabled bool) error {
	req := &pb.ParticipantSettingsRequest{
		RoomId:             roomID,
		ParticipantId:      participantID,
		TargetLanguage:     targetLanguage,
		TranslationEnabled: translationEnabled,
	}

	resp, err := c.client.UpdateParticipantSettings(ctx, req)
	if err != nil {
		return err
	}

	if !resp.Success {
		log.Printf("⚠️ UpdateParticipantSettings failed: %s", resp.Message)
	}

	return nil
}

// SendSessionEnd 세션 종료 신호 전송
func (c *GrpcClient) SendSessionEnd(stream grpc.ClientStreamingClient[pb.ChatRequest, pb.ChatResponse], sessionID, roomID, participantID, reason string) error {
	req := &pb.ChatRequest{
		SessionId:     sessionID,
		RoomId:        roomID,
		ParticipantId: participantID,
		Payload: &pb.ChatRequest_SessionEnd{
			SessionEnd: &pb.SessionEnd{
				Reason: reason,
			},
		},
	}
	return stream.Send(req)
}
