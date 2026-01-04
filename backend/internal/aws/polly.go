package aws

import (
	"context"
	"io"
	"log"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/polly"
	"github.com/aws/aws-sdk-go-v2/service/polly/types"
)

// PollyClient wraps Amazon Polly TTS
type PollyClient struct {
	client *polly.Client
	voices map[string]pollyVoiceConfig
}

// pollyVoiceConfig holds voice configuration
type pollyVoiceConfig struct {
	VoiceID types.VoiceId
	Engine  types.Engine
}

// AudioResult contains synthesized audio
type AudioResult struct {
	AudioData  []byte
	Format     string // "mp3"
	SampleRate int32  // 24000
	Language   string
}

// 언어별 기본 Neural 음성 설정
var defaultVoices = map[string]pollyVoiceConfig{
	"ko": {VoiceID: types.VoiceIdSeoyeon, Engine: types.EngineNeural},
	"en": {VoiceID: types.VoiceIdJoanna, Engine: types.EngineNeural},
	"ja": {VoiceID: types.VoiceIdMizuki, Engine: types.EngineStandard}, // Mizuki는 Standard만 지원
	"zh": {VoiceID: types.VoiceIdZhiyu, Engine: types.EngineNeural},
}

// NewPollyClient creates a new Polly TTS client
func NewPollyClient(cfg aws.Config) *PollyClient {
	voices := make(map[string]pollyVoiceConfig)
	for k, v := range defaultVoices {
		voices[k] = v
	}

	return &PollyClient{
		client: polly.NewFromConfig(cfg),
		voices: voices,
	}
}

// Synthesize generates speech from text
func (c *PollyClient) Synthesize(ctx context.Context, text, language string) (*AudioResult, error) {
	if text == "" {
		return &AudioResult{
			AudioData:  []byte{},
			Format:     "mp3",
			SampleRate: 24000,
			Language:   language,
		}, nil
	}

	voiceCfg, ok := c.voices[language]
	if !ok {
		voiceCfg = c.voices["en"] // 기본값: 영어
		log.Printf("[Polly] Unknown language '%s', defaulting to English", language)
	}

	input := &polly.SynthesizeSpeechInput{
		Text:         aws.String(text),
		VoiceId:      voiceCfg.VoiceID,
		Engine:       voiceCfg.Engine,
		OutputFormat: types.OutputFormatMp3,
		SampleRate:   aws.String("24000"),
	}

	output, err := c.client.SynthesizeSpeech(ctx, input)
	if err != nil {
		log.Printf("[Polly] Error synthesizing speech for language %s: %v", language, err)
		return nil, err
	}
	defer output.AudioStream.Close()

	audioData, err := io.ReadAll(output.AudioStream)
	if err != nil {
		log.Printf("[Polly] Error reading audio stream: %v", err)
		return nil, err
	}

	log.Printf("[Polly] Synthesized %d bytes of audio for language %s", len(audioData), language)

	return &AudioResult{
		AudioData:  audioData,
		Format:     "mp3",
		SampleRate: 24000,
		Language:   language,
	}, nil
}
