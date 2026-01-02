package handler

import (
	"encoding/json"
	"log"
	"realtime-backend/internal/model"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"gorm.io/gorm"
)

type WhiteboardHandler struct {
	db *gorm.DB
}

func NewWhiteboardHandler(db *gorm.DB) *WhiteboardHandler {
	return &WhiteboardHandler{db: db}
}

type WhiteboardRequest struct {
	Room   string `json:"room"`
	Stroke any    `json:"stroke,omitempty"` // Can be single object or array
	Type   string `json:"type,omitempty"`   // add, clear, undo, redo, snapshot
}

// GetWhiteboard returns the history of strokes for the meeting
func (h *WhiteboardHandler) GetWhiteboard(c *fiber.Ctx) error {
	roomName := c.Query("room")
	if roomName == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Room name is required"})
	}

	userID := int64(0)
	if val := c.Locals("userID"); val != nil {
		userID = val.(int64)
	}

	meetingID, err := h.getMeetingID(roomName, userID)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Meeting not found"})
	}

	// 1. Fetch Snapshots (Chunked data)
	var snapshots []model.WhiteboardSnapshot
	if err := h.db.Where("meeting_id = ?", meetingID).Order("id ASC").Find(&snapshots).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to fetch snapshots"})
	}

	// 2. Fetch Active Strokes (Non-deleted, Recent)
	var strokes []model.WhiteboardStroke
	if err := h.db.Where("meeting_id = ? AND is_deleted = ?", meetingID, false).
		Order("id ASC").
		Find(&strokes).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to fetch strokes"})
	}

	// 3. Merge data
	history := make([]any, 0)

	// Add snapshots first
	for _, snap := range snapshots {
		var chunk []any
		if err := json.Unmarshal([]byte(snap.Data), &chunk); err == nil {
			history = append(history, chunk...)
		} else {
			log.Printf("[Whiteboard] Failed to parse snapshot %d: %v", snap.ID, err)
	history := []any{}
	if whiteboard.Data != nil {
		if err := json.Unmarshal([]byte(*whiteboard.Data), &history); err != nil {
			log.Printf("warning: failed to unmarshal whiteboard history: %v", err)
			history = []any{}
		}
	}

	redoStack := []any{}
	if whiteboard.RedoData != nil {
		if err := json.Unmarshal([]byte(*whiteboard.RedoData), &redoStack); err != nil {
			log.Printf("warning: failed to unmarshal whiteboard redo stack: %v", err)
			redoStack = []any{}
		}
	}

	// Add recent strokes
	for _, s := range strokes {
		var strokeData any
		if err := json.Unmarshal([]byte(s.StrokeData), &strokeData); err == nil {
			history = append(history, strokeData)
		}
	}

	// Undo/Redo is only for available strokes in 'whiteboard_strokes'
	// Users cannot undo archived snapshot content easily.
	var deletedCount int64
	h.db.Model(&model.WhiteboardStroke{}).Where("meeting_id = ? AND is_deleted = ?", meetingID, true).Count(&deletedCount)

	return c.JSON(fiber.Map{
		"success": true,
		"history": history,
		"canUndo": len(strokes) > 0,
		"canRedo": deletedCount > 0,
	})
}

// Helper to chunk strokes into a snapshot
func (h *WhiteboardHandler) snapshotStrokes(meetingID int64) {
	const triggerCount = 1100
	const keepRecentCount = 100

	var count int64
	// Count only active strokes
	h.db.Model(&model.WhiteboardStroke{}).Where("meeting_id = ? AND is_deleted = ?", meetingID, false).Count(&count)

	if count >= triggerCount {
		log.Printf("[Snapshot] Triggered for meeting %d. Count: %d", meetingID, count)

		// 1. Select oldest (Total - 100) strokes
		limit := int(count) - keepRecentCount
		if limit <= 0 {
			return
		}

		var strokes []model.WhiteboardStroke
		// Order by ID ASC (oldest first)
		if err := h.db.Where("meeting_id = ? AND is_deleted = ?", meetingID, false).
			Order("id ASC").
			Limit(limit).
			Find(&strokes).Error; err != nil {
			log.Printf("[Snapshot] Failed to select strokes: %v", err)
			return
		}

		if len(strokes) == 0 {
			return
		}

		// 2. Serialize stroke data
		var aggregatedData []json.RawMessage
		for _, s := range strokes {
			aggregatedData = append(aggregatedData, json.RawMessage(s.StrokeData))
		}

		jsonData, err := json.Marshal(aggregatedData)
		if err != nil {
			log.Printf("[Snapshot] Failed to marshal aggregated data: %v", err)
			return
		}

		// 3. Create Snapshot
		snapshot := model.WhiteboardSnapshot{
			MeetingID: meetingID,
			Data:      string(jsonData),
			StartID:   strokes[0].ID,
			EndID:     strokes[len(strokes)-1].ID,
		}

		tx := h.db.Begin()
		if err := tx.Create(&snapshot).Error; err != nil {
			tx.Rollback()
			log.Printf("[Snapshot] Failed to create snapshot: %v", err)
			return
		}

		// 4. Hard Delete processed strokes to keep table small as per user request ("Select lag")
		// Soft Delete would keep rows and slow down indexes/Selects over time.
		// Since data is safely in snapshot, we remove individual rows.
		if err := tx.Where("meeting_id = ? AND id <= ? AND is_deleted = ?", meetingID, snapshot.EndID, false).
			Delete(&model.WhiteboardStroke{}).Error; err != nil {
			tx.Rollback()
			log.Printf("[Snapshot] Failed to delete strokes: %v", err)
			return
		}

		tx.Commit()
		log.Printf("[Snapshot] Successfully created snapshot %d (Strokes %d-%d merged and deleted)", snapshot.ID, snapshot.StartID, snapshot.EndID)
	}
}

// HandleWhiteboard handles add, undo, redo, clear actions
func (h *WhiteboardHandler) HandleWhiteboard(c *fiber.Ctx) error {
	userID := int64(0)
	if val := c.Locals("userID"); val != nil {
		userID = val.(int64)
	}

	if userID == 0 {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}

	var req WhiteboardRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
	}

	if req.Room == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Room name is required"})
	}

	meetingID, err := h.getMeetingID(req.Room, userID)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Meeting not found"})
	history := []any{}
	if whiteboard.Data != nil {
		if err := json.Unmarshal([]byte(*whiteboard.Data), &history); err != nil {
			log.Printf("warning: failed to unmarshal whiteboard history: %v", err)
			history = []any{}
		}
	}

	redoStack := []any{}
	if whiteboard.RedoData != nil {
		if err := json.Unmarshal([]byte(*whiteboard.RedoData), &redoStack); err != nil {
			log.Printf("warning: failed to unmarshal whiteboard redo stack: %v", err)
			redoStack = []any{}
		}
	}

	switch req.Type {
	case "clear":
		// Hard Delete everything for this meeting
		log.Printf("[Whiteboard] User %d requesting CLEAR in meeting %d", userID, meetingID)
		if err := h.db.Where("meeting_id = ?", meetingID).Delete(&model.WhiteboardStroke{}).Error; err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to clear strokes"})
		}
		if err := h.db.Where("meeting_id = ?", meetingID).Delete(&model.WhiteboardSnapshot{}).Error; err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to clear snapshots"})
		}

	case "undo":
		// Undo only affects 'WhiteboardStroke' (Active). We cannot easily undo a snapshot stroke.
		var lastStroke model.WhiteboardStroke
		err := h.db.Where("meeting_id = ? AND is_deleted = ?", meetingID, false).Order("id DESC").First(&lastStroke).Error
		if err == nil {
			now := time.Now()
			// Mark as deleted
			h.db.Model(&lastStroke).Updates(map[string]interface{}{
				"is_deleted": true,
				"deleted_at": now,
			})
		}

	case "redo":
		// Redo finds the most recently deleted stroke
		var lastDeletedStroke model.WhiteboardStroke
		err := h.db.Where("meeting_id = ? AND is_deleted = ?", meetingID, true).Order("deleted_at DESC").First(&lastDeletedStroke).Error
		if err == nil {
			h.db.Model(&lastDeletedStroke).Updates(map[string]interface{}{
				"is_deleted": false,
				"deleted_at": gorm.Expr("NULL"),
			})
		}

	default: // "add"
		if req.Stroke != nil {
			// Clear Redo stack first
			h.db.Where("meeting_id = ? AND is_deleted = ?", meetingID, true).Delete(&model.WhiteboardStroke{})

			strokeBytes, err := json.Marshal(req.Stroke)
			if err != nil {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid stroke data"})
			}

			newStroke := model.WhiteboardStroke{
				MeetingID:  meetingID,
				UserID:     userID,
				StrokeData: string(strokeBytes),
				IsDeleted:  false,
			}

			if err := h.db.Create(&newStroke).Error; err != nil {
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to save stroke"})
			}

			// Check for Snapshot Trigger in background
			go h.snapshotStrokes(meetingID)
		}
	}

	// Calculate Undo/Redo state (Only for active non-snapshotted strokes)
	var undoCount int64
	h.db.Model(&model.WhiteboardStroke{}).Where("meeting_id = ? AND is_deleted = ?", meetingID, false).Count(&undoCount)
	var redoCount int64
	h.db.Model(&model.WhiteboardStroke{}).Where("meeting_id = ? AND is_deleted = ?", meetingID, true).Count(&redoCount)
	// Note: 'undoCount' here is only recent strokes. If usage is high, users can't undo beyond snapshot.
	// This fits the requirement "Keep recent 100 for Undo".

	return c.JSON(fiber.Map{
		"success": true,
		"canUndo": undoCount > 0,
		"canRedo": redoCount > 0,
	})
}

