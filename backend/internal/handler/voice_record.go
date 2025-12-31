package handler

import (
	"github.com/gofiber/fiber/v2"
	"gorm.io/gorm"

	"realtime-backend/internal/auth"
	"realtime-backend/internal/model"
)

// VoiceRecordHandler 음성 기록 핸들러
type VoiceRecordHandler struct {
	db *gorm.DB
}

// NewVoiceRecordHandler VoiceRecordHandler 생성
func NewVoiceRecordHandler(db *gorm.DB) *VoiceRecordHandler {
	return &VoiceRecordHandler{db: db}
}

// VoiceRecordResponse 음성 기록 응답
type VoiceRecordResponse struct {
	ID          int64         `json:"id"`
	MeetingID   int64         `json:"meeting_id"`
	SpeakerID   *int64        `json:"speaker_id,omitempty"`
	SpeakerName string        `json:"speaker_name"`
	Original    string        `json:"original"`
	Translated  *string       `json:"translated,omitempty"`
	TargetLang  *string       `json:"target_lang,omitempty"`
	CreatedAt   string        `json:"created_at"`
	Speaker     *UserResponse `json:"speaker,omitempty"`
}

// CreateVoiceRecordRequest 음성 기록 생성 요청
type CreateVoiceRecordRequest struct {
	SpeakerName string  `json:"speaker_name"`
	Original    string  `json:"original"`
	Translated  *string `json:"translated,omitempty"`
	TargetLang  *string `json:"target_lang,omitempty"`
}

// CreateVoiceRecordBulkRequest 음성 기록 일괄 생성 요청
type CreateVoiceRecordBulkRequest struct {
	Records []CreateVoiceRecordRequest `json:"records"`
}

// GetVoiceRecords 미팅의 음성 기록 조회
func (h *VoiceRecordHandler) GetVoiceRecords(c *fiber.Ctx) error {
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

	// 미팅이 워크스페이스에 속하는지 확인
	var meeting model.Meeting
	if err := h.db.Where("id = ? AND workspace_id = ?", meetingID, workspaceID).First(&meeting).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "meeting not found",
		})
	}

	// 음성 기록 조회
	var records []model.VoiceRecord
	limit := c.QueryInt("limit", 100)
	offset := c.QueryInt("offset", 0)

	err = h.db.
		Where("meeting_id = ?", meetingID).
		Preload("Speaker").
		Order("created_at ASC").
		Limit(limit).
		Offset(offset).
		Find(&records).Error

	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to get voice records",
		})
	}

	// 응답 변환
	responses := make([]VoiceRecordResponse, len(records))
	for i, record := range records {
		responses[i] = h.toVoiceRecordResponse(&record)
	}

	// 전체 개수 조회
	var total int64
	h.db.Model(&model.VoiceRecord{}).Where("meeting_id = ?", meetingID).Count(&total)

	return c.JSON(fiber.Map{
		"meeting_id": meetingID,
		"records":    responses,
		"total":      total,
		"limit":      limit,
		"offset":     offset,
	})
}

// CreateVoiceRecord 음성 기록 생성 (단일)
func (h *VoiceRecordHandler) CreateVoiceRecord(c *fiber.Ctx) error {
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

	// 미팅 확인
	var meeting model.Meeting
	if err := h.db.Where("id = ? AND workspace_id = ?", meetingID, workspaceID).First(&meeting).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "meeting not found",
		})
	}

	var req CreateVoiceRecordRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid request body",
		})
	}

	if req.Original == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "original text is required",
		})
	}

	// 텍스트 정제 및 길이 제한
	req.Original = sanitizeString(req.Original)
	if len(req.Original) > 5000 {
		req.Original = req.Original[:5000]
	}

	if req.SpeakerName == "" {
		req.SpeakerName = "Unknown"
	}
	req.SpeakerName = sanitizeString(req.SpeakerName)
	if len(req.SpeakerName) > 100 {
		req.SpeakerName = req.SpeakerName[:100]
	}

	// 음성 기록 생성
	record := model.VoiceRecord{
		MeetingID:   int64(meetingID),
		SpeakerID:   &claims.UserID,
		SpeakerName: req.SpeakerName,
		Original:    req.Original,
		Translated:  req.Translated,
		TargetLang:  req.TargetLang,
	}

	if err := h.db.Create(&record).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to create voice record",
		})
	}

	// Speaker 정보 로드
	h.db.Preload("Speaker").First(&record, record.ID)

	return c.Status(fiber.StatusCreated).JSON(h.toVoiceRecordResponse(&record))
}

