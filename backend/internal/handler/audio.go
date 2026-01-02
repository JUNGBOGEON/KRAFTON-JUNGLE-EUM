package handler

import (
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/gofiber/contrib/websocket"
	"gorm.io/gorm"

	"realtime-backend/internal/ai"
	"realtime-backend/internal/auth"
	"realtime-backend/internal/config"
	"realtime-backend/internal/model"
	"realtime-backend/internal/session"
)

// AudioHandler 오디오 WebSocket 핸들러
type AudioHandler struct {
	cfg      *config.Config
	db       *gorm.DB
	aiClient *ai.GrpcClient
}

// NewAudioHandler AudioHandler 생성자
func NewAudioHandler(cfg *config.Config, db *gorm.DB) *AudioHandler {
	handler := &AudioHandler{cfg: cfg, db: db}

	// AI 서버 연결 (활성화된 경우)
	if cfg.AI.Enabled {
		client, err := ai.NewGrpcClient(cfg.AI.ServerAddr)
		if err != nil {
			log.Printf("⚠️ Failed to connect to AI server: %v (running in echo mode)", err)
		} else {
			handler.aiClient = client
			log.Printf("🤖 Connected to AI server at %s", cfg.AI.ServerAddr)
		}
	} else {
		log.Println("ℹ️ AI server disabled, running in echo mode")
	}

	return handler
}

// Close 핸들러 리소스 정리
func (h *AudioHandler) Close() error {
	if h.aiClient != nil {
		return h.aiClient.Close()
	}
	return nil
}

