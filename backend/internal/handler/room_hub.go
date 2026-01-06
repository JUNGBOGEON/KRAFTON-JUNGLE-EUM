package handler

import (
	"context"
	"encoding/json"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/gofiber/contrib/websocket"
	"gorm.io/gorm"

	"realtime-backend/internal/ai"
	awsai "realtime-backend/internal/aws"
	"realtime-backend/internal/cache"
	"realtime-backend/internal/config"
	"realtime-backend/internal/model"
)

// =============================================================================
// Room Hub - Room 단위 WebSocket 및 gRPC 관리
// =============================================================================

// RoomHub manages all rooms and their connections
type RoomHub struct {
	rooms         map[string]*Room
	mu            sync.RWMutex
	aiClient      *ai.GrpcClient        // Python gRPC 클라이언트
	useAWS        bool                  // AWS 직접 사용 여부
	cfg           *config.Config        // 앱 설정
	redisClient   *cache.RedisClient    // Redis/Valkey 클라이언트
	db            *gorm.DB              // Database for saving transcripts
	awsClientPool *awsai.AWSClientPool  // 공유 AWS 클라이언트 풀
}

// Room represents a single room with listeners and speakers
type Room struct {
	ID          string
	Listeners   map[string]*Listener
	Speakers    map[string]*Speaker
	grpcStream  *ai.ChatStream     // Python gRPC 스트림
	awsPipeline *awsai.Pipeline    // AWS 파이프라인
	broadcast   chan *BroadcastMessage
	audioIn     chan *AudioMessage
	ctx         context.Context
	cancel      context.CancelFunc
	mu          sync.RWMutex
	hub         *RoomHub
	isRunning   bool
}

// Listener represents a user receiving translations
type Listener struct {
	ID         string
	TargetLang string
	Conn       *websocket.Conn
	writeMu    sync.Mutex
}

// Speaker represents a user whose audio is being captured
type Speaker struct {
	ID         string
	SourceLang string
	Nickname   string
	ProfileImg string
}

// BroadcastMessage is sent to listeners
type BroadcastMessage struct {
	Type       string `json:"type"` // "transcript" | "audio"
	SpeakerID  string `json:"speakerId"`
	TargetLang string `json:"targetLang,omitempty"`
	Data       any    `json:"data,omitempty"`
	AudioData  []byte `json:"-"` // Binary audio data (not JSON serialized)
}

// AudioMessage is received from listeners (speaker's audio)
type AudioMessage struct {
	SpeakerID  string
	SourceLang string
	AudioData  []byte
}

// TranscriptData represents transcript message
type TranscriptData struct {
	ParticipantID string `json:"participantId"`
	Original      string `json:"original"`
	Translated    string `json:"translated,omitempty"`
	IsFinal       bool   `json:"isFinal"`
	Language      string `json:"language"`
}

// NewRoomHub creates a new RoomHub instance
func NewRoomHub(aiClient *ai.GrpcClient, cfg *config.Config, useAWS bool, redisClient *cache.RedisClient) *RoomHub {
	hub := &RoomHub{
		rooms:       make(map[string]*Room),
		aiClient:    aiClient,
		cfg:         cfg,
		useAWS:      useAWS,
		redisClient: redisClient,
	}

	// Initialize shared AWS client pool if using AWS
	if useAWS && cfg != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		clientPool, err := awsai.NewAWSClientPool(ctx, cfg, awsai.DefaultAWSClientPoolConfig())
		if err != nil {
			log.Printf("[RoomHub] ⚠️ Failed to create AWS client pool: %v (will create clients per room)", err)
		} else {
			hub.awsClientPool = clientPool
			log.Printf("[RoomHub] ✅ AWS client pool initialized")
		}
	}

	return hub
}

// SetDB sets the database connection for saving transcripts
func (h *RoomHub) SetDB(db *gorm.DB) {
	h.db = db
}

