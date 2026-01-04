package aws

import (
	"crypto/sha256"
	"encoding/hex"
	"log"
	"sync"
	"time"
)

// CacheEntry represents a cached item with expiration
type CacheEntry struct {
	Value     interface{}
	ExpiresAt time.Time
}

// PipelineCache provides caching for Translation and TTS results
type PipelineCache struct {
	translationCache sync.Map // key: "text:srcLang:tgtLang" → TranslationResult
	ttsCache         sync.Map // key: "text:lang" → []byte (audio)

	ttl             time.Duration
	cleanupInterval time.Duration
	stopCleanup     chan struct{}
}

// CacheConfig configuration for cache
type CacheConfig struct {
	TTL             time.Duration // Cache entry lifetime (default: 5 minutes)
	CleanupInterval time.Duration // Cleanup interval (default: 1 minute)
}

// DefaultCacheConfig returns default cache configuration
func DefaultCacheConfig() *CacheConfig {
	return &CacheConfig{
		TTL:             5 * time.Minute,
		CleanupInterval: 1 * time.Minute,
	}
}

// NewPipelineCache creates a new cache instance
func NewPipelineCache(cfg *CacheConfig) *PipelineCache {
	if cfg == nil {
		cfg = DefaultCacheConfig()
	}

	cache := &PipelineCache{
		ttl:             cfg.TTL,
		cleanupInterval: cfg.CleanupInterval,
		stopCleanup:     make(chan struct{}),
	}

	// Start cleanup goroutine
	go cache.cleanupLoop()

	log.Printf("[Cache] Initialized with TTL=%v, cleanup interval=%v", cfg.TTL, cfg.CleanupInterval)

	return cache
}

// generateKey creates a cache key from components
func generateKey(parts ...string) string {
	combined := ""
	for i, part := range parts {
		if i > 0 {
			combined += ":"
		}
		combined += part
	}
	return combined
}

// hashKey creates a short hash for long texts
func hashKey(text string) string {
	if len(text) <= 50 {
		return text
	}
	hash := sha256.Sum256([]byte(text))
	return hex.EncodeToString(hash[:8]) // 16 char hash
}

// =============================================================================
// Translation Cache
// =============================================================================

// GetTranslation retrieves a cached translation
func (c *PipelineCache) GetTranslation(text, srcLang, tgtLang string) (*TranslationResult, bool) {
	key := generateKey(hashKey(text), srcLang, tgtLang)

	if entry, ok := c.translationCache.Load(key); ok {
		cached := entry.(*CacheEntry)
		if time.Now().Before(cached.ExpiresAt) {
			log.Printf("[Cache] Translation HIT: %s→%s", srcLang, tgtLang)
			return cached.Value.(*TranslationResult), true
		}
		// Expired, delete it
		c.translationCache.Delete(key)
	}

	return nil, false
}

// SetTranslation stores a translation in cache
func (c *PipelineCache) SetTranslation(text, srcLang, tgtLang string, result *TranslationResult) {
	key := generateKey(hashKey(text), srcLang, tgtLang)

	c.translationCache.Store(key, &CacheEntry{
		Value:     result,
		ExpiresAt: time.Now().Add(c.ttl),
	})

	log.Printf("[Cache] Translation SET: %s→%s", srcLang, tgtLang)
}

// =============================================================================
// TTS Cache
// =============================================================================

// GetTTS retrieves cached TTS audio
func (c *PipelineCache) GetTTS(text, lang string) ([]byte, bool) {
	key := generateKey(hashKey(text), lang)

	if entry, ok := c.ttsCache.Load(key); ok {
		cached := entry.(*CacheEntry)
		if time.Now().Before(cached.ExpiresAt) {
			log.Printf("[Cache] TTS HIT: lang=%s, size=%d bytes", lang, len(cached.Value.([]byte)))
			return cached.Value.([]byte), true
		}
		// Expired, delete it
		c.ttsCache.Delete(key)
	}

	return nil, false
}

// SetTTS stores TTS audio in cache
func (c *PipelineCache) SetTTS(text, lang string, audioData []byte) {
	key := generateKey(hashKey(text), lang)

	c.ttsCache.Store(key, &CacheEntry{
		Value:     audioData,
		ExpiresAt: time.Now().Add(c.ttl),
	})

	log.Printf("[Cache] TTS SET: lang=%s, size=%d bytes", lang, len(audioData))
}

// =============================================================================
// Cleanup
// =============================================================================

// cleanupLoop periodically removes expired entries
func (c *PipelineCache) cleanupLoop() {
	ticker := time.NewTicker(c.cleanupInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			c.cleanup()
		case <-c.stopCleanup:
			return
		}
	}
}

// cleanup removes expired entries from all caches
func (c *PipelineCache) cleanup() {
	now := time.Now()
	translationCleaned := 0
	ttsCleaned := 0

	c.translationCache.Range(func(key, value interface{}) bool {
		entry := value.(*CacheEntry)
		if now.After(entry.ExpiresAt) {
			c.translationCache.Delete(key)
			translationCleaned++
		}
		return true
	})

	c.ttsCache.Range(func(key, value interface{}) bool {
		entry := value.(*CacheEntry)
		if now.After(entry.ExpiresAt) {
			c.ttsCache.Delete(key)
			ttsCleaned++
		}
		return true
	})

	if translationCleaned > 0 || ttsCleaned > 0 {
		log.Printf("[Cache] Cleanup: removed %d translations, %d TTS entries",
			translationCleaned, ttsCleaned)
	}
}

// Close stops the cleanup goroutine
func (c *PipelineCache) Close() {
	close(c.stopCleanup)
	log.Printf("[Cache] Closed")
}

// Stats returns cache statistics
func (c *PipelineCache) Stats() (translationCount, ttsCount int) {
	c.translationCache.Range(func(_, _ interface{}) bool {
		translationCount++
		return true
	})
	c.ttsCache.Range(func(_, _ interface{}) bool {
		ttsCount++
		return true
	})
	return
}