// HandleWebSocket 오디오 스트리밍 WebSocket 연결 처리
func (h *AudioHandler) HandleWebSocket(c *websocket.Conn) {
	// 패닉 복구 - 서버 크래시 방지
	defer func() {
		if r := recover(); r != nil {
			log.Printf("오디오 WebSocket 패닉 복구: %v", r)
		}
	}()

	// 세션 초기화
	sess := session.New(h.cfg.Audio.ChannelBufferSize)

	// 소스 언어 파라미터 추출 (발화자가 말하는 언어)
	if sourceLang, ok := c.Locals("sourceLang").(string); ok && sourceLang != "" {
		sess.SetSourceLanguage(sourceLang)
		log.Printf("🌐 [%s] Source language (speaking): %s", sess.ID, sourceLang)
	}

	// 타겟 언어 파라미터 추출 (듣고 싶은 언어)
	if targetLang, ok := c.Locals("targetLang").(string); ok && targetLang != "" {
		sess.SetLanguage(targetLang)
		log.Printf("🌐 [%s] Target language (listening): %s", sess.ID, targetLang)
	}

	// 발화자 식별 ID 추출 (Locals에서)
	if participantId, ok := c.Locals("participantId").(string); ok && participantId != "" {
		sess.SetParticipantID(participantId)
		log.Printf("👤 [%s] Participant ID: %s", sess.ID, participantId)
	}

	// 권한 확인 (CONNECT_VOICE)
	workspaceIDStr := c.Params("workspaceId")
	// workspaceID가 없으면 글로벌 WS일 수도 있지만, 여기서는 워크스페이스 컨텍스트 가정
	if workspaceIDStr != "" {
		claims, ok := c.Locals("claims").(*auth.Claims)
		if ok {
			// int64 파싱
			var workspaceID int64
			fmt.Sscanf(workspaceIDStr, "%d", &workspaceID)

			hasPermission, err := auth.CheckPermission(h.db, workspaceID, claims.UserID, "CONNECT_MEDIA")
			if err != nil {
				log.Printf("❌ [%s] Permission check failed: %v", sess.ID, err)
				h.sendErrorResponse(c, sess.ID, "PERMISSION_ERROR", "Internal server error")
				return
			}
			if !hasPermission {
				log.Printf("❌ [%s] Permission denied: CONNECT_MEDIA", sess.ID)
				h.sendErrorResponse(c, sess.ID, "PERMISSION_DENIED", "You do not have permission to connect to media")
				return
			}
		}
	// Room ID 추출 (Locals에서)
	if roomId, ok := c.Locals("roomId").(string); ok && roomId != "" {
		sess.SetRoomID(roomId)
		log.Printf("🏠 [%s] Room ID: %s", sess.ID, roomId)
	}

	// Listener ID 추출 (Locals에서)
	if listenerId, ok := c.Locals("listenerId").(string); ok && listenerId != "" {
		sess.SetListenerID(listenerId)
		log.Printf("👂 [%s] Listener ID: %s", sess.ID, listenerId)
	}

	log.Printf("🔗 [%s] New WebSocket connection established", sess.ID)

	// Graceful Shutdown & Resource Cleanup
	defer func() {
		sess.Close()

		packetCount, audioBytes := sess.GetStats()
		log.Printf("🔌 [%s] Connection closed. Duration: %v, Packets: %d, Total bytes: %d",
			sess.ID, sess.Duration().Round(time.Second), packetCount, audioBytes)

		if err := c.Close(); err != nil {
			log.Printf("⚠️ [%s] Error closing WebSocket: %v", sess.ID, err)
		}
	}()

	// Phase 1: 핸드셰이크 (워커 시작 전에 먼저 수행)
	if err := h.performHandshake(c, sess); err != nil {
		log.Printf("❌ [%s] Handshake failed: %v", sess.ID, err)
		h.sendErrorResponse(c, sess.ID, "HANDSHAKE_FAILED", err.Error())
		return
	}

	var wg sync.WaitGroup
	var writeMu sync.Mutex // WebSocket 쓰기 동기화

	// AI 모드 또는 에코 모드 선택 (핸드셰이크 완료 후)
	if h.aiClient != nil {
		// AI 모드: 단일 gRPC 스트림으로 통합
		wg.Add(3)

		// 1. AI 통합 워커 (오디오 송신 + 응답 수신)
		go func() {
			defer wg.Done()
			h.aiUnifiedWorker(sess)
		}()

		// 2. AI 응답 → WebSocket 전송 (오디오)
		go func() {
			defer wg.Done()
			h.aiResponseWorker(c, sess, &writeMu)
		}()

		// 3. 자막(Transcript) → WebSocket 전송
		go func() {
			defer wg.Done()
			h.transcriptWorker(c, sess, &writeMu)
		}()
	} else {
		// 에코 모드
		wg.Add(2)

		go func() {
			defer wg.Done()
			h.processingWorkerEcho(sess)
		}()

		go func() {
			defer wg.Done()
			h.echoWorker(c, sess)
		}()
	}

	// Phase 2: 오디오 스트리밍 수신 루프
	h.receiveLoop(c, sess)

	wg.Wait()
}

// performHandshake 메타데이터 헤더 수신 및 검증
func (h *AudioHandler) performHandshake(c *websocket.Conn, sess *session.Session) error {
	deadline := time.Now().Add(h.cfg.WebSocket.HandshakeTimeout)
	if err := c.SetReadDeadline(deadline); err != nil {
		return fmt.Errorf("failed to set read deadline: %w", err)
	}

	messageType, msg, err := c.ReadMessage()
	if err != nil {
		return fmt.Errorf("failed to read header: %w", err)
	}

	if messageType != websocket.BinaryMessage {
		return fmt.Errorf("expected binary message, got type %d", messageType)
	}

	metadata, err := model.ParseMetadata(msg)
	if err != nil {
		return err
	}

	if err := metadata.Validate(&h.cfg.Audio); err != nil {
		return fmt.Errorf("invalid metadata: %w", err)
	}

	sess.SetMetadata(metadata)

	log.Printf("📋 [%s] Metadata: SampleRate=%d, Channels=%d, BitsPerSample=%d",
		sess.ID, metadata.SampleRate, metadata.Channels, metadata.BitsPerSample)

	readyResponse := fmt.Sprintf(`{"status":"ready","session_id":"%s","mode":"%s"}`,
		sess.ID, h.getMode())

	if err := c.SetWriteDeadline(time.Now().Add(h.cfg.WebSocket.WriteTimeout)); err != nil {
		return fmt.Errorf("failed to set write deadline: %w", err)
	}

	if err := c.WriteMessage(websocket.TextMessage, []byte(readyResponse)); err != nil {
		return fmt.Errorf("failed to send ready response: %w", err)
	}

	if err := c.SetReadDeadline(time.Time{}); err != nil {
		return fmt.Errorf("failed to clear read deadline: %w", err)
	}

	log.Printf("✅ [%s] Handshake complete. Mode: %s", sess.ID, h.getMode())
	return nil
}

func (h *AudioHandler) getMode() string {
	if h.aiClient != nil {
		return "ai"
	}
	return "echo"
}

// receiveLoop 오디오 데이터 수신 및 채널 전달
func (h *AudioHandler) receiveLoop(c *websocket.Conn, sess *session.Session) {
	var lastLogTime time.Time
	var packetsSinceLog int64
	var bytesSinceLog int64

	for {
		select {
		case <-sess.Context().Done():
			log.Printf("ℹ️ [%s] Receive loop terminated by context", sess.ID)
			return
		default:
		}

		messageType, msg, err := c.ReadMessage()
		if err != nil {
			if websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
				log.Printf("ℹ️ [%s] Client disconnected normally", sess.ID)
			} else if websocket.IsUnexpectedCloseError(err) {
				log.Printf("⚠️ [%s] Unexpected disconnect: %v", sess.ID, err)
			} else {
				log.Printf("❌ [%s] Read error: %v", sess.ID, err)
			}
			return
		}

		if messageType != websocket.BinaryMessage {
			log.Printf("⚠️ [%s] Ignoring non-binary message (type: %d)", sess.ID, messageType)
			continue
		}

		if len(msg) == 0 {
			continue
		}

		// Deep Copy
		dataCopy := make([]byte, len(msg))
		copy(dataCopy, msg)

		seqNum := sess.IncrementPacketCount()
		packet := &model.AudioPacket{
			Data:      dataCopy,
			Timestamp: time.Now(),
			SeqNum:    seqNum,
		}

		sess.AddAudioBytes(int64(len(dataCopy)))

		// Debug logging (매 1초마다)
		packetsSinceLog++
		bytesSinceLog += int64(len(dataCopy))
		if time.Since(lastLogTime) >= time.Second {
			audioDurationMs := float64(bytesSinceLog) / 32.0 // 16kHz * 2bytes = 32 bytes/ms
			log.Printf("📊 [%s] Audio stats: packets=%d, bytes=%d, duration=%.0fms/sec",
				sess.ID, packetsSinceLog, bytesSinceLog, audioDurationMs)
			lastLogTime = time.Now()
			packetsSinceLog = 0
			bytesSinceLog = 0
		}

		// Non-blocking send
		select {
		case sess.AudioPackets <- packet:
		default:
			log.Printf("⚠️ [%s] Audio buffer full, dropping packet #%d", sess.ID, seqNum)
		}
	}
}

