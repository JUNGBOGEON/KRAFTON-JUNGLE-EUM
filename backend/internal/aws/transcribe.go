package aws

import (
	"context"
	"log"
	"math"
	"sync"
	"sync/atomic"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/transcribestreaming"
	"github.com/aws/aws-sdk-go-v2/service/transcribestreaming/types"
)

// Stream configuration constants
const (
	KeepAliveInterval    = 10 * time.Second  // Send silence every 10 seconds
	SilenceChunkSize     = 3200              // 100ms of silence at 16kHz mono PCM
	MaxReconnectAttempts = 10                // Maximum reconnection attempts
	InitialBackoff       = 100 * time.Millisecond
	MaxBackoff           = 30 * time.Second
	StreamMaxAge         = 3*time.Hour + 50*time.Minute // Rotate before AWS 4-hour limit
	HealthCheckInterval  = 30 * time.Second
)

// TranscribeClient wraps Amazon Transcribe Streaming with resilience features
type TranscribeClient struct {
	client     *transcribestreaming.Client
	sampleRate int32
	awsConfig  aws.Config
}

// StreamStatus represents the health status of a stream
type StreamStatus string

const (
	StreamStatusHealthy  StreamStatus = "healthy"
	StreamStatusDegraded StreamStatus = "degraded"
	StreamStatusDead     StreamStatus = "dead"
)

// TranscribeStream represents an active transcription stream for a speaker
type TranscribeStream struct {
	speakerID  string
	sourceLang string
	client     *TranscribeClient

	eventStream *transcribestreaming.StartStreamTranscriptionEventStream
	ctx         context.Context
	cancel      context.CancelFunc
	parentCtx   context.Context // Parent context for reconnection
	ctxMu       sync.RWMutex    // Protects ctx and cancel during reconnection

	// Output channel
	TranscriptChan       chan *TranscriptResult
	transcriptChanClosed sync.Once // Ensures TranscriptChan is closed only once

	// Audio input channel (buffered for resilience)
	audioIn       chan []byte
	audioInClosed int32 // atomic flag to prevent sends after close
	audioPending  [][]byte // Pending audio during reconnection
	pendingMu     sync.Mutex

	// Keep-alive
	lastAudioTime time.Time
	keepAliveMu   sync.Mutex

	// Stream lifecycle
	streamStartTime time.Time
	lastSuccessTime time.Time

	// Reconnection
	reconnectAttempts int32
	isReconnecting    int32 // atomic flag

	// Status
	status       StreamStatus
	errorCount   int32
	successCount int64

	// Callbacks
	onStreamDead func(speakerID, sourceLang string)
	onReconnect  func(speakerID, sourceLang string, attempt int)

	mu       sync.Mutex
	isClosed bool
}

// TranscriptResult represents a transcription result
type TranscriptResult struct {
	SpeakerID   string
	Text        string
	Language    string
	IsPartial   bool
	IsFinal     bool
	Confidence  float32
	TimestampMs uint64
}

// StreamHealth contains health information for a stream
type StreamHealth struct {
	SpeakerID       string        `json:"speakerId"`
	SourceLang      string        `json:"sourceLang"`
	Status          StreamStatus  `json:"status"`
	Uptime          time.Duration `json:"uptime"`
	LastActivity    time.Time     `json:"lastActivity"`
	ErrorCount      int32         `json:"errorCount"`
	SuccessCount    int64         `json:"successCount"`
	ReconnectCount  int32         `json:"reconnectCount"`
	IsReconnecting  bool          `json:"isReconnecting"`
}

// Transcribe language code mapping
var transcribeLanguageCodes = map[string]types.LanguageCode{
	"ko": types.LanguageCodeKoKr,
	"en": types.LanguageCodeEnUs,
	"ja": types.LanguageCodeJaJp,
	"zh": types.LanguageCodeZhCn,
}

