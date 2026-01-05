package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	internalAuth "realtime-backend/internal/auth"
	"realtime-backend/internal/config"

	"github.com/gofiber/fiber/v2"
	"github.com/livekit/protocol/auth"
	"github.com/livekit/protocol/livekit"
	lksdk "github.com/livekit/server-sdk-go/v2"
	"gorm.io/gorm"
)

type VideoHandler struct {
	cfg *config.Config
	db  *gorm.DB
}

func NewVideoHandler(cfg *config.Config, db *gorm.DB) *VideoHandler {
	return &VideoHandler{cfg: cfg, db: db}
}

type TokenRequest struct {
	RoomName        string `json:"roomName"`
	ParticipantName string `json:"participantName"`
}

type TokenResponse struct {
	Token string `json:"token"`
}

// ParticipantMetadata is stored in LiveKit participant metadata
type ParticipantMetadata struct {
	ProfileImg string `json:"profileImg,omitempty"`
	UserID     int64  `json:"userId,omitempty"`
}

// GenerateToken creates a LiveKit access token for a participant
func (h *VideoHandler) GenerateToken(c *fiber.Ctx) error {
	var req TokenRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	// If participantName is missing from body, try to use authenticated user's nickname
	// This is a slight enhancement to fit the current project's auth verification
	if req.ParticipantName == "" {
		nickname := c.Locals("nickname")
		if n, ok := nickname.(string); ok && n != "" {
			req.ParticipantName = n
		}
	}

	if req.RoomName == "" || req.ParticipantName == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "roomName and participantName are required",
		})
	}

	// roomName format: meeting-{id} 가 있다면 종료 여부 및 권한 확인
	if len(req.RoomName) > 8 && req.RoomName[:8] == "meeting-" {
		idStr := req.RoomName[8:]
		var meeting struct {
			Status      string
			WorkspaceID int64
		}
		// model.Meeting 대신 가벼운 구조체 사용 또는 GORM 활용
		if err := h.db.Table("meetings").Select("status, workspace_id").Where("id = ?", idStr).Scan(&meeting).Error; err == nil {
			if meeting.Status == "ENDED" {
				return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
					"error": "이미 종료된 통화방입니다.",
				})
			}

			// 권한 확인 (CONNECT_VOICE)
			if userID, ok := c.Locals("userId").(int64); ok {
				hasPermission, err := internalAuth.CheckPermission(h.db, meeting.WorkspaceID, userID, "CONNECT_VOICE")
				if err != nil {
					return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to check permission"})
				}
				if !hasPermission {
					return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
						"error": "you do not have permission to join video calls",
					})
				}
			}
		}
	}

	// Get user profile image from database
	var metadata ParticipantMetadata
	if userID, ok := c.Locals("userId").(int64); ok {
		metadata.UserID = userID
		var user struct {
			ProfileImg string
		}
		if err := h.db.Table("users").Select("profile_img").Where("id = ?", userID).Scan(&user).Error; err == nil {
			metadata.ProfileImg = user.ProfileImg
		}
	}

	// Serialize metadata to JSON
	metadataJSON, _ := json.Marshal(metadata)

	// Create access token
	at := auth.NewAccessToken(h.cfg.LiveKit.APIKey, h.cfg.LiveKit.APISecret)

	// Create video grant
	canUpdateMetadata := true
	grant := &auth.VideoGrant{
		RoomJoin:             true,
		Room:                 req.RoomName,
		CanUpdateOwnMetadata: &canUpdateMetadata, // 참가자가 자신의 메타데이터(sourceLanguage 등) 업데이트 가능
	}

	// User ID를 Identity로 사용
	identity := req.ParticipantName
	if userID, ok := c.Locals("userId").(int64); ok {
		identity = fmt.Sprintf("%d", userID)
	}

	at.AddGrant(grant).
		SetIdentity(identity).
		SetName(req.ParticipantName).
		SetMetadata(string(metadataJSON)).
		SetValidFor(time.Hour * 24)

	token, err := at.ToJWT()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to generate token",
		})
	}

	return c.JSON(TokenResponse{Token: token})
}

// RoomParticipant represents a participant in a room
type RoomParticipant struct {
	Identity string `json:"identity"`
	Name     string `json:"name"`
	JoinedAt int64  `json:"joinedAt"`
}

// RoomParticipantsResponse represents the response for room participants
type RoomParticipantsResponse struct {
	RoomName     string            `json:"roomName"`
	Participants []RoomParticipant `json:"participants"`
}

// GetRoomParticipants returns the list of participants in a room
func (h *VideoHandler) GetRoomParticipants(c *fiber.Ctx) error {
	roomName := c.Query("roomName")
	if roomName == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "roomName is required",
		})
	}

	// Create RoomService client
	roomClient := lksdk.NewRoomServiceClient(
		h.cfg.LiveKit.Host,
		h.cfg.LiveKit.APIKey,
		h.cfg.LiveKit.APISecret,
	)

	// Get participants from the room
	ctx := context.Background()
	res, err := roomClient.ListParticipants(ctx, &livekit.ListParticipantsRequest{
		Room: roomName,
	})
	if err != nil {
		// Room doesn't exist or no participants - return empty list
		return c.JSON(RoomParticipantsResponse{
			RoomName:     roomName,
			Participants: []RoomParticipant{},
		})
	}

	// Convert to response format
	participants := make([]RoomParticipant, 0, len(res.Participants))
	for _, p := range res.Participants {
		participants = append(participants, RoomParticipant{
			Identity: p.Identity,
			Name:     p.Name,
			JoinedAt: p.JoinedAt,
		})
	}

	return c.JSON(RoomParticipantsResponse{
		RoomName:     roomName,
		Participants: participants,
	})
}

// GetAllRoomsParticipants returns participants for multiple rooms
func (h *VideoHandler) GetAllRoomsParticipants(c *fiber.Ctx) error {
	// Get room names from query (comma-separated)
	roomNames := c.Query("rooms")
	if roomNames == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "rooms parameter is required",
		})
	}

	// Create RoomService client
	roomClient := lksdk.NewRoomServiceClient(
		h.cfg.LiveKit.Host,
		h.cfg.LiveKit.APIKey,
		h.cfg.LiveKit.APISecret,
	)

	ctx := context.Background()
	result := make(map[string][]RoomParticipant)

	// Split room names and get participants for each
	for _, roomName := range splitRoomNames(roomNames) {
		res, err := roomClient.ListParticipants(ctx, &livekit.ListParticipantsRequest{
			Room: roomName,
		})
		if err != nil {
			result[roomName] = []RoomParticipant{}
			continue
		}

		participants := make([]RoomParticipant, 0, len(res.Participants))
		for _, p := range res.Participants {
			participants = append(participants, RoomParticipant{
				Identity: p.Identity,
				Name:     p.Name,
				JoinedAt: p.JoinedAt,
			})
		}
		result[roomName] = participants
	}

	return c.JSON(result)
}

// splitRoomNames splits comma-separated room names
func splitRoomNames(s string) []string {
	var result []string
	current := ""
	for _, c := range s {
		if c == ',' {
			if current != "" {
				result = append(result, current)
				current = ""
			}
		} else {
			current += string(c)
		}
	}
	if current != "" {
		result = append(result, current)
	}
	return result
}