// ============================================================================
// AI 모드 워커들
// ============================================================================

// aiUnifiedWorker 단일 gRPC 스트림으로 오디오 송수신 통합 처리
func (h *AudioHandler) aiUnifiedWorker(sess *session.Session) {
	log.Printf("🤖 [%s] AI unified worker started", sess.ID)
	defer log.Printf("🤖 [%s] AI unified worker stopped", sess.ID)

	// 세션 설정 정보 구성
	metadata := sess.GetMetadata()
	participantID := sess.GetParticipantID()
	sourceLang := sess.GetSourceLanguage() // 발화자가 말하는 언어
	targetLang := sess.GetLanguage()       // 듣고 싶은 언어

	log.Printf("🌐 [%s] Language config: source=%s, target=%s", sess.ID, sourceLang, targetLang)

	// 발화자 설정 - 발화자가 말하는 언어 사용
	speaker := &ai.SpeakerConfig{
		ParticipantID:  participantID,
		Nickname:       participantID, // TODO: 실제 닉네임 가져오기
		SourceLanguage: sourceLang,    // 발화자가 말하는 언어
	}

	// 참가자 설정 - 듣는 사람의 타겟 언어 사용
	// TODO: 실제 참가자 목록 가져오기 (현재는 자기 자신만)
	participants := []ai.ParticipantConfig{
		{
			ParticipantID:      participantID,
			Nickname:           participantID,
			TargetLanguage:     targetLang, // 듣고 싶은 언어
			TranslationEnabled: sourceLang != targetLang, // 소스와 타겟이 다르면 번역 활성화
		},
	}

	var config *ai.SessionConfig
	if metadata != nil {
		config = &ai.SessionConfig{
			SampleRate:     metadata.SampleRate,
			Channels:       uint32(metadata.Channels),
			BitsPerSample:  uint32(metadata.BitsPerSample),
			SourceLanguage: sourceLang, // 발화자가 말하는 언어
			Participants:   participants,
			Speaker:        speaker,
		}
	} else {
		// 메타데이터가 없는 경우 기본값 사용
		config = &ai.SessionConfig{
			SampleRate:     16000,
			Channels:       1,
			BitsPerSample:  16,
			SourceLanguage: sourceLang, // 발화자가 말하는 언어
			Participants:   participants,
			Speaker:        speaker,
		}
	}

	// 단일 gRPC 스트림 시작 (SessionConfig 전달)
	roomID := sess.GetRoomID()
	if roomID == "" {
		roomID = sess.ID // 방 ID가 없으면 세션 ID 사용
	}
	listenerId := sess.GetListenerID()
	log.Printf("🏠 [%s] Starting AI stream with roomId=%s, listenerId=%s", sess.ID, roomID, listenerId)
	chatStream, err := h.aiClient.StartChatStream(sess.Context(), sess.ID, roomID, config)
	if err != nil {
		log.Printf("❌ [%s] Failed to start AI stream: %v", sess.ID, err)
		return
	}
	defer chatStream.Cancel()

	// 송신 고루틴: AudioPackets → gRPC
	go func() {
		for {
			select {
			case <-sess.Context().Done():
				return
			case packet, ok := <-sess.AudioPackets:
				if !ok {
					return
				}
				metadata := sess.GetMetadata()
				if metadata == nil {
					continue
				}
				// gRPC로 전송 (Non-blocking)
				select {
				case chatStream.SendChan <- packet.Data:
				default:
					log.Printf("⚠️ [%s] gRPC send buffer full, dropping packet #%d", sess.ID, packet.SeqNum)
				}
			}
		}
	}()

	// 수신 루프: gRPC → 세션 채널들
	for {
		select {
		case <-sess.Context().Done():
			return

		case transcript, ok := <-chatStream.TranscriptChan:
			if !ok {
				return
			}
			log.Printf("📝 [%s] AI Transcript received: %s (partial=%v, final=%v)",
				sess.ID, transcript.OriginalText, transcript.IsPartial, transcript.IsFinal)

			// Partial 결과는 무시 (또는 실시간 표시용으로 전송)
			if transcript.IsPartial {
				log.Printf("📝 [%s] Partial STT (ignored): %s", sess.ID, transcript.OriginalText)
				continue
			}

			// 번역 결과 추출 (첫 번째 번역 사용)
			var translatedText string
			if len(transcript.Translations) > 0 {
				translatedText = transcript.Translations[0].TranslatedText
			}

			// 원본과 번역이 같으면 번역 없음
			if translatedText == transcript.OriginalText {
				translatedText = ""
			}

			transcriptMsg := &session.TranscriptMessage{
				Type:          "transcript",
				ParticipantID: sess.GetParticipantID(),
				Text:          transcript.OriginalText,
				Original:      transcript.OriginalText,
				Translated:    translatedText,
				Language:      transcript.OriginalLanguage,
				IsFinal:       transcript.IsFinal,
			}

			select {
			case sess.TranscriptChan <- transcriptMsg:
				if translatedText != "" {
					log.Printf("📝 [%s] Transcript sent: original=%s, translated=%s",
						sess.ID, transcript.OriginalText, translatedText)
				} else {
					log.Printf("📝 [%s] Transcript sent: %s", sess.ID, transcript.OriginalText)
				}
			default:
				log.Printf("⚠️ [%s] Transcript buffer full, dropping message", sess.ID)
			}

		case audioMsg, ok := <-chatStream.AudioChan:
			if !ok {
				return
			}
			log.Printf("🔊 [%s] AI Audio received: lang=%s, speaker=%s, size=%d bytes",
				sess.ID, audioMsg.TargetLanguage, audioMsg.SpeakerParticipantID, len(audioMsg.AudioData))

			// Self-mute는 프론트엔드에서 처리 (useRemoteParticipantTranslation.ts)
			// 백엔드는 모든 TTS 오디오를 전송

			// AI 응답 오디오 → 에코 채널 (Non-blocking)
			select {
			case sess.EchoPackets <- audioMsg.AudioData:
				log.Printf("🔊 [%s] TTS audio sent to WebSocket", sess.ID)
			default:
				log.Printf("⚠️ [%s] Echo buffer full, dropping AI audio response", sess.ID)
			}

		case err, ok := <-chatStream.ErrChan:
			if !ok {
				return
			}
			if err != nil {
				log.Printf("❌ [%s] AI stream error: %v", sess.ID, err)
			}
			return
		}
	}
}

