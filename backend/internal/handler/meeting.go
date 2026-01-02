package handler

import (
	"crypto/rand"
	"encoding/hex"
	"log"
	"time"

	"github.com/gofiber/fiber/v2"
	"gorm.io/gorm"

	"realtime-backend/internal/auth"
	"realtime-backend/internal/model"
)

// MeetingHandler 미팅 핸들러
type MeetingHandler struct {
	db *gorm.DB
}

// NewMeetingHandler MeetingHandler 생성
func NewMeetingHandler(db *gorm.DB) *MeetingHandler {
	return &MeetingHandler{db: db}
}

// MeetingResponse 미팅 응답
type MeetingResponse struct {
	ID           int64                 `json:"id"`
	WorkspaceID  *int64                `json:"workspace_id,omitempty"`
	HostID       int64                 `json:"host_id"`
	Title        string                `json:"title"`
	Code         string                `json:"code"`
	Type         string                `json:"type"`
	Status       string                `json:"status"`
	StartedAt    *string               `json:"started_at,omitempty"`
	EndedAt      *string               `json:"ended_at,omitempty"`
	Host         *UserResponse         `json:"host,omitempty"`
	Participants []ParticipantResponse `json:"participants,omitempty"`
}

// ParticipantResponse 참가자 응답
type ParticipantResponse struct {
	ID       int64         `json:"id"`
	UserID   *int64        `json:"user_id,omitempty"`
	Role     string        `json:"role"`
	JoinedAt string        `json:"joined_at"`
	LeftAt   *string       `json:"left_at,omitempty"`
	User     *UserResponse `json:"user,omitempty"`
}

// CreateMeetingRequest 미팅 생성 요청
type CreateMeetingRequest struct {
	Title string `json:"title"`
	Type  string `json:"type"` // VIDEO, VOICE_ONLY
}

// GetWorkspaceMeetings 워크스페이스 미팅 목록
func (h *MeetingHandler) GetWorkspaceMeetings(c *fiber.Ctx) error {
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

	var meetings []model.Meeting
	err = h.db.
		Where("workspace_id = ? AND type != ?", workspaceID, "WORKSPACE_CHAT").
		Preload("Host").
		Preload("Participants.User").
		Order("id DESC").
		Find(&meetings).Error

	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to get meetings",
		})
	}

	responses := make([]MeetingResponse, len(meetings))
	for i, m := range meetings {
		responses[i] = h.toMeetingResponse(&m)
	}

	return c.JSON(fiber.Map{
		"meetings": responses,
		"total":    len(responses),
	})
}

// CreateMeeting 미팅 생성
func (h *MeetingHandler) CreateMeeting(c *fiber.Ctx) error {
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

	var req CreateMeetingRequest
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

	req.Title = sanitizeString(req.Title)
	if len(req.Title) > 200 {
		req.Title = req.Title[:200]
	}

	if req.Type == "" {
		req.Type = "VIDEO"
	}

	// 미팅 코드 생성
	code, err := generateSecureMeetingCode()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to generate meeting code",
		})
	}

	wsID := int64(workspaceID)
	meeting := model.Meeting{
		WorkspaceID: &wsID,
		HostID:      claims.UserID,
		Title:       req.Title,
		Code:        code,
		Type:        req.Type,
		Status:      "SCHEDULED",
	}

	if err := h.db.Create(&meeting).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to create meeting",
		})
	}

	// 호스트를 참가자로 추가
	participant := model.Participant{
		MeetingID: meeting.ID,
		UserID:    &claims.UserID,
		Role:      "HOST",
	}
	if err := h.db.Create(&participant).Error; err != nil {
		log.Printf("warning: failed to add host as participant for meeting %d: %v", meeting.ID, err)
	}

	// 전체 정보 로드
	h.db.Preload("Host").Preload("Participants.User").First(&meeting, meeting.ID)

	return c.Status(fiber.StatusCreated).JSON(h.toMeetingResponse(&meeting))
}

// GetMeeting 미팅 상세 조회
func (h *MeetingHandler) GetMeeting(c *fiber.Ctx) error {
	claims := c.Locals("claims").(*auth.Claims)
	workspaceID, err := c.ParamsInt("workspaceId")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid workspace id",
		})
	}
	meetingID, err := c.ParamsInt("meetingId")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid meeting id",
		})
	}

	// 멤버 확인
	if !h.isWorkspaceMember(int64(workspaceID), claims.UserID) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "you are not a member of this workspace",
		})
	}

	var meeting model.Meeting
	err = h.db.
		Where("id = ? AND workspace_id = ?", meetingID, workspaceID).
		Preload("Host").
		Preload("Participants.User").
		First(&meeting).Error

	if err == gorm.ErrRecordNotFound {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "meeting not found",
		})
	}
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to get meeting",
		})
	}

	return c.JSON(h.toMeetingResponse(&meeting))
}

