package handler

import (
	"time"

	"github.com/gofiber/fiber/v2"
	"gorm.io/gorm"

	"realtime-backend/internal/auth"
	"realtime-backend/internal/model"
)

// CalendarHandler 캘린더 핸들러
type CalendarHandler struct {
	db *gorm.DB
}

// NewCalendarHandler CalendarHandler 생성
func NewCalendarHandler(db *gorm.DB) *CalendarHandler {
	return &CalendarHandler{db: db}
}

// CalendarEventResponse 캘린더 이벤트 응답
type CalendarEventResponse struct {
	ID              int64              `json:"id"`
	WorkspaceID     int64              `json:"workspace_id"`
	CreatorID       *int64             `json:"creator_id,omitempty"`
	Title           string             `json:"title"`
	Description     *string            `json:"description,omitempty"`
	StartAt         string             `json:"start_at"`
	EndAt           string             `json:"end_at"`
	IsAllDay        bool               `json:"is_all_day"`
	LinkedMeetingID *int64             `json:"linked_meeting_id,omitempty"`
	Color           *string            `json:"color,omitempty"`
	CreatedAt       string             `json:"created_at"`
	Creator         *UserResponse      `json:"creator,omitempty"`
	Attendees       []AttendeeResponse `json:"attendees,omitempty"`
}

// AttendeeResponse 참석자 응답
type AttendeeResponse struct {
	UserID    int64         `json:"user_id"`
	Status    string        `json:"status"`
	CreatedAt string        `json:"created_at"`
	User      *UserResponse `json:"user,omitempty"`
}

// CreateEventRequest 이벤트 생성 요청
type CreateEventRequest struct {
	Title       string   `json:"title"`
	Description *string  `json:"description,omitempty"`
	StartAt     string   `json:"start_at"`
	EndAt       string   `json:"end_at"`
	IsAllDay    bool     `json:"is_all_day"`
	Color       *string  `json:"color,omitempty"`
	AttendeeIDs []int64  `json:"attendee_ids,omitempty"`
}

// GetWorkspaceEvents 워크스페이스 이벤트 목록
func (h *CalendarHandler) GetWorkspaceEvents(c *fiber.Ctx) error {
	claims := c.Locals("claims").(*auth.Claims)
	workspaceID, err := c.ParamsInt("workspaceId")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid workspace id",
		})
	}

	// 멤버 확인
	if !h.isWorkspaceMember(int64(workspaceID), claims.UserID) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "you are not a member of this workspace",
		})
	}

	// 기간 필터
	startDate := c.Query("start_date")
	endDate := c.Query("end_date")

	query := h.db.Where("workspace_id = ?", workspaceID)

	if startDate != "" {
		if t, err := time.Parse("2006-01-02", startDate); err == nil {
			query = query.Where("end_at >= ?", t)
		}
	}
	if endDate != "" {
		if t, err := time.Parse("2006-01-02", endDate); err == nil {
			query = query.Where("start_at <= ?", t.Add(24*time.Hour))
		}
	}

	var events []model.CalendarEvent
	err = query.
		Preload("Creator").
		Preload("Attendees.User").
		Order("start_at ASC").
		Find(&events).Error

	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to get events",
		})
	}

	responses := make([]CalendarEventResponse, len(events))
	for i, e := range events {
		responses[i] = h.toEventResponse(&e)
	}

	return c.JSON(fiber.Map{
		"events": responses,
		"total":  len(responses),
	})
}

// CreateEvent 이벤트 생성
func (h *CalendarHandler) CreateEvent(c *fiber.Ctx) error {
	claims := c.Locals("claims").(*auth.Claims)
	workspaceID, err := c.ParamsInt("workspaceId")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid workspace id",
		})
	}

	// 멤버 확인
	if !h.isWorkspaceMember(int64(workspaceID), claims.UserID) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "you are not a member of this workspace",
		})
	}

	var req CreateEventRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid request body",
		})
	}

	if req.Title == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "title is required",
		})
	}

	// 시간 파싱
	startAt, err := time.Parse(time.RFC3339, req.StartAt)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid start_at format",
		})
	}

	endAt, err := time.Parse(time.RFC3339, req.EndAt)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid end_at format",
		})
	}

	if endAt.Before(startAt) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "end_at must be after start_at",
		})
	}

	req.Title = sanitizeString(req.Title)
	if len(req.Title) > 255 {
		req.Title = req.Title[:255]
	}

	wsID := int64(workspaceID)
	event := model.CalendarEvent{
		WorkspaceID: wsID,
		CreatorID:   &claims.UserID,
		Title:       req.Title,
		Description: req.Description,
		StartAt:     startAt,
		EndAt:       endAt,
		IsAllDay:    req.IsAllDay,
		Color:       req.Color,
	}

	err = h.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&event).Error; err != nil {
			return err
		}

		// 참석자 추가
		for _, userID := range req.AttendeeIDs {
			// 사용자 존재 및 멤버 확인
			if !h.isWorkspaceMember(wsID, userID) {
				continue
			}

			attendee := model.EventAttendee{
				EventID: event.ID,
				UserID:  userID,
				Status:  "PENDING",
			}
			if err := tx.Create(&attendee).Error; err != nil {
				return err
			}
		}

		return nil
	})

	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to create event",
		})
	}

	// 전체 정보 로드
	h.db.Preload("Creator").Preload("Attendees.User").First(&event, event.ID)

	return c.Status(fiber.StatusCreated).JSON(h.toEventResponse(&event))
}