// GetTranscripts retrieves transcripts from Redis for a room
func (h *RoomHub) GetTranscripts(roomID string) ([]cache.RoomTranscript, error) {
	if h.redisClient == nil {
		return nil, nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	return h.redisClient.GetTranscripts(ctx, roomID)
}

// GetOrCreateRoom gets an existing room or creates a new one
func (h *RoomHub) GetOrCreateRoom(roomID string) *Room {
	h.mu.Lock()
	defer h.mu.Unlock()

	if room, exists := h.rooms[roomID]; exists {
		return room
	}

	ctx, cancel := context.WithCancel(context.Background())
	room := &Room{
		ID:        roomID,
		Listeners: make(map[string]*Listener),
		Speakers:  make(map[string]*Speaker),
		broadcast: make(chan *BroadcastMessage, 100),
		audioIn:   make(chan *AudioMessage, 100),
		ctx:       ctx,
		cancel:    cancel,
		hub:       h,
		isRunning: false,
	}

	h.rooms[roomID] = room
	log.Printf("[RoomHub] Created room: %s", roomID)

	return room
}

// RemoveRoom removes an empty room
func (h *RoomHub) RemoveRoom(roomID string) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if room, exists := h.rooms[roomID]; exists {
		room.Shutdown()
		delete(h.rooms, roomID)
		log.Printf("[RoomHub] Removed room: %s", roomID)
	}
}

// =============================================================================
// Room Methods
// =============================================================================

// AddListener adds a listener to the room
func (r *Room) AddListener(listenerID, targetLang string, conn *websocket.Conn) {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.Listeners[listenerID] = &Listener{
		ID:         listenerID,
		TargetLang: targetLang,
		Conn:       conn,
	}

	log.Printf("[Room %s] Added listener: %s (target: %s), total: %d",
		r.ID, listenerID, targetLang, len(r.Listeners))

	// Update target languages in AWS pipeline when new listener joins
	if r.hub.useAWS && r.awsPipeline != nil {
		targetLangs := make([]string, 0)
		langSet := make(map[string]bool)
		for _, l := range r.Listeners {
			if !langSet[l.TargetLang] {
				langSet[l.TargetLang] = true
				targetLangs = append(targetLangs, l.TargetLang)
			}
		}
		log.Printf("[Room %s] 🔄 Updating target languages: %v", r.ID, targetLangs)
		r.awsPipeline.UpdateTargetLanguages(targetLangs)
	}

	// Start room processing if not already running
	if !r.isRunning {
		r.isRunning = true
		go r.runBroadcaster()
		go r.runAudioProcessor()
	}
}

// RemoveListener removes a listener from the room
func (r *Room) RemoveListener(listenerID string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	delete(r.Listeners, listenerID)
	log.Printf("[Room %s] Removed listener: %s, remaining: %d",
		r.ID, listenerID, len(r.Listeners))

	// Update target languages in AWS pipeline (deduplicated)
	if r.hub.useAWS && r.awsPipeline != nil {
		targetLangs := make([]string, 0)
		langSet := make(map[string]bool)
		for _, l := range r.Listeners {
			if !langSet[l.TargetLang] {
				langSet[l.TargetLang] = true
				targetLangs = append(targetLangs, l.TargetLang)
			}
		}
		r.awsPipeline.UpdateTargetLanguages(targetLangs)
	}
}

// UpdateListenerTargetLang updates a listener's target language
func (r *Room) UpdateListenerTargetLang(listenerID, newTargetLang string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	listener, exists := r.Listeners[listenerID]
	if !exists {
		return
	}

	oldLang := listener.TargetLang
	listener.TargetLang = newTargetLang

	log.Printf("[Room %s] Listener %s changed target language: %s -> %s",
		r.ID, listenerID, oldLang, newTargetLang)

	// Update target languages in AWS pipeline
	if r.hub.useAWS && r.awsPipeline != nil {
		targetLangs := make([]string, 0)
		langSet := make(map[string]bool)
		for _, l := range r.Listeners {
			if !langSet[l.TargetLang] {
				langSet[l.TargetLang] = true
				targetLangs = append(targetLangs, l.TargetLang)
			}
		}
		log.Printf("[Room %s] 🔄 Updating target languages: %v", r.ID, targetLangs)
		r.awsPipeline.UpdateTargetLanguages(targetLangs)
	}

	// If no listeners and no speakers, cleanup room
	if len(r.Listeners) == 0 && len(r.Speakers) == 0 {
		go r.hub.RemoveRoom(r.ID)
	}
}