// NewTranscribeClient creates a new Transcribe Streaming client with resilience
func NewTranscribeClient(cfg aws.Config, sampleRate int32) *TranscribeClient {
	return &TranscribeClient{
		client:     transcribestreaming.NewFromConfig(cfg),
		sampleRate: sampleRate,
		awsConfig:  cfg,
	}
}

// StartStream initiates a new transcription stream for a speaker
func (c *TranscribeClient) StartStream(ctx context.Context, speakerID, sourceLang string) (*TranscribeStream, error) {
	langCode, ok := transcribeLanguageCodes[sourceLang]
	if !ok {
		langCode = types.LanguageCodeEnUs
		log.Printf("[Transcribe] Unknown language '%s', defaulting to en-US", sourceLang)
	}

	log.Printf("[Transcribe] Starting stream for speaker %s (lang=%s)", speakerID, sourceLang)

	streamCtx, cancel := context.WithCancel(ctx)

	// Start the transcription stream directly (no circuit breaker - AWS SDK handles retries)
	resp, err := c.client.StartStreamTranscription(streamCtx, &transcribestreaming.StartStreamTranscriptionInput{
		LanguageCode:                      langCode,
		MediaEncoding:                     types.MediaEncodingPcm,
		MediaSampleRateHertz:              aws.Int32(c.sampleRate),
		EnablePartialResultsStabilization: true,                                 // Enable partial stabilization to reduce choppy updates
		PartialResultsStability:           types.PartialResultsStabilityMedium, // Medium stability: balance between real-time and accuracy
	})
	if err != nil {
		log.Printf("[Transcribe] ERROR StartStreamTranscription failed: %v", err)
		cancel()
		return nil, err
	}

	ts := &TranscribeStream{
		speakerID:       speakerID,
		sourceLang:      sourceLang,
		client:          c,
		eventStream:     resp.GetStream(),
		ctx:             streamCtx,
		cancel:          cancel,
		parentCtx:       ctx,
		TranscriptChan:  make(chan *TranscriptResult, 100), // Increased buffer
		audioIn:         make(chan []byte, 200),           // Increased buffer
		audioPending:    make([][]byte, 0),
		lastAudioTime:   time.Now(),
		streamStartTime: time.Now(),
		lastSuccessTime: time.Now(),
		status:          StreamStatusHealthy,
		isClosed:        false,
	}

	// Start goroutines with improved error handling
	go ts.sendAudioLoop()
	go ts.receiveLoopWithReconnect()
	go ts.keepAliveLoop()
	go ts.healthCheckLoop()

	log.Printf("[Transcribe] Stream started for speaker %s", speakerID)

	return ts, nil
}

// MaxAudioChunkSize is the recommended audio chunk size for AWS Transcribe
const MaxAudioChunkSize = 3200

// SendAudio sends audio data to the transcription stream
func (ts *TranscribeStream) SendAudio(audioData []byte) error {
	ts.mu.Lock()
	if ts.isClosed {
		ts.mu.Unlock()
		return nil
	}
	ts.mu.Unlock()

	// Check if audioIn channel is closed
	if atomic.LoadInt32(&ts.audioInClosed) == 1 {
		return nil
	}

	// Update last audio time for keep-alive
	ts.keepAliveMu.Lock()
	ts.lastAudioTime = time.Now()
	ts.keepAliveMu.Unlock()

	// If reconnecting, buffer the audio
	if atomic.LoadInt32(&ts.isReconnecting) == 1 {
		ts.pendingMu.Lock()
		// Limit pending buffer to avoid memory issues
		if len(ts.audioPending) < 500 {
			dataCopy := make([]byte, len(audioData))
			copy(dataCopy, audioData)
			ts.audioPending = append(ts.audioPending, dataCopy)
		}
		ts.pendingMu.Unlock()
		return nil
	}

	// Get current context safely
	ts.ctxMu.RLock()
	ctx := ts.ctx
	ts.ctxMu.RUnlock()

	// Split large audio into chunks
	for offset := 0; offset < len(audioData); offset += MaxAudioChunkSize {
		end := offset + MaxAudioChunkSize
		if end > len(audioData) {
			end = len(audioData)
		}
		chunk := audioData[offset:end]

		// Check again before sending
		if atomic.LoadInt32(&ts.audioInClosed) == 1 {
			return nil
		}

		select {
		case ts.audioIn <- chunk:
		case <-ctx.Done():
			return ctx.Err()
		default:
			// Buffer full, log but don't fail
			log.Printf("[Transcribe] Audio buffer full for %s, dropping chunk", ts.speakerID)
			return nil
		}
	}
	return nil
}

