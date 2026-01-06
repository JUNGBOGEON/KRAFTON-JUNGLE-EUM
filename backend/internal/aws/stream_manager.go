package aws

import (
	"context"
	"log"
	"sync"
	"sync/atomic"
	"time"
)

// StreamManager manages Transcribe streams with language-based pooling.
// Speakers with the same source language within a room share a single stream.
// This reduces AWS costs and improves efficiency.
type StreamManager struct {
	// Room-level stream pool: key = sourceLang
	streams map[string]*StreamRef
	mu      sync.RWMutex

	// Shared AWS clients
	clientPool *AWSClientPool

	// Stream configuration
	idleTimeout time.Duration

	// Callbacks
	onStreamDead func(sourceLang string)

	ctx    context.Context
	cancel context.CancelFunc
	closed bool
}

// StreamRef holds a stream with reference counting.
// Multiple speakers with the same source language share one stream.
type StreamRef struct {
	Stream     *TranscribeStream
	SourceLang string
	RefCount   int32          // Number of speakers using this stream
	SpeakerIDs map[string]bool // Track which speakers are using this stream
	LastActive time.Time
	mu         sync.Mutex
}

// StreamManagerConfig configuration for stream manager
type StreamManagerConfig struct {
	IdleTimeout time.Duration
}

// DefaultStreamManagerConfig returns default configuration
func DefaultStreamManagerConfig() *StreamManagerConfig {
	return &StreamManagerConfig{
		IdleTimeout: 30 * time.Minute,
	}
}

// NewStreamManager creates a new stream manager for a room
func NewStreamManager(ctx context.Context, clientPool *AWSClientPool, cfg *StreamManagerConfig) *StreamManager {
	if cfg == nil {
		cfg = DefaultStreamManagerConfig()
	}

	smCtx, cancel := context.WithCancel(ctx)

	sm := &StreamManager{
		streams:     make(map[string]*StreamRef),
		clientPool:  clientPool,
		idleTimeout: cfg.IdleTimeout,
		ctx:         smCtx,
		cancel:      cancel,
		closed:      false,
	}

	// Start idle stream checker
	go sm.idleChecker()

	log.Printf("[StreamManager] Created new stream manager")
	return sm
}

// SetOnStreamDead sets the callback for when a stream dies
func (sm *StreamManager) SetOnStreamDead(callback func(sourceLang string)) {
	sm.onStreamDead = callback
}

// GetOrCreateStream gets an existing stream or creates a new one for the speaker.
// FIX: Changed from language-based pooling to speaker-based streams.
// Each speaker now gets their own stream to preserve speaker identity.
// This fixes the "lang-ko" speaker ID issue and enables proper bidirectional translation.
func (sm *StreamManager) GetOrCreateStream(speakerID, sourceLang string) (*TranscribeStream, error) {
	// Use speakerID as the stream key (not sourceLang) to preserve speaker identity
	streamKey := speakerID

	// Fast path: check if stream exists with read lock
	sm.mu.RLock()
	if ref, exists := sm.streams[streamKey]; exists {
		if ref.Stream != nil && !ref.Stream.IsClosed() {
			ref.mu.Lock()
			ref.LastActive = time.Now()
			ref.mu.Unlock()
			sm.mu.RUnlock()
			log.Printf("[StreamManager] Reusing stream for speaker=%s (lang=%s)",
				speakerID, sourceLang)
			return ref.Stream, nil
		}
	}
	sm.mu.RUnlock()

	// Slow path: create new stream with write lock
	sm.mu.Lock()
	defer sm.mu.Unlock()

	// Double-check: another goroutine may have created it
	if ref, exists := sm.streams[streamKey]; exists {
		if ref.Stream != nil && !ref.Stream.IsClosed() {
			ref.mu.Lock()
			ref.LastActive = time.Now()
			ref.mu.Unlock()
			log.Printf("[StreamManager] Reusing stream for speaker=%s (lang=%s)",
				speakerID, sourceLang)
			return ref.Stream, nil
		}
		// Stream is dead, remove it immediately
		delete(sm.streams, streamKey)
		log.Printf("[StreamManager] Removed dead stream for speaker=%s", speakerID)
	}

	// Create new stream using shared TranscribeClient
	// FIX: Use actual speakerID instead of "lang-"+sourceLang
	stream, err := sm.clientPool.Transcribe.StartStream(sm.ctx, speakerID, sourceLang)
	if err != nil {
		log.Printf("[StreamManager] Failed to create stream for speaker=%s (lang=%s): %v", speakerID, sourceLang, err)
		return nil, err
	}

	// Set up stream callbacks for immediate cleanup
	stream.SetCallbacks(
		// onDead callback
		func(spkID, srcLang string, attempt int) {
			log.Printf("[StreamManager] ☠️ Stream died for speaker=%s", spkID)
			sm.removeStreamImmediate(spkID) // Use speakerID as key
			if sm.onStreamDead != nil {
				sm.onStreamDead(spkID)
			}
		},
		// onReconnect callback
		func(spkID, srcLang string, attempt int) {
			log.Printf("[StreamManager] 🔄 Stream reconnecting for speaker=%s (attempt=%d)", spkID, attempt)
		},
	)

	// Store stream reference with speakerID as key
	ref := &StreamRef{
		Stream:     stream,
		SourceLang: sourceLang,
		RefCount:   1,
		SpeakerIDs: map[string]bool{speakerID: true},
		LastActive: time.Now(),
	}
	sm.streams[streamKey] = ref

	log.Printf("[StreamManager] Created new stream for speaker=%s (lang=%s)", speakerID, sourceLang)
	return stream, nil
}