// aiResponseWorker AI 오디오 응답을 WebSocket으로 전송
func (h *AudioHandler) aiResponseWorker(c *websocket.Conn, sess *session.Session, writeMu *sync.Mutex) {
	log.Printf("📤 [%s] AI response worker started", sess.ID)
	defer log.Printf("📤 [%s] AI response worker stopped", sess.ID)

	for {
		select {
		case <-sess.Context().Done():
			return

		case data, ok := <-sess.EchoPackets:
			if !ok {
				return
			}

			writeMu.Lock()
			if err := c.SetWriteDeadline(time.Now().Add(h.cfg.WebSocket.WriteTimeout)); err != nil {
				writeMu.Unlock()
				log.Printf("⚠️ [%s] Failed to set write deadline: %v", sess.ID, err)
				continue
			}

			if err := c.WriteMessage(websocket.BinaryMessage, data); err != nil {
				writeMu.Unlock()
				log.Printf("⚠️ [%s] Failed to send AI audio response: %v", sess.ID, err)
				return
			}
			writeMu.Unlock()
		}
	}
}

// transcriptWorker 자막 메시지를 WebSocket으로 전송
func (h *AudioHandler) transcriptWorker(c *websocket.Conn, sess *session.Session, writeMu *sync.Mutex) {
	log.Printf("📝 [%s] Transcript worker started", sess.ID)
	defer log.Printf("📝 [%s] Transcript worker stopped", sess.ID)

	for {
		select {
		case <-sess.Context().Done():
			return

		case msg, ok := <-sess.TranscriptChan:
			if !ok {
				return
			}

			writeMu.Lock()
			if err := c.SetWriteDeadline(time.Now().Add(h.cfg.WebSocket.WriteTimeout)); err != nil {
				writeMu.Unlock()
				log.Printf("⚠️ [%s] Failed to set write deadline for transcript: %v", sess.ID, err)
				continue
			}

			// JSON 형식으로 전송 (특수문자 이스케이프 처리)
			jsonData, err := json.Marshal(msg)
			if err != nil {
				writeMu.Unlock()
				log.Printf("⚠️ [%s] Failed to marshal transcript: %v", sess.ID, err)
				continue
			}

			if err := c.WriteMessage(websocket.TextMessage, jsonData); err != nil {
				writeMu.Unlock()
				log.Printf("⚠️ [%s] Failed to send transcript: %v", sess.ID, err)
				return
			}
			writeMu.Unlock()

			log.Printf("📤 [%s] Transcript sent to WebSocket: %s", sess.ID, msg.Text)
		}
	}
}