// UpdateEvent 이벤트 수정
func (h *CalendarHandler) UpdateEvent(c *fiber.Ctx) error {
	claims := c.Locals("claims").(*auth.Claims)
	workspaceID, err := c.ParamsInt("workspaceId")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid workspace id",
		})
	}
	eventID, err := c.ParamsInt("eventId")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid event id",
		})
	}

	var event model.CalendarEvent
	err = h.db.Where("id = ? AND workspace_id = ?", eventID, workspaceID).First(&event).Error
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "event not found",
		})
	}

	// 생성자만 수정 가능
	if event.CreatorID == nil || *event.CreatorID != claims.UserID {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "only creator can update the event",
		})
	}

	var req CreateEventRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid request body",
		})
	}

	if req.Title != "" {
		event.Title = sanitizeString(req.Title)
	}
	if req.Description != nil {
		event.Description = req.Description
	}
	if req.StartAt != "" {
		if t, err := time.Parse(time.RFC3339, req.StartAt); err == nil {
			event.StartAt = t
		}
	}
	if req.EndAt != "" {
		if t, err := time.Parse(time.RFC3339, req.EndAt); err == nil {
			event.EndAt = t
		}
	}
	event.IsAllDay = req.IsAllDay
	event.Color = req.Color

	if err := h.db.Save(&event).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to update event",
		})
	}
	h.db.Preload("Creator").Preload("Attendees.User").First(&event, event.ID)

	return c.JSON(h.toEventResponse(&event))
}

// DeleteEvent 이벤트 삭제
func (h *CalendarHandler) DeleteEvent(c *fiber.Ctx) error {
	claims := c.Locals("claims").(*auth.Claims)
	workspaceID, err := c.ParamsInt("workspaceId")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid workspace id",
		})
	}
	eventID, err := c.ParamsInt("eventId")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid event id",
		})
	}

	var event model.CalendarEvent
	err = h.db.Where("id = ? AND workspace_id = ?", eventID, workspaceID).First(&event).Error
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "event not found",
		})
	}

	// 생성자만 삭제 가능
	if event.CreatorID == nil || *event.CreatorID != claims.UserID {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "only creator can delete the event",
		})
	}

	// 참석자 먼저 삭제
	h.db.Where("event_id = ?", eventID).Delete(&model.EventAttendee{})
	h.db.Delete(&event)

	return c.JSON(fiber.Map{
		"message": "event deleted",
	})
}

// UpdateAttendeeStatus 참석 상태 변경
func (h *CalendarHandler) UpdateAttendeeStatus(c *fiber.Ctx) error {
	claims := c.Locals("claims").(*auth.Claims)
	workspaceID, err := c.ParamsInt("workspaceId")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid workspace id",
		})
	}
	eventID, err := c.ParamsInt("eventId")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid event id",
		})
	}

	// 멤버 확인
	if !h.isWorkspaceMember(int64(workspaceID), claims.UserID) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "you are not a member of this workspace",
		})
	}

	var req struct {
		Status string `json:"status"` // PENDING, ACCEPTED, DECLINED
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid request body",
		})
	}

	if req.Status != "PENDING" && req.Status != "ACCEPTED" && req.Status != "DECLINED" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid status",
		})
	}

	var attendee model.EventAttendee
	err = h.db.Where("event_id = ? AND user_id = ?", eventID, claims.UserID).First(&attendee).Error
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "you are not an attendee of this event",
		})
	}

	attendee.Status = req.Status
	if err := h.db.Save(&attendee).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to update attendee status",
		})
	}

	return c.JSON(fiber.Map{
		"message": "status updated",
		"status":  req.Status,
	})
}

// 헬퍼 함수
func (h *CalendarHandler) isWorkspaceMember(workspaceID, userID int64) bool {
	var count int64
	h.db.Model(&model.WorkspaceMember{}).
		Where("workspace_id = ? AND user_id = ? AND status = ?", workspaceID, userID, model.MemberStatusActive.String()).
		Count(&count)
	return count > 0
}

func (h *CalendarHandler) toEventResponse(e *model.CalendarEvent) CalendarEventResponse {
	resp := CalendarEventResponse{
		ID:          e.ID,
		WorkspaceID: e.WorkspaceID,
		CreatorID:   e.CreatorID,
		Title:       e.Title,
		Description: e.Description,
		StartAt:     e.StartAt.Format(time.RFC3339),
		EndAt:       e.EndAt.Format(time.RFC3339),
		IsAllDay:    e.IsAllDay,
		Color:       e.Color,
		CreatedAt:   e.CreatedAt.Format(time.RFC3339),
	}

	if e.LinkedMeetingID != nil {
		resp.LinkedMeetingID = e.LinkedMeetingID
	}

	if e.Creator != nil && e.Creator.ID != 0 {
		resp.Creator = &UserResponse{
			ID:         e.Creator.ID,
			Email:      e.Creator.Email,
			Nickname:   e.Creator.Nickname,
			ProfileImg: e.Creator.ProfileImg,
		}
	}

	if len(e.Attendees) > 0 {
		resp.Attendees = make([]AttendeeResponse, len(e.Attendees))
		for i, a := range e.Attendees {
			resp.Attendees[i] = AttendeeResponse{
				UserID:    a.UserID,
				Status:    a.Status,
				CreatedAt: a.CreatedAt.Format(time.RFC3339),
			}
			if a.User.ID != 0 {
				resp.Attendees[i].User = &UserResponse{
					ID:         a.User.ID,
					Email:      a.User.Email,
					Nickname:   a.User.Nickname,
					ProfileImg: a.User.ProfileImg,
				}
			}
		}
	}

	return resp
}