// CreateVoiceRecordBulk 음성 기록 일괄 생성
func (h *VoiceRecordHandler) CreateVoiceRecordBulk(c *fiber.Ctx) error {
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

	// 미팅 확인
	var meeting model.Meeting
	if err := h.db.Where("id = ? AND workspace_id = ?", meetingID, workspaceID).First(&meeting).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "meeting not found",
		})
	}

	var req CreateVoiceRecordBulkRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid request body",
		})
	}

	if len(req.Records) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "records array is required",
		})
	}

	if len(req.Records) > 100 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "maximum 100 records per request",
		})
	}

	// 음성 기록 생성
	records := make([]model.VoiceRecord, len(req.Records))
	for i, r := range req.Records {
		original := sanitizeString(r.Original)
		if len(original) > 5000 {
			original = original[:5000]
		}

		speakerName := r.SpeakerName
		if speakerName == "" {
			speakerName = "Unknown"
		}
		speakerName = sanitizeString(speakerName)
		if len(speakerName) > 100 {
			speakerName = speakerName[:100]
		}

		records[i] = model.VoiceRecord{
			MeetingID:   int64(meetingID),
			SpeakerName: speakerName,
			Original:    original,
			Translated:  r.Translated,
			TargetLang:  r.TargetLang,
		}
	}

	if err := h.db.Create(&records).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to create voice records",
		})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"message": "voice records created successfully",
		"count":   len(records),
	})
}

// DeleteVoiceRecords 미팅의 음성 기록 전체 삭제
func (h *VoiceRecordHandler) DeleteVoiceRecords(c *fiber.Ctx) error {
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

	// 미팅 확인
	var meeting model.Meeting
	if err := h.db.Where("id = ? AND workspace_id = ?", meetingID, workspaceID).First(&meeting).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "meeting not found",
		})
	}

	// 음성 기록 삭제
	result := h.db.Where("meeting_id = ?", meetingID).Delete(&model.VoiceRecord{})
	if result.Error != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to delete voice records",
		})
	}

	return c.JSON(fiber.Map{
		"message": "voice records deleted successfully",
		"count":   result.RowsAffected,
	})
}

// 헬퍼 함수
func (h *VoiceRecordHandler) isWorkspaceMember(workspaceID, userID int64) bool {
	var count int64
	h.db.Model(&model.WorkspaceMember{}).
		Where("workspace_id = ? AND user_id = ? AND status = ?", workspaceID, userID, model.MemberStatusActive.String()).
		Count(&count)
	return count > 0
}

func (h *VoiceRecordHandler) toVoiceRecordResponse(record *model.VoiceRecord) VoiceRecordResponse {
	resp := VoiceRecordResponse{
		ID:          record.ID,
		MeetingID:   record.MeetingID,
		SpeakerID:   record.SpeakerID,
		SpeakerName: record.SpeakerName,
		Original:    record.Original,
		Translated:  record.Translated,
		TargetLang:  record.TargetLang,
		CreatedAt:   record.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
	}

	if record.Speaker != nil && record.Speaker.ID != 0 {
		resp.Speaker = &UserResponse{
			ID:         record.Speaker.ID,
			Email:      record.Speaker.Email,
			Nickname:   record.Speaker.Nickname,
			ProfileImg: record.Speaker.ProfileImg,
		}
	}

	return resp
}