// RemoveSpeaker removes a speaker from the room and closes their Transcribe stream
func (r *Room) RemoveSpeaker(speakerID string) {
	r.mu.Lock()
	speaker, exists := r.Speakers[speakerID]
	if exists {
		delete(r.Speakers, speakerID)
	}
	pipeline := r.awsPipeline
	r.mu.Unlock()

	if !exists {
		return
	}

	// Close the speaker's Transcribe stream (AWS mode)
	if r.hub.useAWS && pipeline != nil {
		pipeline.RemoveSpeakerStream(speakerID, speaker.SourceLang)
		log.Printf("[Room %s] Closed Transcribe stream for speaker: %s", r.ID, speakerID)
	}

	log.Printf("[Room %s] Removed speaker: %s", r.ID, speakerID)

	// If no listeners and no speakers, cleanup room
	r.mu.RLock()
	isEmpty := len(r.Listeners) == 0 && len(r.Speakers) == 0
	r.mu.RUnlock()

	if isEmpty {
		go r.hub.RemoveRoom(r.ID)
	}
}

// HasSpeaker checks if a speaker exists in the room
func (r *Room) HasSpeaker(speakerID string) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	_, exists := r.Speakers[speakerID]
	return exists
}

// AddOrUpdateSpeaker adds or updates a speaker
func (r *Room) AddOrUpdateSpeaker(speakerID, sourceLang, nickname, profileImg string) {
	r.mu.Lock()

	// Check if sourceLang changed - need to cleanup old Transcribe stream
	oldSourceLang := ""
	if existingSpeaker, exists := r.Speakers[speakerID]; exists {
		oldSourceLang = existingSpeaker.SourceLang
	}

	r.Speakers[speakerID] = &Speaker{
		ID:         speakerID,
		SourceLang: sourceLang,
		Nickname:   nickname,
		ProfileImg: profileImg,
	}

	// FIX: Auto-update listener's targetLang to match sourceLang for bidirectional translation.
	// When a Korean speaker (sourceLang=ko) connects, they should receive Korean translations
	// of what other language speakers say. Without this, Korean speakers with targetLang=en
	// would never receive Korean translations, breaking bidirectional translation.
	listenerNeedsUpdate := false
	var oldTargetLang string
	if listener, exists := r.Listeners[speakerID]; exists {
		if listener.TargetLang != sourceLang {
			oldTargetLang = listener.TargetLang
			listener.TargetLang = sourceLang
			listenerNeedsUpdate = true
		}
	}
	r.mu.Unlock()

	// If sourceLang changed, clean up the old Transcribe stream
	if oldSourceLang != "" && oldSourceLang != sourceLang {
		log.Printf("[Room %s] Speaker %s changed language: %s -> %s, cleaning up old stream",
			r.ID, speakerID, oldSourceLang, sourceLang)
		if r.hub.useAWS && r.awsPipeline != nil {
			r.awsPipeline.RemoveSpeakerStream(speakerID, oldSourceLang)
		}
	}

	// Update target languages in AWS pipeline if listener targetLang was changed
	if listenerNeedsUpdate {
		log.Printf("[Room %s] 🔄 Auto-updated listener %s targetLang: %s -> %s (matching sourceLang for bidirectional translation)",
			r.ID, speakerID, oldTargetLang, sourceLang)
		if r.hub.useAWS && r.awsPipeline != nil {
			r.mu.RLock()
			targetLangs := make([]string, 0)
			langSet := make(map[string]bool)
			for _, l := range r.Listeners {
				if !langSet[l.TargetLang] {
					langSet[l.TargetLang] = true
					targetLangs = append(targetLangs, l.TargetLang)
				}
			}
			r.mu.RUnlock()
			r.awsPipeline.UpdateTargetLanguages(targetLangs)
		}
	}

	log.Printf("[Room %s] Added/updated speaker: %s (source: %s)",
		r.ID, speakerID, sourceLang)
}

// GetTargetLanguages returns all unique target languages in the room
func (r *Room) GetTargetLanguages() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()

	langSet := make(map[string]bool)
	for _, listener := range r.Listeners {
		langSet[listener.TargetLang] = true
	}

	langs := make([]string, 0, len(langSet))
	for lang := range langSet {
		langs = append(langs, lang)
	}
	return langs
}

