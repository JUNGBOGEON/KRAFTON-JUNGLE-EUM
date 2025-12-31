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
	MaxRetries          = 3
	RetryBackoff        = time.Second
	KeepAliveTime       = 10 * time.Second
	KeepAliveTimeout    = 5 * time.Second
	MaxRecvMsgSize      = 4 * 1024 * 1024 // 4MB
	MaxSendMsgSize      = 4 * 1024 * 1024 // 4MB
)

// GrpcClient Python AI 서버와 통신하는 gRPC 클라이언트
type GrpcClient struct {
	conn   *grpc.ClientConn
	client pb.ConversationServiceClient
	addr   string
}

// ChatStream 양방향 스트리밍을 위한 채널 묶음
type ChatStream struct {
	SendChan chan<- []byte  // 오디오 전송용
	RecvChan <-chan []byte  // 오디오 수신용
	TextChan <-chan string  // 텍스트 수신용 (STT/LLM)
	ErrChan  <-chan error   // 에러 수신용
	Cancel   context.CancelFunc
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

// SessionConfig 세션 설정 정보
type SessionConfig struct {
	SampleRate    uint32
	Channels      uint32
	BitsPerSample uint32
	Language      string // 번역 대상 언어 (ko, en, ja, zh)
}

// StartChatStream 양방향 스트리밍 시작
// 반환: 전송채널, 수신채널, 에러
func (c *GrpcClient) StartChatStream(ctx context.Context, sessionID string, config *SessionConfig) (*ChatStream, error) {
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
		initReq := &pb.ChatRequest{
			SessionId: sessionID,
			Payload: &pb.ChatRequest_SessionInit{
				SessionInit: &pb.SessionInit{
					SampleRate:    config.SampleRate,
					Channels:      config.Channels,
					BitsPerSample: config.BitsPerSample,
					Language:      config.Language,
				},
			},
		}
		if err := stream.Send(initReq); err != nil {
			cancel()
			return nil, err
		}
		log.Printf("📤 [%s] SessionInit sent: lang=%s, rate=%d, ch=%d, bits=%d",
			sessionID, config.Language, config.SampleRate, config.Channels, config.BitsPerSample)
	}

	// 채널 생성
	sendChan := make(chan []byte, SendChannelSize)
	recvChan := make(chan []byte, RecvChannelSize)
	textChan := make(chan string, 50)
	errChan := make(chan error, 1)

	var wg sync.WaitGroup
	wg.Add(2)

	// Send Routine: 채널 → gRPC
	go func() {
		defer wg.Done()
		defer stream.CloseSend()

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
					SessionId: sessionID,
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
		defer close(textChan)

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
			case *pb.ChatResponse_AudioChunk:
				// TTS 오디오 → 수신 채널 (deprecated, raw bytes)
				select {
				case recvChan <- payload.AudioChunk:
				default:
					log.Printf("⚠️ [%s] Recv channel full, dropping audio", sessionID)
				}

			case *pb.ChatResponse_AudioResponse:
				// TTS 오디오 응답 (메타데이터 포함)
				log.Printf("🔊 [%s] TTS Audio: format=%s, sampleRate=%d, size=%d bytes",
					sessionID, payload.AudioResponse.Format,
					payload.AudioResponse.SampleRate, len(payload.AudioResponse.AudioData))
				select {
				case recvChan <- payload.AudioResponse.AudioData:
				default:
					log.Printf("⚠️ [%s] Recv channel full, dropping TTS audio", sessionID)
				}

			case *pb.ChatResponse_TranscriptPartial:
				// STT 중간 결과 → 텍스트 채널
				select {
				case textChan <- "[PARTIAL] " + payload.TranscriptPartial.Text:
				default:
				}
				log.Printf("🗣️ [%s] STT Partial: %s", sessionID, payload.TranscriptPartial.Text)

			case *pb.ChatResponse_TranscriptFinal:
				// STT 최종 결과 → 텍스트 채널
				select {
				case textChan <- "[FINAL] " + payload.TranscriptFinal.Text:
				default:
				}
				log.Printf("✅ [%s] STT Final: %s", sessionID, payload.TranscriptFinal.Text)

			case *pb.ChatResponse_TextResponse:
				// LLM 응답 → 텍스트 채널
				select {
				case textChan <- "[LLM] " + payload.TextResponse.Text:
				default:
				}
				log.Printf("🤖 [%s] LLM: %s", sessionID, payload.TextResponse.Text)

			case *pb.ChatResponse_Error:
				log.Printf("❌ [%s] AI Server Error: [%s] %s",
					sessionID, payload.Error.Code, payload.Error.Message)
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
		SendChan: sendChan,
		RecvChan: recvChan,
		TextChan: textChan,
		ErrChan:  errChan,
		Cancel:   cancel,
	}, nil
}

// SendSessionInit 세션 초기화 메시지 전송
func (c *GrpcClient) SendSessionInit(stream grpc.ClientStreamingClient[pb.ChatRequest, pb.ChatResponse], sessionID string, sampleRate, channels, bitsPerSample uint32) error {
	req := &pb.ChatRequest{
		SessionId: sessionID,
		Payload: &pb.ChatRequest_SessionInit{
			SessionInit: &pb.SessionInit{
				SampleRate:    sampleRate,
				Channels:      channels,
				BitsPerSample: bitsPerSample,
				Language:      "ko-KR",
			},
		},
	}
	return stream.Send(req)
}
