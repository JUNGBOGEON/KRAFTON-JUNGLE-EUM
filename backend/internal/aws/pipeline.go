package aws

import (
	"context"
	"fmt"
	"log"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/google/uuid"

	"realtime-backend/internal/ai"
	appconfig "realtime-backend/internal/config"
	"realtime-backend/pb"
)

// test 주석
// Pipeline configuration constants
const (
	StreamIdleTimeout       = 30 * time.Minute // Close stream after 30 minutes of inactivity
	PipelineHealthCheckTick = 30 * time.Second // Health check interval
	BackpressureThreshold   = 0.8              // 80% buffer capacity triggers backpressure
	MaxPendingAudioChunks   = 100              // Max audio chunks to queue per speaker
	MaxConcurrentTranslate  = 20               // Max concurrent Translate API calls
	MaxConcurrentTTS        = 10               // Max concurrent Polly TTS API calls
	APICallTimeout          = 10 * time.Second // Timeout for individual API calls
)

// PipelineStatus represents overall pipeline health
type PipelineStatus string

const (
	PipelineStatusHealthy  PipelineStatus = "healthy"
	PipelineStatusDegraded PipelineStatus = "degraded"
	PipelineStatusUnhealthy PipelineStatus = "unhealthy"
)

// PipelineHealth contains health information for the entire pipeline
type PipelineHealth struct {
	Status            PipelineStatus           `json:"status"`
	ActiveStreams     int                      `json:"activeStreams"`
	HealthyStreams    int                      `json:"healthyStreams"`
	DegradedStreams   int                      `json:"degradedStreams"`
	TotalTranscripts  int64                    `json:"totalTranscripts"`
	TotalErrors       int64                    `json:"totalErrors"`
	Uptime            time.Duration            `json:"uptime"`
	StreamHealths     map[string]*StreamHealth `json:"streamHealths"`
	BackpressureLevel float64                  `json:"backpressureLevel"`
}

// Pipeline orchestrates STT -> Translate -> TTS flow using AWS services
type Pipeline struct {
	// Shared AWS clients (from client pool or created locally)
	transcribe *TranscribeClient
	translate  *TranslateClient
	polly      *PollyClient
	cache      *PipelineCache

	// Client pool reference (for shared clients mode)
	clientPool *AWSClientPool

	// Stream manager for language-based stream pooling
	streamManager *StreamManager

	// Per-speaker streams with last activity tracking (legacy mode)
	speakerStreams   map[string]*TranscribeStream
	streamLastActive map[string]time.Time
	streamsMu        sync.RWMutex

	// Output channels (compatible with ai.ChatStream)
	TranscriptChan chan *ai.TranscriptMessage
	AudioChan      chan *ai.AudioMessage
	ErrChan        chan error

	// Target languages for this room
	targetLanguages []string
	targetLangsMu   sync.RWMutex

	// Health monitoring
	startTime        time.Time
	totalTranscripts int64
	totalErrors      int64
	droppedMessages  int64 // Counter for dropped messages due to backpressure
	status           PipelineStatus
	statusMu         sync.RWMutex

	// Backpressure control
	backpressureActive int32 // atomic flag

	// Worker pools for translation and TTS (replaces semaphores in shared mode)
	translatePool *WorkerPool
	ttsPool       *WorkerPool

	// Semaphores for limiting concurrent API calls (legacy mode)
	translateSem chan struct{}
	ttsSem       chan struct{}

	// Mode flags
	useStreamManager bool // Use StreamManager for language-based pooling
	useWorkerPools   bool // Use WorkerPool instead of semaphores

	// Per-pipeline stream processors tracking (prevents collisions between pipelines)
	streamProcessors sync.Map

	// Speaker metadata storage (speakerID -> SpeakerMeta)
	speakerMeta   map[string]*SpeakerMeta
	speakerMetaMu sync.RWMutex

	// Lifecycle
	closed int32 // atomic flag to prevent double-close panics

	ctx    context.Context
	cancel context.CancelFunc
}

// SpeakerMeta stores speaker metadata for transcript messages
type SpeakerMeta struct {
	Nickname   string
	ProfileImg string
}

// PipelineConfig configuration for pipeline
type PipelineConfig struct {
	TargetLanguages  []string
	SampleRate       int32
	UseStreamManager bool // Enable language-based stream pooling
	UseWorkerPools   bool // Enable worker pools for translation/TTS
}

// NewPipeline creates a new AWS AI pipeline
func NewPipeline(ctx context.Context, cfg *appconfig.Config, pipelineCfg *PipelineConfig) (*Pipeline, error) {
	// Load AWS config using S3 credentials
	awsCfg, err := config.LoadDefaultConfig(ctx,
		config.WithRegion(cfg.S3.Region),
		config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(
			cfg.S3.AccessKeyID,
			cfg.S3.SecretAccessKey,
			"",
		)),
	)
	if err != nil {
		return nil, err
	}

	pCtx, cancel := context.WithCancel(ctx)

	sampleRate := int32(16000)
	if pipelineCfg != nil && pipelineCfg.SampleRate > 0 {
		sampleRate = pipelineCfg.SampleRate
	}

	targetLangs := []string{"en"}
	if pipelineCfg != nil && len(pipelineCfg.TargetLanguages) > 0 {
		targetLangs = pipelineCfg.TargetLanguages
	}

	log.Printf("[AWS Pipeline] Initializing with region=%s, sampleRate=%d, targetLangs=%v",
		cfg.S3.Region, sampleRate, targetLangs)

	pipeline := &Pipeline{
		transcribe:       NewTranscribeClient(awsCfg, sampleRate),
		translate:        NewTranslateClient(awsCfg),
		polly:            NewPollyClient(awsCfg),
		cache:            NewPipelineCache(DefaultCacheConfig()),
		speakerStreams:   make(map[string]*TranscribeStream),
		streamLastActive: make(map[string]time.Time),
		TranscriptChan:   make(chan *ai.TranscriptMessage, 100), // Increased buffer
		AudioChan:        make(chan *ai.AudioMessage, 200),      // Increased buffer
		ErrChan:          make(chan error, 20),
		targetLanguages:  targetLangs,
		startTime:        time.Now(),
		status:           PipelineStatusHealthy,
		translateSem:     make(chan struct{}, MaxConcurrentTranslate), // Limit concurrent translations
		ttsSem:           make(chan struct{}, MaxConcurrentTTS),       // Limit concurrent TTS
		speakerMeta:      make(map[string]*SpeakerMeta),
		ctx:              pCtx,
		cancel:           cancel,
	}

	// Start background goroutines
	go pipeline.streamTimeoutChecker()
	go pipeline.healthCheckLoop()

	log.Printf("[AWS Pipeline] Pipeline initialized successfully")

	return pipeline, nil
}