// SendAudio sends audio to the speaker's stream
// FIX: Changed to use speakerID as stream key
func (sm *StreamManager) SendAudio(speakerID, sourceLang string, audioData []byte) error {
	streamKey := speakerID // Use speakerID as key

	sm.mu.RLock()
	ref, exists := sm.streams[streamKey]
	sm.mu.RUnlock()

	if !exists || ref.Stream == nil {
		// Auto-create stream if it doesn't exist
		stream, err := sm.GetOrCreateStream(speakerID, sourceLang)
		if err != nil {
			return err
		}
		return stream.SendAudio(audioData)
	}

	// Update last active time
	ref.mu.Lock()
	ref.LastActive = time.Now()
	ref.mu.Unlock()

	return ref.Stream.SendAudio(audioData)
}

// ReleaseSpeaker closes the speaker's stream
// FIX: Changed to use speakerID as stream key (each speaker has own stream now)
func (sm *StreamManager) ReleaseSpeaker(speakerID, sourceLang string) {
	streamKey := speakerID // Use speakerID as key

	sm.mu.Lock()
	defer sm.mu.Unlock()

	ref, exists := sm.streams[streamKey]
	if !exists {
		return
	}

	// Close and remove the speaker's stream
	if ref.Stream != nil {
		ref.Stream.Close()
	}
	delete(sm.streams, streamKey)
	log.Printf("[StreamManager] Released and closed stream for speaker=%s (lang=%s)", speakerID, sourceLang)
}

// removeStreamImmediate removes a dead stream immediately (called from callback)
// FIX: Parameter is now speakerID (stream key), not sourceLang
func (sm *StreamManager) removeStreamImmediate(streamKey string) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	if ref, exists := sm.streams[streamKey]; exists {
		if ref.Stream != nil && !ref.Stream.IsClosed() {
			ref.Stream.Close()
		}
		delete(sm.streams, streamKey)
		log.Printf("[StreamManager] Immediately removed dead stream for speaker=%s", streamKey)
	}
}

// GetStreamForLang returns the stream for a specific language (if exists)
func (sm *StreamManager) GetStreamForLang(sourceLang string) *TranscribeStream {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	if ref, exists := sm.streams[sourceLang]; exists && ref.Stream != nil {
		return ref.Stream
	}
	return nil
}

// GetActiveStreams returns count of active streams
func (sm *StreamManager) GetActiveStreams() int {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	return len(sm.streams)
}

// GetStats returns statistics about managed streams
func (sm *StreamManager) GetStats() map[string]interface{} {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	streamStats := make(map[string]map[string]interface{})
	for lang, ref := range sm.streams {
		ref.mu.Lock()
		streamStats[lang] = map[string]interface{}{
			"refCount":   ref.RefCount,
			"speakerIDs": len(ref.SpeakerIDs),
			"lastActive": ref.LastActive,
			"isClosed":   ref.Stream != nil && ref.Stream.IsClosed(),
		}
		ref.mu.Unlock()
	}

	return map[string]interface{}{
		"activeStreams": len(sm.streams),
		"streams":       streamStats,
		"closed":        sm.closed,
	}
}

// idleChecker periodically checks and closes idle streams
func (sm *StreamManager) idleChecker() {
	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-sm.ctx.Done():
			return
		case <-ticker.C:
			sm.closeIdleStreams()
		}
	}
}

