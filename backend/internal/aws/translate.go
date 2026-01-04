package aws

import (
	"context"
	"log"
	"sync"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/translate"
)

// TranslateClient wraps Amazon Translate
type TranslateClient struct {
	client *translate.Client
}

// TranslationResult holds translated text
type TranslationResult struct {
	SourceText     string
	SourceLanguage string
	TargetLanguage string
	TranslatedText string
}

// Translate 언어 코드 매핑 (Amazon Translate는 ISO 639-1 사용)
var translateLanguageCodes = map[string]string{
	"ko": "ko",
	"en": "en",
	"ja": "ja",
	"zh": "zh",
}

// NewTranslateClient creates a new Translate client
func NewTranslateClient(cfg aws.Config) *TranslateClient {
	return &TranslateClient{
		client: translate.NewFromConfig(cfg),
	}
}

// Translate translates text from source to target language
func (c *TranslateClient) Translate(ctx context.Context, text, sourceLang, targetLang string) (*TranslationResult, error) {
	// Skip if same language
	if sourceLang == targetLang {
		return &TranslationResult{
			SourceText:     text,
			SourceLanguage: sourceLang,
			TargetLanguage: targetLang,
			TranslatedText: text,
		}, nil
	}

	// Skip empty text
	if text == "" {
		return &TranslationResult{
			SourceText:     text,
			SourceLanguage: sourceLang,
			TargetLanguage: targetLang,
			TranslatedText: text,
		}, nil
	}

	srcCode := translateLanguageCodes[sourceLang]
	if srcCode == "" {
		srcCode = "en"
	}

	tgtCode := translateLanguageCodes[targetLang]
	if tgtCode == "" {
		tgtCode = "en"
	}

	input := &translate.TranslateTextInput{
		Text:               aws.String(text),
		SourceLanguageCode: aws.String(srcCode),
		TargetLanguageCode: aws.String(tgtCode),
	}

	output, err := c.client.TranslateText(ctx, input)
	if err != nil {
		log.Printf("[Translate] Error translating from %s to %s: %v", sourceLang, targetLang, err)
		return nil, err
	}

	return &TranslationResult{
		SourceText:     text,
		SourceLanguage: sourceLang,
		TargetLanguage: targetLang,
		TranslatedText: aws.ToString(output.TranslatedText),
	}, nil
}

// TranslateToMultiple translates text to multiple target languages concurrently
func (c *TranslateClient) TranslateToMultiple(ctx context.Context, text, sourceLang string, targetLangs []string) (map[string]*TranslationResult, error) {
	results := make(map[string]*TranslationResult)
	var mu sync.Mutex
	var wg sync.WaitGroup
	var firstErr error
	var errMu sync.Mutex

	for _, targetLang := range targetLangs {
		// Skip same language translation
		if targetLang == sourceLang {
			mu.Lock()
			results[targetLang] = &TranslationResult{
				SourceText:     text,
				SourceLanguage: sourceLang,
				TargetLanguage: targetLang,
				TranslatedText: text,
			}
			mu.Unlock()
			continue
		}

		wg.Add(1)
		go func(tl string) {
			defer wg.Done()

			result, err := c.Translate(ctx, text, sourceLang, tl)
			if err != nil {
				errMu.Lock()
				if firstErr == nil {
					firstErr = err
				}
				errMu.Unlock()
				return
			}

			mu.Lock()
			results[tl] = result
			mu.Unlock()
		}(targetLang)
	}

	wg.Wait()

	// Return results even if some translations failed
	if len(results) == 0 && firstErr != nil {
		return nil, firstErr
	}

	return results, nil
}