// SendAudio sends audio from a speaker to be processed
func (r *Room) SendAudio(speakerID, sourceLang string, audioData []byte) {
	// Trim whitespace from speakerID (frontend may send padded IDs)
	speakerID = strings.TrimSpace(speakerID)
	sourceLang = strings.TrimSpace(sourceLang)

	select {
	case r.audioIn <- &AudioMessage{
		SpeakerID:  speakerID,
		SourceLang: sourceLang,
		AudioData:  audioData,
	}:
	default:
		log.Printf("[Room %s] Audio buffer full, dropping frame from %s", r.ID, speakerID)
	}
}

// Broadcast sends a message to all relevant listeners
func (r *Room) Broadcast(msg *BroadcastMessage) {
	select {
	case r.broadcast <- msg:
	default:
		log.Printf("[Room %s] Broadcast buffer full", r.ID)
	}
}

// Shutdown gracefully shuts down the room
func (r *Room) Shutdown() {
	r.cancel()

	// Close AWS pipeline if exists
	r.mu.Lock()
	if r.awsPipeline != nil {
		r.awsPipeline.Close()
		r.awsPipeline = nil
	}
	r.mu.Unlock()

	// Save transcripts to database before shutdown
	r.saveTranscriptsToDatabase()

	close(r.broadcast)
	close(r.audioIn)
	r.isRunning = false
	log.Printf("[Room %s] Shutdown complete", r.ID)
}