// keepAliveLoop sends silence audio to keep the stream alive
func (ts *TranscribeStream) keepAliveLoop() {
	ticker := time.NewTicker(KeepAliveInterval)
	defer ticker.Stop()

	// Pre-allocate silence buffer (all zeros = silence in PCM)
	silenceChunk := make([]byte, SilenceChunkSize)

	for {
		// Get context safely
		ts.ctxMu.RLock()
		ctx := ts.ctx
		ts.ctxMu.RUnlock()

		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			ts.keepAliveMu.Lock()
			timeSinceLastAudio := time.Since(ts.lastAudioTime)
			ts.keepAliveMu.Unlock()

			// Only send silence if no audio received recently and not reconnecting
			if timeSinceLastAudio >= KeepAliveInterval-time.Second {
				if atomic.LoadInt32(&ts.isReconnecting) == 0 && atomic.LoadInt32(&ts.audioInClosed) == 0 {
					ts.mu.Lock()
					closed := ts.isClosed
					ts.mu.Unlock()

					if !closed {
						select {
						case ts.audioIn <- silenceChunk:
							// Silence sent successfully
						default:
							// Buffer full, skip
						}
					}
				}
			}
		}
	}
}

// healthCheckLoop monitors stream health
func (ts *TranscribeStream) healthCheckLoop() {
	ticker := time.NewTicker(HealthCheckInterval)
	defer ticker.Stop()

	for {
		// Get context safely
		ts.ctxMu.RLock()
		ctx := ts.ctx
		ts.ctxMu.RUnlock()

		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			ts.updateHealth()
		}
	}
}

// updateHealth updates the stream health status
func (ts *TranscribeStream) updateHealth() {
	ts.mu.Lock()
	defer ts.mu.Unlock()

	errorCount := atomic.LoadInt32(&ts.errorCount)
	timeSinceSuccess := time.Since(ts.lastSuccessTime)

	// Determine health status
	if ts.isClosed {
		ts.status = StreamStatusDead
	} else if errorCount > 3 || timeSinceSuccess > 2*time.Minute {
		ts.status = StreamStatusDegraded
	} else {
		ts.status = StreamStatusHealthy
	}
}

// sendAudioLoop sends audio chunks to Transcribe
func (ts *TranscribeStream) sendAudioLoop() {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("[Transcribe] sendAudioLoop panic recovered for %s: %v", ts.speakerID, r)
		}
	}()

	audioChunkCount := 0
	totalBytesSent := 0

	for {
		// Get context safely
		ts.ctxMu.RLock()
		ctx := ts.ctx
		ts.ctxMu.RUnlock()

		select {
		case <-ctx.Done():
			return
		case audioData, ok := <-ts.audioIn:
			if !ok {
				// Channel closed, exit loop
				return
			}

			// Skip if reconnecting
			if atomic.LoadInt32(&ts.isReconnecting) == 1 {
				continue
			}

			audioChunkCount++
			totalBytesSent += len(audioData)

			// Log periodically
			if audioChunkCount == 1 || audioChunkCount%100 == 0 {
				log.Printf("[Transcribe] Audio chunk #%d for %s (total: %d bytes)",
					audioChunkCount, ts.speakerID, totalBytesSent)
			}

			if ts.eventStream == nil {
				continue
			}

			// Get fresh context for send operation
			ts.ctxMu.RLock()
			sendCtx := ts.ctx
			ts.ctxMu.RUnlock()

			err := ts.eventStream.Send(sendCtx, &types.AudioStreamMemberAudioEvent{
				Value: types.AudioEvent{
					AudioChunk: audioData,
				},
			})
			if err != nil {
				atomic.AddInt32(&ts.errorCount, 1)
				log.Printf("[Transcribe] Send error for %s: %v", ts.speakerID, err)

				// Trigger reconnection
				go ts.attemptReconnect()
				continue
			}

			// Record success
			atomic.AddInt64(&ts.successCount, 1)
			ts.mu.Lock()
			ts.lastSuccessTime = time.Now()
			ts.mu.Unlock()
		}
	}
}