// NewPipelineWithClientPool creates a new AWS AI pipeline using shared clients from the client pool.
// This is the recommended way to create a Pipeline when you want to share AWS connections across rooms.
func NewPipelineWithClientPool(ctx context.Context, clientPool *AWSClientPool, pipelineCfg *PipelineConfig) (*Pipeline, error) {
	if clientPool == nil {
		return nil, fmt.Errorf("clientPool cannot be nil")
	}

	pCtx, cancel := context.WithCancel(ctx)

	targetLangs := []string{"en"}
	if pipelineCfg != nil && len(pipelineCfg.TargetLanguages) > 0 {
		targetLangs = pipelineCfg.TargetLanguages
	}

	// Acquire reference to client pool
	clientPool.Acquire()

	pipeline := &Pipeline{
		transcribe:       clientPool.Transcribe,
		translate:        clientPool.Translate,
		polly:            clientPool.Polly,
		clientPool:       clientPool,
		cache:            NewPipelineCache(DefaultCacheConfig()),
		speakerStreams:   make(map[string]*TranscribeStream),
		streamLastActive: make(map[string]time.Time),
		TranscriptChan:   make(chan *ai.TranscriptMessage, 100),
		AudioChan:        make(chan *ai.AudioMessage, 200),
		ErrChan:          make(chan error, 20),
		targetLanguages:  targetLangs,
		startTime:        time.Now(),
		status:           PipelineStatusHealthy,
		translateSem:     make(chan struct{}, MaxConcurrentTranslate),
		ttsSem:           make(chan struct{}, MaxConcurrentTTS),
		speakerMeta:      make(map[string]*SpeakerMeta),
		useStreamManager: pipelineCfg != nil && pipelineCfg.UseStreamManager,
		useWorkerPools:   pipelineCfg != nil && pipelineCfg.UseWorkerPools,
		ctx:              pCtx,
		cancel:           cancel,
	}

	// Initialize StreamManager for language-based pooling if enabled
	if pipeline.useStreamManager {
		pipeline.streamManager = NewStreamManager(pCtx, clientPool, DefaultStreamManagerConfig())
		pipeline.streamManager.SetOnStreamDead(func(sourceLang string) {
			log.Printf("[AWS Pipeline] Stream died for lang=%s, will recreate on next audio", sourceLang)
		})
		log.Printf("[AWS Pipeline] StreamManager enabled for language-based pooling")
	}

	// Initialize WorkerPools if enabled
	if pipeline.useWorkerPools {
		pipeline.translatePool = NewWorkerPool(pCtx, "translate", MaxConcurrentTranslate, 200)
		pipeline.ttsPool = NewWorkerPool(pCtx, "tts", MaxConcurrentTTS, 100)
		log.Printf("[AWS Pipeline] WorkerPools enabled (translate: %d workers, tts: %d workers)",
			MaxConcurrentTranslate, MaxConcurrentTTS)
	}

	// Start background goroutines (only for legacy mode)
	if !pipeline.useStreamManager {
		go pipeline.streamTimeoutChecker()
	}
	go pipeline.healthCheckLoop()

	log.Printf("[AWS Pipeline] Pipeline initialized with shared clients (streamManager=%v, workerPools=%v)",
		pipeline.useStreamManager, pipeline.useWorkerPools)

	return pipeline, nil
}

// streamTimeoutChecker periodically checks and closes idle streams
func (p *Pipeline) streamTimeoutChecker() {
	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-p.ctx.Done():
			return
		case <-ticker.C:
			p.closeIdleStreams()
		}
	}
}

// closeIdleStreams closes streams that have been idle for too long
func (p *Pipeline) closeIdleStreams() {
	// Collect streams to close while holding lock, then close outside lock to avoid deadlock
	type streamToClose struct {
		key      string
		stream   *TranscribeStream
		idleTime time.Duration
	}
	var toClose []streamToClose

	p.streamsMu.Lock()
	now := time.Now()
	for key, lastActive := range p.streamLastActive {
		idleTime := now.Sub(lastActive)
		if idleTime > StreamIdleTimeout {
			if stream, exists := p.speakerStreams[key]; exists {
				toClose = append(toClose, streamToClose{key, stream, idleTime})
				delete(p.speakerStreams, key)
				delete(p.streamLastActive, key)
			}
		}
	}
	p.streamsMu.Unlock()

	// Close streams outside the lock to prevent deadlock with callbacks
	for _, item := range toClose {
		item.stream.Close()
		log.Printf("[AWS Pipeline] Closed idle stream: %s (inactive for %v)", item.key, item.idleTime)
	}
}

// healthCheckLoop monitors overall pipeline health
func (p *Pipeline) healthCheckLoop() {
	ticker := time.NewTicker(PipelineHealthCheckTick)
	defer ticker.Stop()

	for {
		select {
		case <-p.ctx.Done():
			return
		case <-ticker.C:
			p.updateHealth()
		}
	}
}