// saveTranscriptsToDatabase flushes Redis transcripts to the database
func (r *Room) saveTranscriptsToDatabase() {
	if r.hub.redisClient == nil || r.hub.db == nil {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Get and delete transcripts from Redis
	transcripts, err := r.hub.redisClient.FlushRoom(ctx, r.ID)
	if err != nil {
		log.Printf("[Room %s] Failed to flush transcripts from Redis: %v", r.ID, err)
		return
	}

	if len(transcripts) == 0 {
		log.Printf("[Room %s] No transcripts to save to database", r.ID)
		return
	}

	// Parse meetingID from roomID (format: "meeting-{id}")
	var meeting model.Meeting
	if strings.HasPrefix(r.ID, "meeting-") {
		meetingIDStr := strings.TrimPrefix(r.ID, "meeting-")
		if err := r.hub.db.Where("id = ?", meetingIDStr).First(&meeting).Error; err != nil {
			log.Printf("[Room %s] Meeting ID %s not found, skipping DB save: %v", r.ID, meetingIDStr, err)
			return
		}
	} else {
		// Try to find by code as fallback
		if err := r.hub.db.Where("code = ?", r.ID).First(&meeting).Error; err != nil {
			log.Printf("[Room %s] Meeting not found by code, skipping DB save: %v", r.ID, err)
			return
		}
	}

	// Convert Redis transcripts to VoiceRecord models
	voiceRecords := make([]model.VoiceRecord, 0, len(transcripts))
	for _, t := range transcripts {
		// Only save final transcripts to avoid duplicates
		if !t.IsFinal {
			continue
		}

		record := model.VoiceRecord{
			MeetingID:   meeting.ID,
			SpeakerName: t.SpeakerName,
			Original:    t.Original,
			CreatedAt:   t.Timestamp,
		}

		if t.SourceLang != "" {
			record.SourceLang = &t.SourceLang
		}
		if t.Translated != "" {
			record.Translated = &t.Translated
		}
		if t.TargetLang != "" {
			record.TargetLang = &t.TargetLang
		}

		voiceRecords = append(voiceRecords, record)
	}

	if len(voiceRecords) == 0 {
		log.Printf("[Room %s] No final transcripts to save", r.ID)
		return
	}

	// Bulk insert to database
	if err := r.hub.db.Create(&voiceRecords).Error; err != nil {
		log.Printf("[Room %s] Failed to save transcripts to database: %v", r.ID, err)
		return
	}

	log.Printf("[Room %s] Saved %d transcripts to database (meeting_id: %d)", r.ID, len(voiceRecords), meeting.ID)
}

// =============================================================================
// Room Goroutines
// =============================================================================

// runBroadcaster sends messages to appropriate listeners
func (r *Room) runBroadcaster() {
	log.Printf("[Room %s] Broadcaster started", r.ID)
	defer log.Printf("[Room %s] Broadcaster stopped", r.ID)

	for {
		select {
		case <-r.ctx.Done():
			return
		case msg, ok := <-r.broadcast:
			if !ok {
				return
			}
			r.broadcastMessage(msg)
		}
	}
}

func (r *Room) broadcastMessage(msg *BroadcastMessage) {
	r.mu.RLock()
	listeners := make([]*Listener, 0, len(r.Listeners))
	for _, l := range r.Listeners {
		listeners = append(listeners, l)
	}
	r.mu.RUnlock()

	for _, listener := range listeners {
		// Skip sending to the speaker themselves (don't hear your own translation)
		if listener.ID == msg.SpeakerID {
			continue
		}

		shouldSend := false

		if msg.Type == "transcript" {
			// For transcripts with translation: only send to matching target language
			// For original transcripts (no TargetLang): send to everyone except speaker
			if msg.TargetLang == "" {
				// Original transcript without translation - send to all (except speaker)
				shouldSend = true
			} else if msg.TargetLang == listener.TargetLang {
				// Translated transcript - only send to listeners with matching target language
				shouldSend = true
			}
		} else if msg.Type == "audio" {
			// Audio messages go only to matching targetLang (and not the speaker)
			shouldSend = msg.TargetLang == listener.TargetLang
		}

		if shouldSend {
			r.sendToListener(listener, msg)
		}
	}
}

func (r *Room) sendToListener(listener *Listener, msg *BroadcastMessage) {
	listener.writeMu.Lock()
	defer listener.writeMu.Unlock()

	var err error
	if msg.AudioData != nil && len(msg.AudioData) > 0 {
		// Send binary audio data
		err = listener.Conn.WriteMessage(websocket.BinaryMessage, msg.AudioData)
	} else {
		// Send JSON message
		jsonData, jsonErr := json.Marshal(msg)
		if jsonErr != nil {
			log.Printf("[Room %s] Failed to marshal message: %v", r.ID, jsonErr)
			return
		}
		err = listener.Conn.WriteMessage(websocket.TextMessage, jsonData)
	}

	if err != nil {
		log.Printf("[Room %s] Failed to send to listener %s: %v", r.ID, listener.ID, err)
	}
}

// runAudioProcessor processes incoming audio and sends to AI server
func (r *Room) runAudioProcessor() {
	log.Printf("[Room %s] Audio processor started (useAWS: %v)", r.ID, r.hub.useAWS)
	defer log.Printf("[Room %s] Audio processor stopped", r.ID)

	// Start AI stream (AWS or gRPC)
	if err := r.startStream(); err != nil {
		log.Printf("[Room %s] Failed to start stream: %v", r.ID, err)
		return
	}

	for {
		select {
		case <-r.ctx.Done():
			return
		case audioMsg, ok := <-r.audioIn:
			if !ok {
				return
			}
			r.processAudio(audioMsg)
		}
	}
}

// startStream starts either AWS pipeline or gRPC stream
func (r *Room) startStream() error {
	if r.hub.useAWS {
		return r.startAWSPipeline()
	}
	return r.startGrpcStream()
}

func (r *Room) startGrpcStream() error {
	if r.hub.aiClient == nil {
		log.Printf("[Room %s] AI client not available", r.ID)
		return nil
	}

	// Get target languages for this room
	targetLangs := r.GetTargetLanguages()
	if len(targetLangs) == 0 {
		targetLangs = []string{"en"} // Default
	}

	// Build participants from listeners
	participants := make([]ai.ParticipantConfig, 0)
	r.mu.RLock()
	for _, listener := range r.Listeners {
		participants = append(participants, ai.ParticipantConfig{
			ParticipantID:      listener.ID,
			Nickname:           listener.ID,
			TargetLanguage:     listener.TargetLang,
			TranslationEnabled: true,
		})
	}
	r.mu.RUnlock()

	// Create session config for gRPC stream
	sessionCfg := &ai.SessionConfig{
		SampleRate:     16000,
		Channels:       1,
		BitsPerSample:  16,
		SourceLanguage: "ko", // Will be updated per speaker
		Participants:   participants,
		Speaker: &ai.SpeakerConfig{
			ParticipantID:  "room-" + r.ID,
			Nickname:       "Room Speaker",
			SourceLanguage: "ko",
		},
	}

	stream, err := r.hub.aiClient.StartChatStream(r.ctx, "room-"+r.ID, r.ID, sessionCfg)
	if err != nil {
		return err
	}

	r.mu.Lock()
	r.grpcStream = stream
	r.mu.Unlock()

	// Start receiving responses
	go r.receiveGrpcResponses()

	return nil
}

// startAWSPipeline starts AWS AI pipeline for the room
func (r *Room) startAWSPipeline() error {
	if r.hub.cfg == nil {
		log.Printf("[Room %s] Config not available for AWS pipeline", r.ID)
		return nil
	}

	// Get target languages for this room
	targetLangs := r.GetTargetLanguages()
	if len(targetLangs) == 0 {
		targetLangs = []string{"en"} // Default
	}

	pipelineCfg := &awsai.PipelineConfig{
		TargetLanguages:  targetLangs,
		SampleRate:       16000,
		UseStreamManager: true, // Enable language-based stream pooling
		UseWorkerPools:   true, // Enable worker pools for translation/TTS
	}

	var pipeline *awsai.Pipeline
	var err error

	// Use shared client pool if available
	if r.hub.awsClientPool != nil {
		pipeline, err = awsai.NewPipelineWithClientPool(r.ctx, r.hub.awsClientPool, pipelineCfg)
		if err != nil {
			log.Printf("[Room %s] Failed to create AWS pipeline with client pool: %v", r.ID, err)
			return err
		}
		log.Printf("[Room %s] AWS pipeline started with shared client pool (targets: %v)", r.ID, targetLangs)
	} else {
		// Fallback to legacy mode (create clients per room)
		pipelineCfg.UseStreamManager = false // Disable new features for legacy mode
		pipelineCfg.UseWorkerPools = false
		pipeline, err = awsai.NewPipeline(r.ctx, r.hub.cfg, pipelineCfg)
		if err != nil {
			log.Printf("[Room %s] Failed to create AWS pipeline: %v", r.ID, err)
			return err
		}
		log.Printf("[Room %s] AWS pipeline started in legacy mode (targets: %v)", r.ID, targetLangs)
	}

	r.mu.Lock()
	r.awsPipeline = pipeline
	// After pipeline is set, immediately update target languages with ALL current listeners
	// This fixes race condition where listeners joined while pipeline was being created
	currentTargetLangs := make([]string, 0)
	langSet := make(map[string]bool)
	for _, l := range r.Listeners {
		if !langSet[l.TargetLang] {
			langSet[l.TargetLang] = true
			currentTargetLangs = append(currentTargetLangs, l.TargetLang)
		}
	}
	r.mu.Unlock()

	// Update with all current listeners' target languages (outside lock to avoid deadlock)
	if len(currentTargetLangs) > 0 {
		pipeline.UpdateTargetLanguages(currentTargetLangs)
		log.Printf("[Room %s] 🔄 Updated target languages after pipeline creation: %v", r.ID, currentTargetLangs)
	}

	// Start receiving responses from AWS pipeline
	go r.receiveAWSResponses()

	return nil
}

// receiveAWSResponses handles responses from AWS pipeline
func (r *Room) receiveAWSResponses() {
	r.mu.RLock()
	pipeline := r.awsPipeline
	r.mu.RUnlock()

	if pipeline == nil {
		return
	}

	for {
		select {
		case <-r.ctx.Done():
			return

		case transcript, ok := <-pipeline.TranscriptChan:
			if !ok {
				log.Printf("[Room %s] AWS TranscriptChan closed", r.ID)
				return
			}
			r.handleTranscript(transcript)

		case audio, ok := <-pipeline.AudioChan:
			if !ok {
				log.Printf("[Room %s] AWS AudioChan closed", r.ID)
				return
			}
			r.handleAudio(audio)

		case err, ok := <-pipeline.ErrChan:
			if !ok {
				return
			}
			if err != nil {
				log.Printf("[Room %s] AWS pipeline error: %v", r.ID, err)
			}
		}
	}
}

func (r *Room) receiveGrpcResponses() {
	r.mu.RLock()
	stream := r.grpcStream
	r.mu.RUnlock()

	if stream == nil {
		return
	}

	for {
		select {
		case <-r.ctx.Done():
			return

		case transcript, ok := <-stream.TranscriptChan:
			if !ok {
				log.Printf("[Room %s] TranscriptChan closed", r.ID)
				return
			}
			r.handleTranscript(transcript)

		case audio, ok := <-stream.AudioChan:
			if !ok {
				log.Printf("[Room %s] AudioChan closed", r.ID)
				return
			}
			r.handleAudio(audio)

		case err, ok := <-stream.ErrChan:
			if !ok {
				return
			}
			if err != nil {
				log.Printf("[Room %s] gRPC error: %v", r.ID, err)
				return
			}
		}
	}
}

func (r *Room) handleTranscript(t *ai.TranscriptMessage) {
	speakerID := ""
	speakerName := ""
	if t.Speaker != nil {
		speakerID = t.Speaker.ParticipantId
		speakerName = t.Speaker.ParticipantId // 또는 Speaker.Nickname이 있으면 사용
	}

	// 번역이 있는 경우: 번역된 메시지만 전송 (원본 포함됨)
	// 번역이 없는 경우: 원본만 전송
	if len(t.Translations) > 0 {
		// Broadcast translations to each target language (includes original)
		for _, trans := range t.Translations {
			r.Broadcast(&BroadcastMessage{
				Type:       "transcript",
				SpeakerID:  speakerID,
				TargetLang: trans.TargetLanguage,
				Data: TranscriptData{
					ParticipantID: speakerID,
					Original:      t.OriginalText,
					Translated:    trans.TranslatedText,
					IsFinal:       t.IsFinal,
					Language:      t.OriginalLanguage,
				},
			})
		}

		// Save translated transcript to Redis (only once per translation)
		if t.IsFinal && r.hub.redisClient != nil {
			for _, trans := range t.Translations {
				go func(targetLang, translatedText string) {
					ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
					defer cancel()

					transcript := &cache.RoomTranscript{
						RoomID:      r.ID,
						SpeakerID:   speakerID,
						SpeakerName: speakerName,
						Original:    t.OriginalText,
						Translated:  translatedText,
						SourceLang:  t.OriginalLanguage,
						TargetLang:  targetLang,
						IsFinal:     t.IsFinal,
					}

					if err := r.hub.redisClient.AddTranscript(ctx, r.ID, transcript); err != nil {
						log.Printf("[Room %s] Failed to save translated transcript to Redis: %v", r.ID, err)
					}
				}(trans.TargetLanguage, trans.TranslatedText)
			}
		}
	} else {
		// No translations - broadcast original only
		r.Broadcast(&BroadcastMessage{
			Type:      "transcript",
			SpeakerID: speakerID,
			Data: TranscriptData{
				ParticipantID: speakerID,
				Original:      t.OriginalText,
				IsFinal:       t.IsFinal,
				Language:      t.OriginalLanguage,
			},
		})

		// Save original to Redis
		if t.IsFinal && r.hub.redisClient != nil {
			go func() {
				ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
				defer cancel()

				transcript := &cache.RoomTranscript{
					RoomID:      r.ID,
					SpeakerID:   speakerID,
					SpeakerName: speakerName,
					Original:    t.OriginalText,
					SourceLang:  t.OriginalLanguage,
					IsFinal:     t.IsFinal,
				}

				if err := r.hub.redisClient.AddTranscript(ctx, r.ID, transcript); err != nil {
					log.Printf("[Room %s] Failed to save transcript to Redis: %v", r.ID, err)
				}
			}()
		}
	}
}

func (r *Room) handleAudio(audio *ai.AudioMessage) {
	log.Printf("[Room %s] 🔊 Broadcasting TTS audio: speaker=%s, targetLang=%s, size=%d bytes",
		r.ID, audio.SpeakerParticipantID, audio.TargetLanguage, len(audio.AudioData))
	r.Broadcast(&BroadcastMessage{
		Type:       "audio",
		SpeakerID:  audio.SpeakerParticipantID,
		TargetLang: audio.TargetLanguage,
		AudioData:  audio.AudioData,
	})
}

func (r *Room) processAudio(msg *AudioMessage) {
	if r.hub.useAWS {
		r.processAudioAWS(msg)
	} else {
		r.processAudioGRPC(msg)
	}
}

// processAudioAWS sends audio to AWS pipeline
func (r *Room) processAudioAWS(msg *AudioMessage) {
	r.mu.RLock()
	pipeline := r.awsPipeline
	speaker := r.Speakers[msg.SpeakerID]
	r.mu.RUnlock()

	if pipeline == nil {
		log.Printf("[Room %s] ❌ No AWS pipeline, audio dropped (speakerID=%s)", r.ID, msg.SpeakerID)
		return
	}

	// Speaker 정보 결정
	speakerName := msg.SpeakerID
	profileImg := ""
	if speaker != nil {
		if speaker.Nickname != "" {
			speakerName = speaker.Nickname
		}
		profileImg = speaker.ProfileImg
	}

	// Debug log disabled to reduce noise
	// log.Printf("[Room %s] 🎤 Processing audio: speaker=%s, lang=%s, size=%d bytes",
	// 	r.ID, msg.SpeakerID, msg.SourceLang, len(msg.AudioData))

	if err := pipeline.ProcessAudio(msg.SpeakerID, msg.SourceLang, speakerName, profileImg, msg.AudioData); err != nil {
		log.Printf("[Room %s] ❌ AWS pipeline error: %v", r.ID, err)
	}
}

// processAudioGRPC sends audio to Python gRPC server
func (r *Room) processAudioGRPC(msg *AudioMessage) {
	r.mu.RLock()
	stream := r.grpcStream
	// Speaker 정보 가져오기
	speaker := r.Speakers[msg.SpeakerID]
	r.mu.RUnlock()

	if stream == nil {
		log.Printf("[Room %s] No gRPC stream, audio dropped", r.ID)
		return
	}

	// Speaker 정보 결정
	speakerName := msg.SpeakerID
	profileImg := ""
	if speaker != nil {
		speakerName = speaker.Nickname
		if speakerName == "" {
			speakerName = speaker.ID
		}
		profileImg = speaker.ProfileImg
	}

	// Send audio with speaker info to AI server
	audioChunk := &ai.AudioChunkWithSpeaker{
		AudioData:   msg.AudioData,
		SpeakerID:   msg.SpeakerID,
		SpeakerName: speakerName,
		SourceLang:  msg.SourceLang,
		ProfileImg:  profileImg,
	}

	select {
	case stream.SendChan <- audioChunk:
		// Audio sent successfully
	default:
		log.Printf("[Room %s] Send channel full, audio dropped from %s", r.ID, msg.SpeakerID)
	}
}

// =============================================================================
// Cleanup
// =============================================================================

// CleanupInactiveRooms removes rooms with no activity
func (h *RoomHub) CleanupInactiveRooms(maxAge time.Duration) {
	h.mu.Lock()
	defer h.mu.Unlock()

	for roomID, room := range h.rooms {
		room.mu.RLock()
		isEmpty := len(room.Listeners) == 0 && len(room.Speakers) == 0
		room.mu.RUnlock()

		if isEmpty {
			room.Shutdown()
			delete(h.rooms, roomID)
			log.Printf("[RoomHub] Cleaned up inactive room: %s", roomID)
		}
	}
}

// Close shuts down the RoomHub and cleans up all resources
func (h *RoomHub) Close() {
	h.mu.Lock()
	defer h.mu.Unlock()

	// Shutdown all rooms
	for roomID, room := range h.rooms {
		room.Shutdown()
		delete(h.rooms, roomID)
	}

	// Close the shared AWS client pool
	if h.awsClientPool != nil {
		h.awsClientPool.Close()
		h.awsClientPool = nil
		log.Printf("[RoomHub] AWS client pool closed")
	}

	log.Printf("[RoomHub] Shutdown complete")
}

// GetClientPoolStats returns statistics about the shared AWS client pool
func (h *RoomHub) GetClientPoolStats() map[string]interface{} {
	if h.awsClientPool == nil {
		return map[string]interface{}{
			"available": false,
		}
	}
	stats := h.awsClientPool.Stats()
	stats["available"] = true
	return stats
}