// ============================================================================
// 에코 모드 워커들 (AI 비활성화 시)
// ============================================================================

// processingWorkerEcho 에코 모드: 수신 오디오를 그대로 반환
func (h *AudioHandler) processingWorkerEcho(sess *session.Session) {
	log.Printf("🎧 [%s] Echo processing worker started", sess.ID)
	defer log.Printf("🎧 [%s] Echo processing worker stopped", sess.ID)

	for {
		select {
		case <-sess.Context().Done():
			remaining := len(sess.AudioPackets)
			if remaining > 0 {
				log.Printf("ℹ️ [%s] Draining %d remaining packets", sess.ID, remaining)
			}
			return

		case packet, ok := <-sess.AudioPackets:
			if !ok {
				return
			}

			metadata := sess.GetMetadata()
			if metadata == nil {
				continue
			}

			// 에코: 수신한 오디오를 그대로 반환
			select {
			case sess.EchoPackets <- packet.Data:
			default:
				log.Printf("⚠️ [%s] Echo buffer full, dropping packet #%d", sess.ID, packet.SeqNum)
			}
		}
	}
}

// echoWorker 에코 패킷을 클라이언트로 전송
func (h *AudioHandler) echoWorker(c *websocket.Conn, sess *session.Session) {
	log.Printf("📤 [%s] Echo worker started", sess.ID)
	defer log.Printf("📤 [%s] Echo worker stopped", sess.ID)

	for {
		select {
		case <-sess.Context().Done():
			return

		case data, ok := <-sess.EchoPackets:
			if !ok {
				return
			}

			if err := c.SetWriteDeadline(time.Now().Add(h.cfg.WebSocket.WriteTimeout)); err != nil {
				log.Printf("⚠️ [%s] Failed to set write deadline: %v", sess.ID, err)
				continue
			}

			if err := c.WriteMessage(websocket.BinaryMessage, data); err != nil {
				log.Printf("⚠️ [%s] Failed to send echo: %v", sess.ID, err)
				return
			}
		}
	}
}

// sendErrorResponse 에러 응답 전송
func (h *AudioHandler) sendErrorResponse(c *websocket.Conn, sessionID, code, message string) {
	response := fmt.Sprintf(`{"status":"error","code":"%s","message":"%s","session_id":"%s"}`,
		code, message, sessionID)

	_ = c.SetWriteDeadline(time.Now().Add(h.cfg.WebSocket.WriteTimeout))

	if err := c.WriteMessage(websocket.TextMessage, []byte(response)); err != nil {
		log.Printf("⚠️ [%s] Failed to send error response: %v", sessionID, err)
	}
}