// updateHealth updates the overall pipeline health status
func (p *Pipeline) updateHealth() {
	p.streamsMu.RLock()
	streamCount := len(p.speakerStreams)
	healthyCount := 0
	degradedCount := 0

	for _, stream := range p.speakerStreams {
		health := stream.GetHealth()
		if health != nil {
			switch health.Status {
			case StreamStatusHealthy:
				healthyCount++
			case StreamStatusDegraded:
				degradedCount++
			}
		}
	}
	p.streamsMu.RUnlock()

	// Calculate backpressure level based on channel usage
	transcriptUsage := float64(len(p.TranscriptChan)) / float64(cap(p.TranscriptChan))
	audioUsage := float64(len(p.AudioChan)) / float64(cap(p.AudioChan))
	backpressureLevel := (transcriptUsage + audioUsage) / 2

	// Update backpressure flag
	if backpressureLevel >= BackpressureThreshold {
		atomic.StoreInt32(&p.backpressureActive, 1)
		log.Printf("[AWS Pipeline] ⚠️ Backpressure active: %.1f%% capacity", backpressureLevel*100)
	} else {
		atomic.StoreInt32(&p.backpressureActive, 0)
	}

	// Determine overall status
	p.statusMu.Lock()
	if streamCount == 0 {
		p.status = PipelineStatusHealthy
	} else if healthyCount == streamCount {
		p.status = PipelineStatusHealthy
	} else if degradedCount > 0 || backpressureLevel >= BackpressureThreshold {
		p.status = PipelineStatusDegraded
	} else {
		p.status = PipelineStatusUnhealthy
	}
	p.statusMu.Unlock()
}

// GetHealth returns the current health status of the pipeline
func (p *Pipeline) GetHealth() *PipelineHealth {
	p.streamsMu.RLock()
	streamHealths := make(map[string]*StreamHealth)
	healthyCount := 0
	degradedCount := 0

	for key, stream := range p.speakerStreams {
		health := stream.GetHealth()
		if health != nil {
			streamHealths[key] = health
			switch health.Status {
			case StreamStatusHealthy:
				healthyCount++
			case StreamStatusDegraded:
				degradedCount++
			}
		}
	}
	activeStreams := len(p.speakerStreams)
	p.streamsMu.RUnlock()

	// Calculate backpressure level
	transcriptUsage := float64(len(p.TranscriptChan)) / float64(cap(p.TranscriptChan))
	audioUsage := float64(len(p.AudioChan)) / float64(cap(p.AudioChan))
	backpressureLevel := (transcriptUsage + audioUsage) / 2

	p.statusMu.RLock()
	status := p.status
	p.statusMu.RUnlock()

	return &PipelineHealth{
		Status:            status,
		ActiveStreams:     activeStreams,
		HealthyStreams:    healthyCount,
		DegradedStreams:   degradedCount,
		TotalTranscripts:  atomic.LoadInt64(&p.totalTranscripts),
		TotalErrors:       atomic.LoadInt64(&p.totalErrors),
		Uptime:            time.Since(p.startTime),
		StreamHealths:     streamHealths,
		BackpressureLevel: backpressureLevel,
	}
}

// IsBackpressureActive returns whether backpressure is currently active
func (p *Pipeline) IsBackpressureActive() bool {
	return atomic.LoadInt32(&p.backpressureActive) == 1
}

// ProcessAudio handles incoming audio from a speaker
func (p *Pipeline) ProcessAudio(speakerID, sourceLang, speakerName, profileImg string, audioData []byte) error {
	// Check backpressure - if active, skip some audio to prevent overflow
	if p.IsBackpressureActive() {
		// During backpressure, drop some audio to let the system catch up
		// This is better than blocking or crashing
		return nil
	}

	// Store speaker metadata for use in transcript messages
	p.speakerMetaMu.Lock()
	p.speakerMeta[speakerID] = &SpeakerMeta{
		Nickname:   speakerName,
		ProfileImg: profileImg,
	}
	p.speakerMetaMu.Unlock()

	stream, err := p.getOrCreateStream(speakerID, sourceLang)
	if err != nil {
		log.Printf("[AWS Pipeline] ERROR getting/creating stream: %v", err)
		atomic.AddInt64(&p.totalErrors, 1)
		return err
	}

	// Update last activity time for this stream
	key := speakerID + ":" + sourceLang
	p.streamsMu.Lock()
	p.streamLastActive[key] = time.Now()
	p.streamsMu.Unlock()

	if err := stream.SendAudio(audioData); err != nil {
		log.Printf("[AWS Pipeline] ERROR sending audio: %v", err)
		atomic.AddInt64(&p.totalErrors, 1)
		return err
	}

	return nil
}

// getSpeakerMeta retrieves speaker metadata by speakerID
func (p *Pipeline) getSpeakerMeta(speakerID string) *SpeakerMeta {
	p.speakerMetaMu.RLock()
	defer p.speakerMetaMu.RUnlock()
	return p.speakerMeta[speakerID]
}

// getOrCreateStream gets existing or creates new Transcribe stream for speaker
func (p *Pipeline) getOrCreateStream(speakerID, sourceLang string) (*TranscribeStream, error) {
	// Use StreamManager for language-based pooling if enabled
	if p.useStreamManager && p.streamManager != nil {
		stream, err := p.streamManager.GetOrCreateStream(speakerID, sourceLang)
		if err != nil {
			atomic.AddInt64(&p.totalErrors, 1)
			return nil, err
		}
		// Start processing transcripts if this is a new stream
		go p.processTranscriptsOnce(stream, sourceLang)
		return stream, nil
	}

	// Legacy mode: per-speaker streams
	key := speakerID + ":" + sourceLang

	// First try with read lock for fast path (existing healthy stream)
	p.streamsMu.RLock()
	stream, exists := p.speakerStreams[key]
	p.streamsMu.RUnlock()

	// Fast path: return existing healthy stream
	if exists && !stream.IsClosed() {
		// Check if stream needs rotation (approaching 4-hour limit)
		if stream.GetStreamAge() > StreamMaxAge-10*time.Minute {
			log.Printf("[AWS Pipeline] Stream %s approaching max age, will rotate on next audio", speakerID)
		}
		return stream, nil
	}

	// Slow path: need to create or replace stream
	// Use single write lock to prevent race conditions
	p.streamsMu.Lock()
	defer p.streamsMu.Unlock()

	// Double-check under write lock - another goroutine may have created it
	if stream, exists := p.speakerStreams[key]; exists {
		if !stream.IsClosed() {
			return stream, nil
		}
		// Stream is dead, remove it immediately
		delete(p.speakerStreams, key)
		delete(p.streamLastActive, key)
		log.Printf("[AWS Pipeline] Removed dead stream for speaker %s, will recreate", speakerID)
	}

	// Create new stream (still holding write lock to prevent concurrent creation)
	stream, err := p.transcribe.StartStream(p.ctx, speakerID, sourceLang)
	if err != nil {
		log.Printf("[AWS Pipeline] Failed to create Transcribe stream for speaker %s: %v", speakerID, err)
		atomic.AddInt64(&p.totalErrors, 1)
		return nil, err
	}

	// Set callbacks for stream lifecycle events with immediate cleanup
	stream.SetCallbacks(
		// onDead callback - immediately remove from map
		func(spkID, srcLang string, attempt int) {
			log.Printf("[AWS Pipeline] ☠️ Stream died for speaker %s (lang: %s)", spkID, srcLang)
			atomic.AddInt64(&p.totalErrors, 1)
			// Immediately remove dead stream from map (use goroutine to avoid deadlock)
			go p.removeDeadStream(spkID, srcLang)
		},
		// onReconnect callback
		func(spkID, srcLang string, attempt int) {
			log.Printf("[AWS Pipeline] 🔄 Stream reconnecting for speaker %s (attempt: %d)", spkID, attempt)
		},
	)

	p.speakerStreams[key] = stream
	p.streamLastActive[key] = time.Now()

	// Start processing transcripts from this stream
	go p.processTranscripts(stream, sourceLang)

	log.Printf("[AWS Pipeline] Created Transcribe stream for speaker %s (lang: %s)", speakerID, sourceLang)

	return stream, nil
}