// StartMeeting 미팅 시작
func (h *MeetingHandler) StartMeeting(c *fiber.Ctx) error {
	claims := c.Locals("claims").(*auth.Claims)
	workspaceID, err := c.ParamsInt("workspaceId")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid workspace id",
		})
	}
	meetingID, err := c.ParamsInt("meetingId")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid meeting id",
		})
	}

	var meeting model.Meeting
	err = h.db.Where("id = ? AND workspace_id = ?", meetingID, workspaceID).First(&meeting).Error
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "meeting not found",
		})
	}

	// 호스트만 시작 가능
	if meeting.HostID != claims.UserID {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "only host can start the meeting",
		})
	}

	now := time.Now()
	meeting.Status = "IN_PROGRESS"
	meeting.StartedAt = &now
	if err := h.db.Save(&meeting).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to start meeting",
		})
	}

	h.db.Preload("Host").Preload("Participants.User").First(&meeting, meeting.ID)

	return c.JSON(h.toMeetingResponse(&meeting))
}

// EndMeeting 미팅 종료
func (h *MeetingHandler) EndMeeting(c *fiber.Ctx) error {
	claims := c.Locals("claims").(*auth.Claims)
	workspaceID, err := c.ParamsInt("workspaceId")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid workspace id",
		})
	}
	meetingID, err := c.ParamsInt("meetingId")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid meeting id",
		})
	}

	var meeting model.Meeting
	err = h.db.Where("id = ? AND workspace_id = ?", meetingID, workspaceID).First(&meeting).Error
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "meeting not found",
		})
	}

	// 호스트만 종료 가능
	if meeting.HostID != claims.UserID {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "only host can end the meeting",
		})
	}

	now := time.Now()
	meeting.Status = "ENDED"
	meeting.EndedAt = &now
	if err := h.db.Save(&meeting).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to end meeting",
		})
	}

	return c.JSON(fiber.Map{
		"message": "meeting ended",
	})
}

// 헬퍼 함수
func (h *MeetingHandler) isWorkspaceMember(workspaceID, userID int64) bool {
	var count int64
	h.db.Model(&model.WorkspaceMember{}).
		Where("workspace_id = ? AND user_id = ? AND status = ?", workspaceID, userID, model.MemberStatusActive.String()).
		Count(&count)
	return count > 0
}

func (h *MeetingHandler) toMeetingResponse(m *model.Meeting) MeetingResponse {
	resp := MeetingResponse{
		ID:     m.ID,
		HostID: m.HostID,
		Title:  m.Title,
		Code:   m.Code,
		Type:   m.Type,
		Status: m.Status,
	}

	if m.WorkspaceID != nil {
		resp.WorkspaceID = m.WorkspaceID
	}

	if m.StartedAt != nil {
		t := m.StartedAt.Format("2006-01-02T15:04:05Z07:00")
		resp.StartedAt = &t
	}

	if m.EndedAt != nil {
		t := m.EndedAt.Format("2006-01-02T15:04:05Z07:00")
		resp.EndedAt = &t
	}

	if m.Host.ID != 0 {
		resp.Host = &UserResponse{
			ID:         m.Host.ID,
			Email:      m.Host.Email,
			Nickname:   m.Host.Nickname,
			ProfileImg: m.Host.ProfileImg,
		}
	}

	if len(m.Participants) > 0 {
		resp.Participants = make([]ParticipantResponse, len(m.Participants))
		for i, p := range m.Participants {
			resp.Participants[i] = ParticipantResponse{
				ID:       p.ID,
				UserID:   p.UserID,
				Role:     p.Role,
				JoinedAt: p.JoinedAt.Format("2006-01-02T15:04:05Z07:00"),
			}
			if p.LeftAt != nil {
				t := p.LeftAt.Format("2006-01-02T15:04:05Z07:00")
				resp.Participants[i].LeftAt = &t
			}
			if p.User != nil && p.User.ID != 0 {
				resp.Participants[i].User = &UserResponse{
					ID:         p.User.ID,
					Email:      p.User.Email,
					Nickname:   p.User.Nickname,
					ProfileImg: p.User.ProfileImg,
				}
			}
		}
	}

	return resp
}

func generateSecureMeetingCode() (string, error) {
	bytes := make([]byte, 6)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}