// Helper to get meeting ID from room name
func (h *WhiteboardHandler) getMeetingID(roomName string, userID int64) (int64, error) {
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
	// Example: "workspace-46-call-general"
	if strings.HasPrefix(roomName, "workspace-") && strings.Contains(roomName, "-call-") {
		// Try to find existing meeting by Code
		var meeting model.Meeting
		if err := h.db.Select("id").Where("code = ?", roomName).First(&meeting).Error; err == nil {
			return meeting.ID, nil
		}

		// If not found, LAZY CREATE it
		// Parse WorkspaceID
		parts := strings.Split(roomName, "-")
		if len(parts) >= 4 { // workspace, 46, call, general...
			// Extract ID coming after "workspace"
			// Format: workspace-{id}-...
			if wid, err := strconv.ParseInt(parts[1], 10, 64); err == nil {
				// Create a new persistent meeting for this channel
				newMeeting := model.Meeting{
					WorkspaceID: &wid,
					HostID:      userID,                       // The user triggering this becomes the 'creator' but it's a shared channel
					Title:       strings.Join(parts[3:], " "), // "general" or "standup"
					Code:        roomName,
					Type:        "WORKSPACE_CHANNEL", // Special type or just VIDEO
					Status:      "ALWAYS_OPEN",
				}

				// Handle case where UserID might be 0 (if auth failed but middleware didn't catch it?)
				// AuthMiddleware should ensure UserID is present.
				if newMeeting.HostID == 0 {
					// Fallback to finding Workspace Owner?
					// For now, if 0, we can't create.
					return 0, gorm.ErrRecordNotFound
				}

				if err := h.db.Create(&newMeeting).Error; err != nil {
					// Handle race condition: double creation
					// If creation fails (e.g. unique constraint on Code), try fetching again
					if err := h.db.Select("id").Where("code = ?", roomName).First(&meeting).Error; err == nil {
						return meeting.ID, nil
					}
					return 0, err
				}
				return newMeeting.ID, nil
			}
		}
	}

	// 4. Fallback: Try finding by Code (for any other custom codes)
	var meeting model.Meeting
	if err := h.db.Select("id").Where("code = ?", roomName).First(&meeting).Error; err != nil {
		return 0, err
	}
	return meeting.ID, nil
}