// removeDeadStream immediately removes a dead stream from the map
func (p *Pipeline) removeDeadStream(speakerID, sourceLang string) {
	key := speakerID + ":" + sourceLang
	p.streamsMu.Lock()
	defer p.streamsMu.Unlock()

	if stream, exists := p.speakerStreams[key]; exists {
		if stream.IsClosed() {
			delete(p.speakerStreams, key)
			delete(p.streamLastActive, key)
			log.Printf("[AWS Pipeline] Immediately removed dead stream: %s", key)
		}
	}
}

// processTranscriptsOnce is a wrapper that ensures only one goroutine processes a stream per speaker.
// Uses per-pipeline tracking to avoid collisions between pipelines.
// FIX: Changed from sourceLang to speakerID as key to support multiple speakers with same language.
func (p *Pipeline) processTranscriptsOnce(stream *TranscribeStream, sourceLang string) {
	// Use speakerID as key to ensure each speaker's stream gets its own processor
	// This fixes the bug where two speakers with the same sourceLang would have
	// the second speaker's transcripts ignored.
	key := stream.GetSpeakerID()
	if _, loaded := p.streamProcessors.LoadOrStore(key, true); loaded {
		// Another goroutine is already processing this speaker's stream
		return
	}
	defer p.streamProcessors.Delete(key)

	p.processTranscripts(stream, sourceLang)
}

// processTranscripts handles transcripts from a speaker stream
func (p *Pipeline) processTranscripts(stream *TranscribeStream, sourceLang string) {
	log.Printf("[AWS Pipeline] 🔄 processTranscripts started for stream (sourceLang: %s)", sourceLang)

	// Track last partial text for delta TTS (only send new portion)
	var lastPartialText string
	var lastTTSSentText string

	for result := range stream.TranscriptChan {
		// Increment transcript counter
		atomic.AddInt64(&p.totalTranscripts, 1)

		log.Printf("[AWS Pipeline] 📨 Received transcript: '%s' (isFinal: %v, confidence: %.2f, lang: %s)",
			result.Text, result.IsFinal, result.Confidence, sourceLang)

		// For Korean→Japanese: translate and TTS partials immediately for real-time experience
		if sourceLang == "ko" && !result.IsFinal {
			text := strings.TrimSpace(result.Text)
			sentTranslatedPartial := false

			// Only process if text is long enough and different from last
			if len([]rune(text)) >= 3 && text != lastPartialText {
				// Check if Japanese is in target languages
				p.targetLangsMu.RLock()
				hasJapaneseTarget := false
				for _, lang := range p.targetLanguages {
					if lang == "ja" {
						hasJapaneseTarget = true
						break
					}
				}
				p.targetLangsMu.RUnlock()

				if hasJapaneseTarget {
					// Calculate delta (new portion only)
					deltaText := text
					if strings.HasPrefix(text, lastTTSSentText) && len(text) > len(lastTTSSentText) {
						deltaText = strings.TrimSpace(text[len(lastTTSSentText):])
					}

					// Only send TTS if delta is meaningful (at least 2 characters)
					if len([]rune(deltaText)) >= 2 {
						lastTTSSentText = text
						// Process delta with translation AND TTS for Japanese
						// This already sends transcript, so don't send again
						go p.processPartialWithTranslationAndTTS(result, sourceLang, "ja", deltaText)
						sentTranslatedPartial = true
					}
				}
				lastPartialText = text
			}

			// Only send regular partial if we didn't already send a translated partial
			if !sentTranslatedPartial {
				p.sendPartialTranscript(result)
			}
			continue
		}

		// For other languages: send partial without translation
		if !result.IsFinal {
			p.sendPartialTranscript(result)
			continue
		}

		// For Korean→Japanese: skip TTS in final since we already sent chunk TTS
		// Check if we sent any partial TTS
		sentPartialTTS := lastTTSSentText != ""

		// Reset partial tracking for final result
		lastPartialText = ""
		lastTTSSentText = ""

		// Process final result: Translate + TTS (skip TTS if we already sent partials for KO→JA)
		if sourceLang == "ko" && sentPartialTTS {
			// Check if Japanese is in targets
			p.targetLangsMu.RLock()
			hasJapaneseTarget := false
			for _, lang := range p.targetLanguages {
				if lang == "ja" {
					hasJapaneseTarget = true
					break
				}
			}
			p.targetLangsMu.RUnlock()

			if hasJapaneseTarget {
				// Skip TTS for Japanese since we already sent chunk TTS
				go p.processFinalTranscriptNoTTS(result, sourceLang, "ja")
				continue
			}
		}

		// Process final result: Translate + TTS
		go p.processFinalTranscript(result, sourceLang)
	}
	log.Printf("[AWS Pipeline] 🔚 processTranscripts ended for stream")
}