// receiveLoopWithReconnect receives transcript results with reconnection support
func (ts *TranscribeStream) receiveLoopWithReconnect() {
	log.Printf("[Transcribe] receiveLoop started for speaker %s", ts.speakerID)

	defer func() {
		if r := recover(); r != nil {
			log.Printf("[Transcribe] receiveLoop panic recovered for %s: %v", ts.speakerID, r)
		}
		ts.mu.Lock()
		ts.isClosed = true
		ts.mu.Unlock()
		ts.closeTranscriptChan() // Use sync.Once to prevent double close
		log.Printf("[Transcribe] receiveLoop ended for speaker %s", ts.speakerID)
	}()

	for {
		if ts.eventStream == nil {
			time.Sleep(100 * time.Millisecond)
			continue
		}

		events := ts.eventStream.Events()

		for event := range events {
			// Check context with read lock
			ts.ctxMu.RLock()
			ctx := ts.ctx
			ts.ctxMu.RUnlock()

			select {
			case <-ctx.Done():
				return
			default:
			}

			switch e := event.(type) {
			case *types.TranscriptResultStreamMemberTranscriptEvent:
				ts.handleTranscriptEvent(e.Value)
				// Reset error count on successful receive
				atomic.StoreInt32(&ts.errorCount, 0)
				ts.mu.Lock()
				ts.lastSuccessTime = time.Now()
				ts.mu.Unlock()
			}
		}

		// Stream ended - check for errors
		if err := ts.eventStream.Err(); err != nil {
			atomic.AddInt32(&ts.errorCount, 1)
			log.Printf("[Transcribe] Stream error for %s: %v", ts.speakerID, err)

			// Attempt reconnection
			if ts.shouldReconnect() {
				if err := ts.attemptReconnect(); err != nil {
					log.Printf("[Transcribe] Reconnection failed for %s: %v", ts.speakerID, err)
					if ts.onStreamDead != nil {
						ts.onStreamDead(ts.speakerID, ts.sourceLang)
					}
					return
				}
				continue
			}
		}

		// Normal stream end - check if we should reconnect due to age
		ts.mu.Lock()
		age := time.Since(ts.streamStartTime)
		ts.mu.Unlock()

		if age > StreamMaxAge && ts.shouldReconnect() {
			log.Printf("[Transcribe] Stream %s reached max age (%v), rotating...", ts.speakerID, age)
			if err := ts.attemptReconnect(); err != nil {
				log.Printf("[Transcribe] Stream rotation failed for %s: %v", ts.speakerID, err)
			}
			continue
		}

		// Stream ended normally
		return
	}
}

// shouldReconnect determines if reconnection should be attempted
func (ts *TranscribeStream) shouldReconnect() bool {
	ts.mu.Lock()
	defer ts.mu.Unlock()

	if ts.isClosed {
		return false
	}

	// Check parent context
	select {
	case <-ts.parentCtx.Done():
		return false
	default:
	}

	// Check reconnect attempts
	if atomic.LoadInt32(&ts.reconnectAttempts) >= MaxReconnectAttempts {
		log.Printf("[Transcribe] Max reconnect attempts reached for %s", ts.speakerID)
		return false
	}

	return true
}

