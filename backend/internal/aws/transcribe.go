package aws

import (
	"context"
	"log"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/transcribestreaming"
	"github.com/aws/aws-sdk-go-v2/service/transcribestreaming/types"
)

// TranscribeClient wraps Amazon Transcribe Streaming
type TranscribeClient struct {
	client     *transcribestreaming.Client
	sampleRate int32
}

// TranscribeStream represents an active transcription stream for a speaker
type TranscribeStream struct {
	speakerID  string
	sourceLang string

	eventStream *transcribestreaming.StartStreamTranscriptionEventStream
	ctx         context.Context
	cancel      context.CancelFunc

	// Output channel
	TranscriptChan chan *TranscriptResult

	// Audio input channel
	audioIn chan []byte

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

// Transcribe 언어 코드 매핑
var transcribeLanguageCodes = map[string]types.LanguageCode{
	"ko": types.LanguageCodeKoKr,
	"en": types.LanguageCodeEnUs,
	"ja": types.LanguageCodeJaJp,
	"zh": types.LanguageCodeZhCn,
}

// NewTranscribeClient creates a new Transcribe Streaming client
func NewTranscribeClient(cfg aws.Config, sampleRate int32) *TranscribeClient {
	return &TranscribeClient{
		client:     transcribestreaming.NewFromConfig(cfg),
		sampleRate: sampleRate,
	}
}

// StartStream initiates a new transcription stream for a speaker
func (c *TranscribeClient) StartStream(ctx context.Context, speakerID, sourceLang string) (*TranscribeStream, error) {
	langCode, ok := transcribeLanguageCodes[sourceLang]
	if !ok {
		langCode = types.LanguageCodeEnUs
		log.Printf("[Transcribe] Unknown language '%s', defaulting to en-US", sourceLang)
	}

	streamCtx, cancel := context.WithCancel(ctx)

	ts := &TranscribeStream{
		speakerID:      speakerID,
		sourceLang:     sourceLang,
		ctx:            streamCtx,
		cancel:         cancel,
		TranscriptChan: make(chan *TranscriptResult, 50),
		audioIn:        make(chan []byte, 100),
		isClosed:       false,
	}

	// Start the transcription stream
	resp, err := c.client.StartStreamTranscription(streamCtx, &transcribestreaming.StartStreamTranscriptionInput{
		LanguageCode:         langCode,
		MediaEncoding:        types.MediaEncodingPcm,
		MediaSampleRateHertz: aws.Int32(c.sampleRate),
	})
	if err != nil {
		cancel()
		return nil, err
	}

	ts.eventStream = resp.GetStream()

	// Start goroutines for sending audio and receiving transcripts
	go ts.sendAudioLoop()
	go ts.receiveLoop()

	log.Printf("[Transcribe] Started stream for speaker %s (lang: %s)", speakerID, sourceLang)

	return ts, nil
}

// SendAudio sends audio data to the transcription stream
func (ts *TranscribeStream) SendAudio(audioData []byte) error {
	ts.mu.Lock()
	if ts.isClosed {
		ts.mu.Unlock()
		return nil
	}
	ts.mu.Unlock()

	select {
	case ts.audioIn <- audioData:
		return nil
	case <-ts.ctx.Done():
		return ts.ctx.Err()
	default:
		log.Printf("[Transcribe] Audio buffer full for speaker %s", ts.speakerID)
		return nil
	}
}

// sendAudioLoop sends audio chunks to Transcribe
func (ts *TranscribeStream) sendAudioLoop() {
	defer func() {
		if ts.eventStream != nil {
			ts.eventStream.Close()
		}
	}()

	for {
		select {
		case <-ts.ctx.Done():
			return
		case audioData, ok := <-ts.audioIn:
			if !ok {
				return
			}

			err := ts.eventStream.Send(ts.ctx, &types.AudioStreamMemberAudioEvent{
				Value: types.AudioEvent{
					AudioChunk: audioData,
				},
			})
			if err != nil {
				log.Printf("[Transcribe] Error sending audio for speaker %s: %v", ts.speakerID, err)
				return
			}
		}
	}
}

// receiveLoop receives transcript results from Transcribe
func (ts *TranscribeStream) receiveLoop() {
	defer close(ts.TranscriptChan)

	// Events() returns a channel of transcript events
	events := ts.eventStream.Events()

	for {
		select {
		case <-ts.ctx.Done():
			return
		case event, ok := <-events:
			if !ok {
				log.Printf("[Transcribe] Events channel closed for speaker %s", ts.speakerID)
				return
			}

			switch e := event.(type) {
			case *types.TranscriptResultStreamMemberTranscriptEvent:
				ts.handleTranscriptEvent(e.Value)
			}
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

		// Calculate confidence (average of item confidences)
		var confidence float32 = 1.0
		if len(alt.Items) > 0 && alt.Items[0].Confidence != nil {
			confidence = float32(*alt.Items[0].Confidence)
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
			log.Printf("[Transcribe] Transcript channel full for speaker %s", ts.speakerID)
		}
	}
}

// Close terminates the transcription stream
func (ts *TranscribeStream) Close() error {
	ts.mu.Lock()
	if ts.isClosed {
		ts.mu.Unlock()
		return nil
	}
	ts.isClosed = true
	ts.mu.Unlock()

	ts.cancel()
	close(ts.audioIn)

	log.Printf("[Transcribe] Closed stream for speaker %s", ts.speakerID)
	return nil
}
