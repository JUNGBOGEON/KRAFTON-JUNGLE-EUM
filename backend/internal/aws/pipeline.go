package aws

import (
	"context"
	"log"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/google/uuid"

	"realtime-backend/internal/ai"
	appconfig "realtime-backend/internal/config"
	"realtime-backend/pb"
)

// Stream timeout configuration
const (
	StreamIdleTimeout = 30 * time.Minute // Close stream after 30 minutes of inactivity
)

// Pipeline orchestrates STT -> Translate -> TTS flow using AWS services
type Pipeline struct {
	transcribe *TranscribeClient
	translate  *TranslateClient
	polly      *PollyClient
	cache      *PipelineCache

	// Per-speaker streams with last activity tracking
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

	ctx    context.Context
	cancel context.CancelFunc
}

// PipelineConfig configuration for pipeline
type PipelineConfig struct {
	TargetLanguages []string
	SampleRate      int32
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
		TranscriptChan:   make(chan *ai.TranscriptMessage, 50),
		AudioChan:        make(chan *ai.AudioMessage, 100),
		ErrChan:          make(chan error, 10),
		targetLanguages:  targetLangs,
		ctx:              pCtx,
		cancel:           cancel,
	}

	// Start stream timeout checker
	go pipeline.streamTimeoutChecker()

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
	p.streamsMu.Lock()
	defer p.streamsMu.Unlock()

	now := time.Now()
	for key, lastActive := range p.streamLastActive {
		if now.Sub(lastActive) > StreamIdleTimeout {
			if stream, exists := p.speakerStreams[key]; exists {
				stream.Close()
				delete(p.speakerStreams, key)
				delete(p.streamLastActive, key)
				log.Printf("[AWS Pipeline] Closed idle stream: %s (inactive for %v)", key, now.Sub(lastActive))
			}
		}
	}
}

// ProcessAudio handles incoming audio from a speaker
func (p *Pipeline) ProcessAudio(speakerID, sourceLang, speakerName string, audioData []byte) error {
	stream, err := p.getOrCreateStream(speakerID, sourceLang)
	if err != nil {
		return err
	}

	// Update last activity time for this stream
	key := speakerID + ":" + sourceLang
	p.streamsMu.Lock()
	p.streamLastActive[key] = time.Now()
	p.streamsMu.Unlock()

	return stream.SendAudio(audioData)
}

// getOrCreateStream gets existing or creates new Transcribe stream for speaker
func (p *Pipeline) getOrCreateStream(speakerID, sourceLang string) (*TranscribeStream, error) {
	key := speakerID + ":" + sourceLang

	p.streamsMu.RLock()
	stream, exists := p.speakerStreams[key]
	p.streamsMu.RUnlock()

	if exists {
		return stream, nil
	}

	p.streamsMu.Lock()
	defer p.streamsMu.Unlock()

	// Double-check
	if stream, exists := p.speakerStreams[key]; exists {
		return stream, nil
	}

	// Create new stream
	stream, err := p.transcribe.StartStream(p.ctx, speakerID, sourceLang)
	if err != nil {
		log.Printf("[AWS Pipeline] Failed to create Transcribe stream for speaker %s: %v", speakerID, err)
		return nil, err
	}

	p.speakerStreams[key] = stream

	// Start processing transcripts from this stream
	go p.processTranscripts(stream, sourceLang)

	log.Printf("[AWS Pipeline] Created Transcribe stream for speaker %s (lang: %s)", speakerID, sourceLang)

	return stream, nil
}

// processTranscripts handles transcripts from a speaker stream
func (p *Pipeline) processTranscripts(stream *TranscribeStream, sourceLang string) {
	for result := range stream.TranscriptChan {
		// Only process final results for translation + TTS
		if !result.IsFinal {
			// Send partial result without translation
			p.sendPartialTranscript(result)
			continue
		}

		// Process final result: Translate + TTS
		go p.processFinalTranscript(result, sourceLang)
	}
}

// sendPartialTranscript sends a partial transcript without translation
func (p *Pipeline) sendPartialTranscript(result *TranscriptResult) {
	msg := &ai.TranscriptMessage{
		ID:               uuid.New().String(),
		OriginalText:     result.Text,
		OriginalLanguage: result.Language,
		IsPartial:        true,
		IsFinal:          false,
		TimestampMs:      result.TimestampMs,
		Confidence:       result.Confidence,
		Speaker: &pb.SpeakerInfo{
			ParticipantId:  result.SpeakerID,
			SourceLanguage: result.Language,
		},
	}

	select {
	case p.TranscriptChan <- msg:
	default:
		log.Printf("[AWS Pipeline] Transcript channel full (partial)")
	}
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

	// Skip empty text
	if result.Text == "" {
		return
	}

	log.Printf("[AWS Pipeline] Processing final transcript from %s: '%s' (lang: %s)",
		result.SpeakerID, result.Text, sourceLang)

	// Translate to all target languages (with caching)
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

			// Call Translate API
			trans, err := p.translate.Translate(ctx, result.Text, sourceLang, tgtLang)
			if err != nil {
				log.Printf("[AWS Pipeline] Translation error for %s: %v", tgtLang, err)
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
		Speaker: &pb.SpeakerInfo{
			ParticipantId:  result.SpeakerID,
			SourceLanguage: sourceLang,
		},
	}

	for lang, trans := range translations {
		if trans != nil {
			transcriptMsg.Translations = append(transcriptMsg.Translations, &pb.TranslationEntry{
				TargetLanguage: lang,
				TranslatedText: trans.TranslatedText,
			})
		}
	}

	// Send transcript
	select {
	case p.TranscriptChan <- transcriptMsg:
		log.Printf("[AWS Pipeline] Sent transcript with %d translations", len(transcriptMsg.Translations))
	default:
		log.Printf("[AWS Pipeline] Transcript channel full")
	}

	// Generate TTS for each target language (parallel, with caching)
	var wg sync.WaitGroup
	for lang, trans := range translations {
		// Skip TTS for original language
		if lang == sourceLang || trans == nil || trans.TranslatedText == "" {
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
				// Call Polly API
				audio, err := p.polly.Synthesize(ctx, text, targetLang)
				if err != nil {
					log.Printf("[AWS Pipeline] TTS error for %s: %v", targetLang, err)
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

			select {
			case p.AudioChan <- audioMsg:
				log.Printf("[AWS Pipeline] Sent TTS audio for %s (%d bytes)", targetLang, len(audioData))
			default:
				log.Printf("[AWS Pipeline] Audio channel full for %s", targetLang)
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
	key := speakerID + ":" + sourceLang

	p.streamsMu.Lock()
	defer p.streamsMu.Unlock()

	if stream, exists := p.speakerStreams[key]; exists {
		stream.Close()
		delete(p.speakerStreams, key)
		log.Printf("[AWS Pipeline] Removed stream for speaker %s", speakerID)
	}
}

// Close shuts down the pipeline
func (p *Pipeline) Close() error {
	p.cancel()

	p.streamsMu.Lock()
	for key, stream := range p.speakerStreams {
		stream.Close()
		delete(p.speakerStreams, key)
	}
	p.streamsMu.Unlock()

	// Close cache
	if p.cache != nil {
		p.cache.Close()
	}

	close(p.TranscriptChan)
	close(p.AudioChan)
	close(p.ErrChan)

	log.Printf("[AWS Pipeline] Pipeline closed")
	return nil
}