// attemptReconnect tries to reconnect the stream
func (ts *TranscribeStream) attemptReconnect() error {
	// Prevent concurrent reconnection attempts
	if !atomic.CompareAndSwapInt32(&ts.isReconnecting, 0, 1) {
		return nil
	}
	defer atomic.StoreInt32(&ts.isReconnecting, 0)

	attempt := atomic.AddInt32(&ts.reconnectAttempts, 1)
	log.Printf("[Transcribe] Reconnection attempt %d for %s", attempt, ts.speakerID)

	if ts.onReconnect != nil {
		ts.onReconnect(ts.speakerID, ts.sourceLang, int(attempt))
	}

	// Calculate backoff with jitter
	backoff := time.Duration(math.Pow(2, float64(attempt-1))) * InitialBackoff
	if backoff > MaxBackoff {
		backoff = MaxBackoff
	}
	// Add jitter (10-20% of backoff)
	jitter := time.Duration(float64(backoff) * (0.1 + 0.1*float64(time.Now().UnixNano()%100)/100))
	backoff += jitter

	log.Printf("[Transcribe] Waiting %v before reconnection for %s", backoff, ts.speakerID)
	time.Sleep(backoff)

	// Close old event stream
	if ts.eventStream != nil {
		ts.eventStream.Close()
	}

	// Create new context with proper locking
	ts.ctxMu.Lock()
	ts.cancel()
	newCtx, newCancel := context.WithCancel(ts.parentCtx)
	ts.ctx = newCtx
	ts.cancel = newCancel
	ts.ctxMu.Unlock()

	// Get language code
	langCode, ok := transcribeLanguageCodes[ts.sourceLang]
	if !ok {
		langCode = types.LanguageCodeEnUs
	}

	// Start new stream directly (no circuit breaker - AWS SDK handles retries)
	resp, err := ts.client.client.StartStreamTranscription(newCtx, &transcribestreaming.StartStreamTranscriptionInput{
		LanguageCode:                      langCode,
		MediaEncoding:                     types.MediaEncodingPcm,
		MediaSampleRateHertz:              aws.Int32(ts.client.sampleRate),
		EnablePartialResultsStabilization: true,                                 // Enable partial stabilization to reduce choppy updates
		PartialResultsStability:           types.PartialResultsStabilityMedium, // Medium stability: balance between real-time and accuracy
	})
	if err != nil {
		log.Printf("[Transcribe] Failed to start new stream for %s: %v", ts.speakerID, err)
		return err
	}

	ts.eventStream = resp.GetStream()
	ts.mu.Lock()
	ts.streamStartTime = time.Now()
	ts.lastSuccessTime = time.Now()
	ts.status = StreamStatusHealthy
	ts.mu.Unlock()

	// Reset reconnect attempts on successful reconnection
	atomic.StoreInt32(&ts.reconnectAttempts, 0)
	atomic.StoreInt32(&ts.errorCount, 0)

	// Flush pending audio
	ts.flushPendingAudio()

	log.Printf("[Transcribe] Successfully reconnected stream for %s", ts.speakerID)
	return nil
}

// flushPendingAudio sends buffered audio after reconnection
func (ts *TranscribeStream) flushPendingAudio() {
	ts.pendingMu.Lock()
	pending := ts.audioPending
	ts.audioPending = make([][]byte, 0)
	ts.pendingMu.Unlock()

	if len(pending) == 0 {
		return
	}

	log.Printf("[Transcribe] Flushing %d pending audio chunks for %s", len(pending), ts.speakerID)

	for _, chunk := range pending {
		select {
		case ts.audioIn <- chunk:
		case <-ts.ctx.Done():
			return
		default:
			// Buffer full, skip
		}
	}
}

