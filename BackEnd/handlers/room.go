package handlers

import (
	"log"
	"time"

	"video-call-backend/config"

	"github.com/gofiber/fiber/v2"
	"github.com/livekit/protocol/auth"
)

type RoomHandler struct {
	config *config.Config
}

func NewRoomHandler(cfg *config.Config) *RoomHandler {
	return &RoomHandler{config: cfg}
}

type TokenRequest struct {
	RoomName        string `json:"roomName"`
	ParticipantName string `json:"participantName"`
}

type TokenResponse struct {
	Token string `json:"token"`
}

// GenerateToken creates a LiveKit access token for a participant
func (h *RoomHandler) GenerateToken(c *fiber.Ctx) error {
	log.Println("🔹 GenerateToken called") // Debug Log

	var req TokenRequest
	if err := c.BodyParser(&req); err != nil {
		log.Printf("❌ BodyParser failed: %v", err) // Debug Log
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}
	log.Printf("🔹 Request: room=%s, user=%s", req.RoomName, req.ParticipantName) // Debug Log

	if req.RoomName == "" || req.ParticipantName == "" {
		log.Println("❌ Missing required fields") // Debug Log
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "roomName and participantName are required",
		})
	}

	if h.config.LiveKitAPIKey == "" || h.config.LiveKitAPISecret == "" {
		log.Println("❌ Critical: LiveKit API Key or Secret is missing in config")
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Server misconfiguration",
		})
	}

	// Create access token
	at := auth.NewAccessToken(h.config.LiveKitAPIKey, h.config.LiveKitAPISecret)

	// Debug Log API Key (Masked)
	maskedKey := ""
	if len(h.config.LiveKitAPIKey) > 4 {
		maskedKey = h.config.LiveKitAPIKey[:4] + "***"
	} else {
		maskedKey = "invalid-key-length"
	}
	log.Printf("🔹 Using API Key: %s", maskedKey)

	// Create video grant
	grant := &auth.VideoGrant{
		RoomJoin: true,
		Room:     req.RoomName,
	}

	at.AddGrant(grant).
		SetIdentity(req.ParticipantName).
		SetValidFor(time.Hour * 24)

	log.Println("🔹 Token created, attempting to sign...") // Debug Log

	token, err := at.ToJWT()
	if err != nil {
		log.Printf("❌ ToJWT failed: %v", err) // Debug Log
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to generate token",
		})
	}

	log.Printf("✅ Token generated successfully: %s...", token[:10]) // Debug Log

	return c.JSON(TokenResponse{Token: token})
}

// GetRooms returns a list of active rooms (placeholder for future implementation)
func (h *RoomHandler) GetRooms(c *fiber.Ctx) error {
	// For a simple test site, we don't need room listing
	// This can be expanded later using LiveKit's RoomService
	return c.JSON(fiber.Map{
		"rooms": []string{},
	})
}