// closeIdleStreams closes streams that have been idle for too long
func (sm *StreamManager) closeIdleStreams() {
	type toClose struct {
		lang     string
		ref      *StreamRef
		idleTime time.Duration
	}
	var closings []toClose

	sm.mu.Lock()
	now := time.Now()
	for lang, ref := range sm.streams {
		ref.mu.Lock()
		idleTime := now.Sub(ref.LastActive)
		// Only close if truly idle (no speakers)
		if idleTime > sm.idleTimeout && ref.RefCount <= 0 {
			closings = append(closings, toClose{lang, ref, idleTime})
			delete(sm.streams, lang)
		}
		ref.mu.Unlock()
	}
	sm.mu.Unlock()

	// Close streams outside lock
	for _, c := range closings {
		if c.ref.Stream != nil {
			c.ref.Stream.Close()
		}
		log.Printf("[StreamManager] Closed idle stream lang=%s (idle for %v)", c.lang, c.idleTime)
	}
}

// Close shuts down the stream manager and all managed streams
func (sm *StreamManager) Close() error {
	sm.mu.Lock()
	if sm.closed {
		sm.mu.Unlock()
		return nil
	}
	sm.closed = true
	sm.cancel()

	// Collect all streams to close
	toClose := make([]*StreamRef, 0, len(sm.streams))
	for _, ref := range sm.streams {
		toClose = append(toClose, ref)
	}
	sm.streams = make(map[string]*StreamRef)
	sm.mu.Unlock()

	// Close all streams outside lock
	for _, ref := range toClose {
		if ref.Stream != nil {
			ref.Stream.Close()
		}
	}

	log.Printf("[StreamManager] Closed and cleaned up %d streams", len(toClose))
	return nil
}

// =============================================================================
// Worker Pool for Translation/TTS
// =============================================================================

// WorkerPool manages a fixed pool of workers for processing tasks
type WorkerPool struct {
	name       string
	workers    int
	taskQueue  chan func()
	wg         sync.WaitGroup
	ctx        context.Context
	cancel     context.CancelFunc
	closed     int32
	processed  int64
	dropped    int64
}

// NewWorkerPool creates a new worker pool with the specified number of workers
func NewWorkerPool(ctx context.Context, name string, workers, queueSize int) *WorkerPool {
	wpCtx, cancel := context.WithCancel(ctx)

	wp := &WorkerPool{
		name:      name,
		workers:   workers,
		taskQueue: make(chan func(), queueSize),
		ctx:       wpCtx,
		cancel:    cancel,
	}

	// Start worker goroutines
	for i := 0; i < workers; i++ {
		wp.wg.Add(1)
		go wp.worker(i)
	}

	log.Printf("[WorkerPool:%s] Started %d workers (queue size: %d)", name, workers, queueSize)
	return wp
}

// worker is the main worker loop
func (wp *WorkerPool) worker(id int) {
	defer wp.wg.Done()

	for {
		select {
		case <-wp.ctx.Done():
			return
		case task, ok := <-wp.taskQueue:
			if !ok {
				return
			}
			// Execute task with panic recovery
			func() {
				defer func() {
					if r := recover(); r != nil {
						log.Printf("[WorkerPool:%s] Worker %d panic recovered: %v", wp.name, id, r)
					}
				}()
				task()
				atomic.AddInt64(&wp.processed, 1)
			}()
		}
	}
}

// Submit submits a task to the worker pool
// Returns true if task was accepted, false if dropped
func (wp *WorkerPool) Submit(task func()) bool {
	if atomic.LoadInt32(&wp.closed) == 1 {
		return false
	}

	select {
	case wp.taskQueue <- task:
		return true
	default:
		atomic.AddInt64(&wp.dropped, 1)
		return false
	}
}

// SubmitWait submits a task and waits until it's queued (with timeout)
func (wp *WorkerPool) SubmitWait(task func(), timeout time.Duration) bool {
	if atomic.LoadInt32(&wp.closed) == 1 {
		return false
	}

	select {
	case wp.taskQueue <- task:
		return true
	case <-time.After(timeout):
		atomic.AddInt64(&wp.dropped, 1)
		return false
	case <-wp.ctx.Done():
		return false
	}
}

// Stats returns worker pool statistics
func (wp *WorkerPool) Stats() map[string]interface{} {
	return map[string]interface{}{
		"name":       wp.name,
		"workers":    wp.workers,
		"queueLen":   len(wp.taskQueue),
		"queueCap":   cap(wp.taskQueue),
		"processed":  atomic.LoadInt64(&wp.processed),
		"dropped":    atomic.LoadInt64(&wp.dropped),
		"closed":     atomic.LoadInt32(&wp.closed) == 1,
	}
}

// Close shuts down the worker pool
func (wp *WorkerPool) Close() {
	if !atomic.CompareAndSwapInt32(&wp.closed, 0, 1) {
		return
	}

	wp.cancel()
	close(wp.taskQueue)
	wp.wg.Wait()

	log.Printf("[WorkerPool:%s] Closed (processed: %d, dropped: %d)",
		wp.name, atomic.LoadInt64(&wp.processed), atomic.LoadInt64(&wp.dropped))
}