// handleTranscriptEvent processes a transcript event
func (ts *TranscribeStream) handleTranscriptEvent(event types.TranscriptEvent) {
	if event.Transcript == nil || len(event.Transcript.Results) == 0 {
		return
	}

	for _, result := range event.Transcript.Results {
		if len(result.Alternatives) == 0 {
			continue
		}

		alt := result.Alternatives[0]
		transcript := aws.ToString(alt.Transcript)

		if transcript == "" {
			continue
		}

		isPartial := result.IsPartial

		var confidence float32 = 1.0
		if len(alt.Items) > 0 && alt.Items[0].Confidence != nil {
			confidence = float32(*alt.Items[0].Confidence)
		}

		// Debug log for transcript reception
		if isPartial {
			log.Printf("[Transcribe] Partial from %s: '%s' (confidence: %.2f)", ts.speakerID, transcript, confidence)
		} else {
			log.Printf("[Transcribe] Final from %s: '%s' (confidence: %.2f)", ts.speakerID, transcript, confidence)
		}

		select {
		case ts.TranscriptChan <- &TranscriptResult{
			SpeakerID:   ts.speakerID,
			Text:        transcript,
			Language:    ts.sourceLang,
			IsPartial:   isPartial,
			IsFinal:     !isPartial,
			Confidence:  confidence,
			TimestampMs: uint64(time.Now().UnixMilli()),
		}:
		default:
			log.Printf("[Transcribe] Channel full, dropping transcript: '%s'", transcript)
		}
	}
}

// GetHealth returns the current health status of the stream
func (ts *TranscribeStream) GetHealth() *StreamHealth {
	ts.mu.Lock()
	defer ts.mu.Unlock()

	return &StreamHealth{
		SpeakerID:       ts.speakerID,
		SourceLang:      ts.sourceLang,
		Status:          ts.status,
		Uptime:          time.Since(ts.streamStartTime),
		LastActivity:    ts.lastAudioTime,
		ErrorCount:      atomic.LoadInt32(&ts.errorCount),
		SuccessCount:    atomic.LoadInt64(&ts.successCount),
		ReconnectCount:  atomic.LoadInt32(&ts.reconnectAttempts),
		IsReconnecting:  atomic.LoadInt32(&ts.isReconnecting) == 1,
	}
}

// IsClosed returns whether the stream has been closed
func (ts *TranscribeStream) IsClosed() bool {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	return ts.isClosed
}

// GetStreamAge returns how long the stream has been running
func (ts *TranscribeStream) GetStreamAge() time.Duration {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	return time.Since(ts.streamStartTime)
}

// GetSpeakerID returns the speaker ID associated with this stream
func (ts *TranscribeStream) GetSpeakerID() string {
	return ts.speakerID
}

// SetCallbacks sets the callback functions
func (ts *TranscribeStream) SetCallbacks(onDead, onReconnect func(speakerID, sourceLang string, attempt int)) {
	ts.onStreamDead = func(speakerID, sourceLang string) {
		if onDead != nil {
			onDead(speakerID, sourceLang, 0)
		}
	}
	ts.onReconnect = onReconnect
}

// Close terminates the transcription stream
func (ts *TranscribeStream) Close() error {
	ts.mu.Lock()
	if ts.isClosed {
		ts.mu.Unlock()
		return nil
	}
	ts.isClosed = true
	ts.status = StreamStatusDead
	ts.mu.Unlock()

	// Cancel context first
	ts.ctxMu.Lock()
	ts.cancel()
	ts.ctxMu.Unlock()

	// Mark audioIn as closed and close the channel
	// This signals sendAudioLoop to exit
	if atomic.CompareAndSwapInt32(&ts.audioInClosed, 0, 1) {
		close(ts.audioIn)
	}

	// Clear pending audio to prevent memory leak
	ts.pendingMu.Lock()
	ts.audioPending = nil
	ts.pendingMu.Unlock()

	// Close event stream
	if ts.eventStream != nil {
		ts.eventStream.Close()
	}

	log.Printf("[Transcribe] Closed stream for speaker %s", ts.speakerID)
	return nil
}

// closeTranscriptChan safely closes the transcript channel using sync.Once
func (ts *TranscribeStream) closeTranscriptChan() {
	ts.transcriptChanClosed.Do(func() {
		close(ts.TranscriptChan)
	})
}