// processPartialWithTranslationAndTTS handles partial transcripts with translation AND TTS (for Korean→Japanese real-time)
// deltaText is the new portion of text (not already sent for TTS)
func (p *Pipeline) processPartialWithTranslationAndTTS(result *TranscriptResult, sourceLang, targetLang, deltaText string) {
	ctx, cancel := context.WithTimeout(p.ctx, 5*time.Second)
	defer cancel()

	if deltaText == "" {
		return
	}

	log.Printf("[AWS Pipeline] 🇯🇵 Processing delta chunk: '%s'", deltaText)

	// Translate the delta text
	trans, err := p.translate.Translate(ctx, deltaText, sourceLang, targetLang)
	if err != nil {
		log.Printf("[AWS Pipeline] Partial translation error: %v", err)
		return
	}

	if trans.TranslatedText == "" {
		return
	}

	// Get speaker metadata for nickname and profile
	speakerInfo := &pb.SpeakerInfo{
		ParticipantId:  result.SpeakerID,
		SourceLanguage: sourceLang,
	}
	if meta := p.getSpeakerMeta(result.SpeakerID); meta != nil {
		speakerInfo.Nickname = meta.Nickname
		speakerInfo.ProfileImg = meta.ProfileImg
	}

	// Build transcript message (with full original text for display)
	transcriptMsg := &ai.TranscriptMessage{
		ID:               uuid.New().String(),
		OriginalText:     result.Text, // Full text for display
		OriginalLanguage: sourceLang,
		IsPartial:        true,
		IsFinal:          false,
		TimestampMs:      result.TimestampMs,
		Confidence:       result.Confidence,
		Translations: []*pb.TranslationEntry{
			{
				TargetLanguage: targetLang,
				TranslatedText: trans.TranslatedText, // Delta translation
			},
		},
		Speaker: speakerInfo,
	}

	// Send transcript
	select {
	case p.TranscriptChan <- transcriptMsg:
		log.Printf("[AWS Pipeline] 🇯🇵 KO→JA chunk: '%s' → '%s'", deltaText, trans.TranslatedText)
	default:
		log.Printf("[AWS Pipeline] Transcript channel full (KO→JA partial)")
	}

	// Generate TTS immediately for the delta translation
	audio, err := p.polly.Synthesize(ctx, trans.TranslatedText, targetLang)
	if err != nil {
		log.Printf("[AWS Pipeline] Partial TTS error: %v", err)
		return
	}

	if len(audio.AudioData) == 0 {
		return
	}

	// Send TTS audio
	audioMsg := &ai.AudioMessage{
		TranscriptID:         transcriptMsg.ID,
		TargetLanguage:       targetLang,
		AudioData:            audio.AudioData,
		Format:               audio.Format,
		SampleRate:           uint32(audio.SampleRate),
		SpeakerParticipantID: result.SpeakerID,
	}

	select {
	case p.AudioChan <- audioMsg:
		log.Printf("[AWS Pipeline] 🔊 KO→JA chunk TTS: '%s' (%d bytes)", trans.TranslatedText, len(audio.AudioData))
	default:
		log.Printf("[AWS Pipeline] Audio channel full (KO→JA partial)")
	}
}

// sendPartialTranscript sends a partial transcript without translation
func (p *Pipeline) sendPartialTranscript(result *TranscriptResult) {
	// Apply lighter noise filtering for partials (allow lower confidence for real-time feedback)
	text := strings.TrimSpace(result.Text)
	runes := []rune(text)

	// Language-specific minimum length to reduce choppy updates
	// Japanese tends to have more granular partials, so require more characters
	minLen := 2
	switch result.Language {
	case "ja":
		minLen = 4 // Japanese: require at least 4 characters to reduce word-by-word updates
	case "en":
		minLen = 3 // English: require at least 3 characters
	case "zh":
		minLen = 3 // Chinese: require at least 3 characters
	}

	// Skip too short partials
	if len(runes) < minLen {
		return
	}

	// Skip very low confidence partials
	if result.Confidence > 0 && result.Confidence < 0.4 {
		return
	}

	// Skip repeated single characters
	if len(runes) >= 3 {
		allSame := true
		for i := 1; i < len(runes); i++ {
			if runes[i] != runes[0] {
				allSame = false
				break
			}
		}
		if allSame {
			return
		}
	}

	// Get speaker metadata for nickname and profile
	speakerInfo := &pb.SpeakerInfo{
		ParticipantId:  result.SpeakerID,
		SourceLanguage: result.Language,
	}
	if meta := p.getSpeakerMeta(result.SpeakerID); meta != nil {
		speakerInfo.Nickname = meta.Nickname
		speakerInfo.ProfileImg = meta.ProfileImg
	}

	msg := &ai.TranscriptMessage{
		ID:               uuid.New().String(),
		OriginalText:     result.Text,
		OriginalLanguage: result.Language,
		IsPartial:        true,
		IsFinal:          false,
		TimestampMs:      result.TimestampMs,
		Confidence:       result.Confidence,
		Speaker:          speakerInfo,
	}

	select {
	case p.TranscriptChan <- msg:
	default:
		log.Printf("[AWS Pipeline] Transcript channel full (partial)")
	}
}

// Noise filtering constants
const (
	MinTextLengthForTranslation = 2
	MinConfidenceThreshold      = 0.5 // Lowered from 0.65 to reduce false filtering
)

// Common noise words/phrases that are often hallucinated by STT
var noisePatterns = map[string][]string{
	"ko": {
		"네", "예", "아", "어", "음", "응", "흠", "에", "으", "이",
		"그", "저", "뭐", "좀", "자", "서", "거", "게", "요", "야",
		"MBC 뉴스", "KBS 뉴스", "SBS 뉴스", "YTN", "JTBC",
		"자막 제공", "자막 협찬", "자막", "제공", "협찬",
		"구독", "좋아요", "알림", "시청", "감사",
	},
	"en": {
		"um", "uh", "ah", "oh", "eh", "hm", "hmm", "yeah", "yep", "nope",
		"like", "so", "well", "okay", "ok", "right", "you know",
		"subscribe", "like and subscribe", "thanks for watching",
		"MBC News", "KBS News", "breaking news",
	},
	"ja": {
		"えー", "あー", "うん", "ええ", "はい", "ねえ", "まあ",
		"字幕", "提供", "ニュース",
	},
	"zh": {
		"嗯", "啊", "哦", "呃", "好", "对", "是",
		"字幕", "新闻", "订阅",
	},
}

