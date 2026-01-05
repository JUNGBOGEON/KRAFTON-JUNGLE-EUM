package handler

import (
	"log"
	"strconv"
	"strings"
	"time"

	"realtime-backend/internal/config"
	"realtime-backend/internal/model"

	"github.com/gofiber/fiber/v2"
	"gorm.io/gorm"
)

type PollHandler struct {
	cfg *config.Config
	db  *gorm.DB
}

func NewPollHandler(cfg *config.Config, db *gorm.DB) *PollHandler {
	return &PollHandler{cfg: cfg, db: db}
}

// CreatePollRequest payload
type CreatePollRequest struct {
	RoomName string   `json:"roomName"`
	Question string   `json:"question"`
	Options  []string `json:"options"`
}

// VoteRequest payload
type VoteRequest struct {
	PollID   uint `json:"pollId"`
	OptionID uint `json:"optionId"`
}

// Helper to get meeting ID (similar to whiteboard handler)
func (h *PollHandler) getMeetingID(roomName string, userID int64) (int64, error) {
	// 1. Check for standard "meeting-{id}" format
	if strings.HasPrefix(roomName, "meeting-") {
		idStr := strings.TrimPrefix(roomName, "meeting-")
		return strconv.ParseInt(idStr, 10, 64)
	}

	// 2. Check for raw ID (e.g. "1")
	if id, err := strconv.ParseInt(roomName, 10, 64); err == nil {
		return id, nil
	}

	// 3. Check for specific Workspace Channel format: "workspace-{wid}-call-{name}"
	if strings.HasPrefix(roomName, "workspace-") && strings.Contains(roomName, "-call-") {
		var meeting model.Meeting
		if err := h.db.Select("id").Where("code = ?", roomName).First(&meeting).Error; err == nil {
			return meeting.ID, nil
		}

		// Lazy Create
		parts := strings.Split(roomName, "-")
		if len(parts) >= 4 {
			if wid, err := strconv.ParseInt(parts[1], 10, 64); err == nil {
				newMeeting := model.Meeting{
					WorkspaceID: &wid,
					HostID:      userID,
					Title:       strings.Join(parts[3:], " "),
					Code:        roomName,
					Type:        "WORKSPACE_CHANNEL",
					Status:      "ALWAYS_OPEN",
				}
				if newMeeting.HostID == 0 {
					return 0, gorm.ErrRecordNotFound
				}
				if err := h.db.Create(&newMeeting).Error; err != nil {
					if err := h.db.Select("id").Where("code = ?", roomName).First(&meeting).Error; err == nil {
						return meeting.ID, nil
					}
					return 0, err
				}
				return newMeeting.ID, nil
			}
		}
	}

	// 4. Fallback: Try finding by Code
	var meeting model.Meeting
	if err := h.db.Select("id").Where("code = ?", roomName).First(&meeting).Error; err != nil {
		return 0, err
	}
	return meeting.ID, nil
}

// CreatePoll
func (h *PollHandler) CreatePoll(c *fiber.Ctx) error {
	var req CreatePollRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request"})
	}

	userId := c.Locals("userId").(int64)
	meetingID, err := h.getMeetingID(req.RoomName, userId)
	if err != nil {
		// If no SQL meeting found, maybe it's a transient room?
		// For this feature to work with persistence, we need a meeting record.
		// Fallback: create a dummy meeting ID or error?
		// Let's assume meeting exists for now.
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Meeting not found"})
	}

	// Deactivate previous active polls for this meeting (if we only allow 1 active poll)
	// Or just let them be. Let's allow multiple but maybe UI only shows latest.
	// h.db.Model(&model.Poll{}).Where("meeting_id = ? AND is_active = ?", meetingID, true).Update("is_active", false)

	poll := model.Poll{
		MeetingID: meetingID,
		Question:  req.Question,
		CreatedAt: time.Now(),
		IsActive:  true,
		Options:   make([]model.PollOption, len(req.Options)),
	}

	for i, optText := range req.Options {
		poll.Options[i] = model.PollOption{
			Text: optText,
		}
	}

	if err := h.db.Create(&poll).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to create poll"})
	}

	log.Printf("[Poll] User %d created poll %d in meeting %d", userId, poll.ID, meetingID)
	return c.JSON(poll)
}

// GetActivePolls
func (h *PollHandler) GetActivePolls(c *fiber.Ctx) error {
	roomName := c.Query("roomName")
	if roomName == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Room name required"})
	}

	userId := int64(0)
	if val := c.Locals("userId"); val != nil {
		userId = val.(int64)
	}
	meetingID, err := h.getMeetingID(roomName, userId)
	if err != nil {
		return c.JSON(fiber.Map{"polls": []model.Poll{}}) // Empty if meeting not found
	}

	var polls []model.Poll
	// Setup query to include options
	if err := h.db.Preload("Options").Where("meeting_id = ? AND is_active = ?", meetingID, true).Order("created_at DESC").Find(&polls).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to fetch polls"})
	}

	return c.JSON(fiber.Map{"polls": polls})
}

// VotePoll
func (h *PollHandler) VotePoll(c *fiber.Ctx) error {
	var req VoteRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request"})
	}

	userId := c.Locals("userId").(int64)

	// 1. Check if user already voted on this poll
	var existingVote model.PollVote
	if err := h.db.Where("poll_id = ? AND user_id = ?", req.PollID, userId).First(&existingVote).Error; err == nil {
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "Already voted"})
	}

	// 2. Transaction to record vote and increment count
	err := h.db.Transaction(func(tx *gorm.DB) error {
		// Verify Poll exists and is active
		var poll model.Poll
		if err := tx.First(&poll, req.PollID).Error; err != nil {
			return err
		}
		if !poll.IsActive {
			return fiber.NewError(fiber.StatusBadRequest, "Poll is closed")
		}

		// Create Vote Record
		vote := model.PollVote{
			PollID:    req.PollID,
			OptionID:  req.OptionID,
			UserID:    userId,
			CreatedAt: time.Now(),
		}
		if err := tx.Create(&vote).Error; err != nil {
			return err
		}

		// Increment Option Count
		if err := tx.Model(&model.PollOption{}).Where("id = ?", req.OptionID).UpdateColumn("vote_count", gorm.Expr("vote_count + ?", 1)).Error; err != nil {
			return err
		}

		return nil
	})

	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	return c.JSON(fiber.Map{"success": true})
}

// ClosePoll
func (h *PollHandler) ClosePoll(c *fiber.Ctx) error {
	pollIDStr := c.Params("id")
	pollID, _ := strconv.Atoi(pollIDStr)

	if err := h.db.Model(&model.Poll{}).Where("id = ?", pollID).Update("is_active", false).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to close poll"})
	}

	return c.JSON(fiber.Map{"success": true})
}
