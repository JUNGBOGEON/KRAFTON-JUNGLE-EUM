package handler

import (
	"context"
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/gofiber/contrib/websocket"

	"realtime-backend/internal/ai"
)

// =============================================================================
// Room Hub - Room 단위 WebSocket 및 gRPC 관리
// =============================================================================

// RoomHub manages all rooms and their connections
type RoomHub struct {
	rooms    map[string]*Room
	mu       sync.RWMutex
	aiClient *ai.GrpcClient
}

// Room represents a single room with listeners and speakers
type Room struct {
	ID         string
	Listeners  map[string]*Listener
	Speakers   map[string]*Speaker
	grpcStream *ai.ChatStream
	broadcast  chan *BroadcastMessage
	audioIn    chan *AudioMessage
	ctx        context.Context
	cancel     context.CancelFunc
	mu         sync.RWMutex
	hub        *RoomHub
	isRunning  bool
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
func NewRoomHub(aiClient *ai.GrpcClient) *RoomHub {
	return &RoomHub{
		rooms:    make(map[string]*Room),
		aiClient: aiClient,
	}
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

	// If no listeners and no speakers, cleanup room
	if len(r.Listeners) == 0 && len(r.Speakers) == 0 {
		go r.hub.RemoveRoom(r.ID)
	}
}

// AddOrUpdateSpeaker adds or updates a speaker
func (r *Room) AddOrUpdateSpeaker(speakerID, sourceLang, nickname, profileImg string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.Speakers[speakerID] = &Speaker{
		ID:         speakerID,
		SourceLang: sourceLang,
		Nickname:   nickname,
		ProfileImg: profileImg,
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
	close(r.broadcast)
	close(r.audioIn)
	r.isRunning = false
	log.Printf("[Room %s] Shutdown complete", r.ID)
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
		// Transcript messages go to all listeners
		// Audio messages go only to matching targetLang
		if msg.Type == "transcript" || msg.TargetLang == listener.TargetLang {
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
	log.Printf("[Room %s] Audio processor started", r.ID)
	defer log.Printf("[Room %s] Audio processor stopped", r.ID)

	// Start gRPC stream to AI server
	if err := r.startGrpcStream(); err != nil {
		log.Printf("[Room %s] Failed to start gRPC stream: %v", r.ID, err)
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
	config := &ai.SessionConfig{
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

	stream, err := r.hub.aiClient.StartChatStream(r.ctx, "room-"+r.ID, r.ID, config)
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
	if t.Speaker != nil {
		speakerID = t.Speaker.ParticipantId
	}

	// Broadcast original transcript to all
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

	// Broadcast translations to each target language
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
				Language:      trans.TargetLanguage,
			},
		})
	}
}

func (r *Room) handleAudio(audio *ai.AudioMessage) {
	r.Broadcast(&BroadcastMessage{
		Type:       "audio",
		SpeakerID:  audio.SpeakerParticipantID,
		TargetLang: audio.TargetLanguage,
		AudioData:  audio.AudioData,
	})
}

func (r *Room) processAudio(msg *AudioMessage) {
	r.mu.RLock()
	stream := r.grpcStream
	r.mu.RUnlock()

	if stream == nil {
		log.Printf("[Room %s] No gRPC stream, audio dropped", r.ID)
		return
	}

	// Send audio to AI server via ChatStream's send channel
	select {
	case stream.SendChan <- msg.AudioData:
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