// isNoiseText checks if text is likely noise/hallucination
func isNoiseText(text string, sourceLang string, confidence float32) bool {
	text = strings.TrimSpace(text)
	runes := []rune(text)

	// Empty or too short
	if len(runes) < MinTextLengthForTranslation {
		return true
	}

	// Low confidence
	if confidence > 0 && confidence < MinConfidenceThreshold {
		return true
	}

	// Check for repeated characters (e.g., "아아아아", "ㅋㅋㅋ")
	if len(runes) >= 3 {
		allSame := true
		for i := 1; i < len(runes); i++ {
			if runes[i] != runes[0] {
				allSame = false
				break
			}
		}
		if allSame {
			return true
		}
	}

	// Check for punctuation/whitespace only
	hasAlphanumeric := false
	for _, r := range runes {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') ||
			(r >= '0' && r <= '9') ||
			(r >= 0xAC00 && r <= 0xD7AF) || // Korean Hangul
			(r >= 0x3040 && r <= 0x30FF) || // Japanese Hiragana/Katakana
			(r >= 0x4E00 && r <= 0x9FFF) { // Chinese characters
			hasAlphanumeric = true
			break
		}
	}
	if !hasAlphanumeric {
		return true
	}

	// Check against noise patterns for the source language
	textLower := strings.ToLower(text)

	// Check all languages (hallucinations can come in wrong language)
	for _, patterns := range noisePatterns {
		for _, pattern := range patterns {
			patternLower := strings.ToLower(pattern)
			// Exact match or text is just the noise pattern
			if textLower == patternLower {
				return true
			}
			// Text starts and ends with noise pattern (allowing for minor variations)
			if len(runes) <= len([]rune(pattern))+2 && strings.Contains(textLower, patternLower) {
				return true
			}
		}
	}

	return false
}

// processFinalTranscript handles translation and TTS for final transcripts
func (p *Pipeline) processFinalTranscript(result *TranscriptResult, sourceLang string) {
	ctx, cancel := context.WithTimeout(p.ctx, 15*time.Second)
	defer cancel()

	// Get target languages
	p.targetLangsMu.RLock()
	targetLangs := make([]string, len(p.targetLanguages))
	copy(targetLangs, p.targetLanguages)
	p.targetLangsMu.RUnlock()

	// Enhanced noise filtering
	text := strings.TrimSpace(result.Text)
	if isNoiseText(text, sourceLang, result.Confidence) {
		// Only log if it's not a super short text to reduce log spam
		if len([]rune(text)) >= 2 {
			log.Printf("[AWS Pipeline] Filtering noise: '%s' (confidence: %.2f)", text, result.Confidence)
		}
		return
	}

	log.Printf("[AWS Pipeline] Processing final transcript from %s: '%s' (lang: %s, confidence: %.2f, targetLangs: %v)",
		result.SpeakerID, result.Text, sourceLang, result.Confidence, targetLangs)

	// Translate to all target languages (with caching and semaphore)
	translations := make(map[string]*TranslationResult)
	var translateWg sync.WaitGroup
	var translateMu sync.Mutex

	for _, targetLang := range targetLangs {
		// FIX: Don't skip same language - generate passthrough TTS so listeners always receive audio
		// This ensures bidirectional communication even when source == target
		if targetLang == sourceLang {
			// For same language, use original text as "translation" (passthrough)
			translateMu.Lock()
			translations[targetLang] = &TranslationResult{
				SourceText:     result.Text,
				TranslatedText: result.Text, // Passthrough: same text
				SourceLanguage: sourceLang,
				TargetLanguage: targetLang,
			}
			translateMu.Unlock()
			log.Printf("[AWS Pipeline] Passthrough translation for %s: '%s'", targetLang, result.Text)
			continue
		}

		translateWg.Add(1)
		go func(tgtLang string) {
			defer translateWg.Done()

			// Check cache first (before acquiring semaphore)
			if cached, ok := p.cache.GetTranslation(result.Text, sourceLang, tgtLang); ok {
				translateMu.Lock()
				translations[tgtLang] = cached
				translateMu.Unlock()
				return
			}

			// Acquire translate semaphore with timeout
			select {
			case p.translateSem <- struct{}{}:
				defer func() { <-p.translateSem }()
			case <-ctx.Done():
				log.Printf("[AWS Pipeline] Translation timeout waiting for semaphore: %s", tgtLang)
				return
			}

			// Call Translate API with timeout
			apiCtx, apiCancel := context.WithTimeout(ctx, APICallTimeout)
			defer apiCancel()

			trans, err := p.translate.Translate(apiCtx, result.Text, sourceLang, tgtLang)
			if err != nil {
				log.Printf("[AWS Pipeline] Translation error for %s: %v", tgtLang, err)
				atomic.AddInt64(&p.totalErrors, 1)
				return
			}

			// Store in cache
			p.cache.SetTranslation(result.Text, sourceLang, tgtLang, trans)

			translateMu.Lock()
			translations[tgtLang] = trans
			translateMu.Unlock()
		}(targetLang)
	}
	translateWg.Wait()

	// Get speaker metadata for nickname and profile
	speakerInfo := &pb.SpeakerInfo{
		ParticipantId:  result.SpeakerID,
		SourceLanguage: sourceLang,
	}
	if meta := p.getSpeakerMeta(result.SpeakerID); meta != nil {
		speakerInfo.Nickname = meta.Nickname
		speakerInfo.ProfileImg = meta.ProfileImg
	}

	// Build transcript message with translations
	transcriptMsg := &ai.TranscriptMessage{
		ID:               uuid.New().String(),
		OriginalText:     result.Text,
		OriginalLanguage: sourceLang,
		IsPartial:        false,
		IsFinal:          true,
		TimestampMs:      result.TimestampMs,
		Confidence:       result.Confidence,
		Translations:     make([]*pb.TranslationEntry, 0),
		Speaker:          speakerInfo,
	}

	for lang, trans := range translations {
		if trans != nil {
			transcriptMsg.Translations = append(transcriptMsg.Translations, &pb.TranslationEntry{
				TargetLanguage: lang,
				TranslatedText: trans.TranslatedText,
			})
		}
	}

	// Send transcript with graceful degradation
	if !p.sendTranscript(transcriptMsg) {
		atomic.AddInt64(&p.droppedMessages, 1)
	}

	// Generate TTS for each target language (parallel, with caching and semaphore)
	// FIX: Now includes passthrough TTS for same language (source == target)
	log.Printf("[AWS Pipeline] 🔊 Generating TTS for %d translations (including passthrough)", len(translations))

	var wg sync.WaitGroup
	for lang, trans := range translations {
		// FIX: Don't skip TTS for original language anymore - passthrough TTS ensures all listeners receive audio
		// This is needed when source == target (e.g., English speaker, English listeners)
		if trans == nil || trans.TranslatedText == "" {
			continue
		}

		wg.Add(1)
		go func(targetLang, text string) {
			defer wg.Done()

			var audioData []byte
			var format string = "mp3"
			var sampleRate int32 = 24000

			// Check TTS cache first (before acquiring semaphore)
			if cached, ok := p.cache.GetTTS(text, targetLang); ok {
				audioData = cached
			} else {
				// Acquire TTS semaphore with timeout
				select {
				case p.ttsSem <- struct{}{}:
					defer func() { <-p.ttsSem }()
				case <-ctx.Done():
					log.Printf("[AWS Pipeline] TTS timeout waiting for semaphore: %s", targetLang)
					return
				}

				// Call Polly API with timeout
				apiCtx, apiCancel := context.WithTimeout(ctx, APICallTimeout)
				defer apiCancel()

				audio, err := p.polly.Synthesize(apiCtx, text, targetLang)
				if err != nil {
					log.Printf("[AWS Pipeline] ❌ TTS error for %s: %v", targetLang, err)
					atomic.AddInt64(&p.totalErrors, 1)
					return
				}

				if len(audio.AudioData) == 0 {
					return
				}

				// Store in cache
				p.cache.SetTTS(text, targetLang, audio.AudioData)

				audioData = audio.AudioData
				format = audio.Format
				sampleRate = audio.SampleRate
			}

			audioMsg := &ai.AudioMessage{
				TranscriptID:         transcriptMsg.ID,
				TargetLanguage:       targetLang,
				AudioData:            audioData,
				Format:               format,
				SampleRate:           uint32(sampleRate),
				SpeakerParticipantID: result.SpeakerID,
			}

			if !p.sendAudio(audioMsg) {
				atomic.AddInt64(&p.droppedMessages, 1)
			}
		}(lang, trans.TranslatedText)
	}
	wg.Wait()
}

// sendTranscript sends a transcript message with graceful degradation
func (p *Pipeline) sendTranscript(msg *ai.TranscriptMessage) bool {
	// Try non-blocking send first
	select {
	case p.TranscriptChan <- msg:
		return true
	default:
	}

	// Channel full - try with short timeout for graceful degradation
	select {
	case p.TranscriptChan <- msg:
		return true
	case <-time.After(100 * time.Millisecond):
		log.Printf("[AWS Pipeline] ⚠️ Transcript channel full, dropping message")
		return false
	}
}

// sendAudio sends an audio message with graceful degradation
func (p *Pipeline) sendAudio(msg *ai.AudioMessage) bool {
	// Try non-blocking send first
	select {
	case p.AudioChan <- msg:
		return true
	default:
	}

	// Channel full - try with short timeout for graceful degradation
	select {
	case p.AudioChan <- msg:
		return true
	case <-time.After(100 * time.Millisecond):
		log.Printf("[AWS Pipeline] ⚠️ Audio channel full, dropping message for %s", msg.TargetLanguage)
		return false
	}
}

// processFinalTranscriptNoTTS handles translation for final transcripts, but skips TTS for specified language
// Used when chunk TTS was already sent during partials (e.g., Korean→Japanese real-time TTS)
func (p *Pipeline) processFinalTranscriptNoTTS(result *TranscriptResult, sourceLang, skipTTSLang string) {
	ctx, cancel := context.WithTimeout(p.ctx, 15*time.Second)
	defer cancel()

	// Get target languages
	p.targetLangsMu.RLock()
	targetLangs := make([]string, len(p.targetLanguages))
	copy(targetLangs, p.targetLanguages)
	p.targetLangsMu.RUnlock()

	// Enhanced noise filtering
	text := strings.TrimSpace(result.Text)
	if isNoiseText(text, sourceLang, result.Confidence) {
		if len([]rune(text)) >= 2 {
			log.Printf("[AWS Pipeline] Filtering noise (NoTTS): '%s' (confidence: %.2f)", text, result.Confidence)
		}
		return
	}

	log.Printf("[AWS Pipeline] Processing final transcript (skip TTS for %s): '%s'", skipTTSLang, result.Text)

	// Translate to all target languages (with caching and semaphore)
	translations := make(map[string]*TranslationResult)
	var translateWg sync.WaitGroup
	var translateMu sync.Mutex

	for _, targetLang := range targetLangs {
		if targetLang == sourceLang {
			continue
		}

		translateWg.Add(1)
		go func(tgtLang string) {
			defer translateWg.Done()

			// Check cache first
			if cached, ok := p.cache.GetTranslation(result.Text, sourceLang, tgtLang); ok {
				translateMu.Lock()
				translations[tgtLang] = cached
				translateMu.Unlock()
				return
			}

			// Acquire translate semaphore with timeout
			select {
			case p.translateSem <- struct{}{}:
				defer func() { <-p.translateSem }()
			case <-ctx.Done():
				return
			}

			// Call Translate API with timeout
			apiCtx, apiCancel := context.WithTimeout(ctx, APICallTimeout)
			defer apiCancel()

			trans, err := p.translate.Translate(apiCtx, result.Text, sourceLang, tgtLang)
			if err != nil {
				log.Printf("[AWS Pipeline] Translation error for %s: %v", tgtLang, err)
				atomic.AddInt64(&p.totalErrors, 1)
				return
			}

			// Store in cache
			p.cache.SetTranslation(result.Text, sourceLang, tgtLang, trans)

			translateMu.Lock()
			translations[tgtLang] = trans
			translateMu.Unlock()
		}(targetLang)
	}
	translateWg.Wait()

	// Get speaker metadata for nickname and profile
	speakerInfo := &pb.SpeakerInfo{
		ParticipantId:  result.SpeakerID,
		SourceLanguage: sourceLang,
	}
	if meta := p.getSpeakerMeta(result.SpeakerID); meta != nil {
		speakerInfo.Nickname = meta.Nickname
		speakerInfo.ProfileImg = meta.ProfileImg
	}

	// Build transcript message with translations
	transcriptMsg := &ai.TranscriptMessage{
		ID:               uuid.New().String(),
		OriginalText:     result.Text,
		OriginalLanguage: sourceLang,
		IsPartial:        false,
		IsFinal:          true,
		TimestampMs:      result.TimestampMs,
		Confidence:       result.Confidence,
		Translations:     make([]*pb.TranslationEntry, 0),
		Speaker:          speakerInfo,
	}

	for lang, trans := range translations {
		if trans != nil {
			transcriptMsg.Translations = append(transcriptMsg.Translations, &pb.TranslationEntry{
				TargetLanguage: lang,
				TranslatedText: trans.TranslatedText,
			})
		}
	}

	// Send transcript with graceful degradation
	if !p.sendTranscript(transcriptMsg) {
		atomic.AddInt64(&p.droppedMessages, 1)
	}

	// Generate TTS for each target language EXCEPT skipTTSLang (with semaphore)
	var wg sync.WaitGroup
	for lang, trans := range translations {
		if lang == sourceLang || lang == skipTTSLang {
			continue
		}
		if trans == nil || trans.TranslatedText == "" {
			continue
		}

		wg.Add(1)
		go func(targetLang, text string) {
			defer wg.Done()

			var audioData []byte
			var format string = "mp3"
			var sampleRate int32 = 24000

			// Check TTS cache first
			if cached, ok := p.cache.GetTTS(text, targetLang); ok {
				audioData = cached
			} else {
				// Acquire TTS semaphore with timeout
				select {
				case p.ttsSem <- struct{}{}:
					defer func() { <-p.ttsSem }()
				case <-ctx.Done():
					return
				}

				// Call Polly API with timeout
				apiCtx, apiCancel := context.WithTimeout(ctx, APICallTimeout)
				defer apiCancel()

				audio, err := p.polly.Synthesize(apiCtx, text, targetLang)
				if err != nil {
					log.Printf("[AWS Pipeline] ❌ TTS error for %s: %v", targetLang, err)
					atomic.AddInt64(&p.totalErrors, 1)
					return
				}

				if len(audio.AudioData) == 0 {
					return
				}

				// Store in cache
				p.cache.SetTTS(text, targetLang, audio.AudioData)

				audioData = audio.AudioData
				format = audio.Format
				sampleRate = audio.SampleRate
			}

			audioMsg := &ai.AudioMessage{
				TranscriptID:         transcriptMsg.ID,
				TargetLanguage:       targetLang,
				AudioData:            audioData,
				Format:               format,
				SampleRate:           uint32(sampleRate),
				SpeakerParticipantID: result.SpeakerID,
			}

			if !p.sendAudio(audioMsg) {
				atomic.AddInt64(&p.droppedMessages, 1)
			}
		}(lang, trans.TranslatedText)
	}
	wg.Wait()
}

// sendError sends an error to the error channel
func (p *Pipeline) sendError(err error) {
	select {
	case p.ErrChan <- err:
	default:
	}
}

// UpdateTargetLanguages updates the list of target languages
func (p *Pipeline) UpdateTargetLanguages(langs []string) {
	p.targetLangsMu.Lock()
	defer p.targetLangsMu.Unlock()
	p.targetLanguages = langs
	log.Printf("[AWS Pipeline] Updated target languages: %v", langs)
}

// RemoveSpeakerStream removes a speaker's transcription stream
func (p *Pipeline) RemoveSpeakerStream(speakerID, sourceLang string) {
	// Use StreamManager if enabled
	if p.useStreamManager && p.streamManager != nil {
		p.streamManager.ReleaseSpeaker(speakerID, sourceLang)
		return
	}

	// Legacy mode
	key := speakerID + ":" + sourceLang

	p.streamsMu.Lock()
	defer p.streamsMu.Unlock()

	if stream, exists := p.speakerStreams[key]; exists {
		stream.Close()
		delete(p.speakerStreams, key)
		delete(p.streamLastActive, key)
		log.Printf("[AWS Pipeline] Removed stream for speaker %s", speakerID)
	}
}

// Close shuts down the pipeline
func (p *Pipeline) Close() error {
	// Prevent double-close panics
	if !atomic.CompareAndSwapInt32(&p.closed, 0, 1) {
		return nil // Already closed
	}

	p.cancel()

	// Close StreamManager if using language-based pooling
	if p.streamManager != nil {
		p.streamManager.Close()
	}

	// Close legacy per-speaker streams
	p.streamsMu.Lock()
	for key, stream := range p.speakerStreams {
		stream.Close()
		delete(p.speakerStreams, key)
	}
	p.streamsMu.Unlock()

	// Close worker pools if using them
	if p.translatePool != nil {
		p.translatePool.Close()
	}
	if p.ttsPool != nil {
		p.ttsPool.Close()
	}

	// Close cache
	if p.cache != nil {
		p.cache.Close()
	}

	// Release client pool reference
	if p.clientPool != nil {
		p.clientPool.Release()
	}

	close(p.TranscriptChan)
	close(p.AudioChan)
	close(p.ErrChan)

	log.Printf("[AWS Pipeline] Pipeline closed")
	return nil
}
