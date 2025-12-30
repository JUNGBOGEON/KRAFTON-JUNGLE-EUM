package handler

import (
	"strings"

	"github.com/gofiber/fiber/v2"
	"gorm.io/gorm"

	"realtime-backend/internal/auth"
	"realtime-backend/internal/model"
	"realtime-backend/internal/storage"
)

type StorageHandler struct {
	db *gorm.DB
	s3 *storage.S3Service
}

// NewStorageHandler StorageHandler 생성
func NewStorageHandler(db *gorm.DB, s3 *storage.S3Service) *StorageHandler {
	return &StorageHandler{db: db, s3: s3}
}

// FileResponse 파일/폴더 응답
type FileResponse struct {
	ID               int64          `json:"id"`
	WorkspaceID      int64          `json:"workspace_id"`
	UploaderID       *int64         `json:"uploader_id,omitempty"`
	ParentFolderID   *int64         `json:"parent_folder_id,omitempty"`
	Name             string         `json:"name"`
	Type             string         `json:"type"` // FILE, FOLDER
	FileURL          *string        `json:"file_url,omitempty"`
	FileSize         *int64         `json:"file_size,omitempty"`
	MimeType         *string        `json:"mime_type,omitempty"`
	S3Key            *string        `json:"s3_key,omitempty"`
	RelatedMeetingID *int64         `json:"related_meeting_id,omitempty"`
	CreatedAt        string         `json:"created_at"`
	Uploader         *UserResponse  `json:"uploader,omitempty"`
	Children         []FileResponse `json:"children,omitempty"`
}

// CreateFolderRequest 폴더 생성 요청
type CreateFolderRequest struct {
	Name           string `json:"name"`
	ParentFolderID *int64 `json:"parent_folder_id,omitempty"`
}

// GetPresignedURLRequest Presigned URL 요청
type GetPresignedURLRequest struct {
	FileName       string `json:"file_name"`
	ContentType    string `json:"content_type"`
	ParentFolderID *int64 `json:"parent_folder_id,omitempty"`
}

// GetPresignedURL 파일 업로드용 Presigned URL 생성
func (h *StorageHandler) GetPresignedURL(c *fiber.Ctx) error {
	if h.s3 == nil {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
			"error": "S3 service is not configured",
		})
	}

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

	var req GetPresignedURLRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid request body",
		})
	}

	if req.FileName == "" || req.ContentType == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "file_name and content_type are required",
		})
	}

	// Presigned URL 생성
	presigned, err := h.s3.GenerateUploadURL(int64(workspaceID), req.FileName, req.ContentType)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to generate presigned URL",
		})
	}

	return c.JSON(fiber.Map{
		"upload_url":       presigned.URL,
		"key":              presigned.Key,
		"expires_at":       presigned.ExpiresAt,
		"parent_folder_id": req.ParentFolderID,
	})
}

// ConfirmUpload 업로드 완료 확인 및 DB 저장
func (h *StorageHandler) ConfirmUpload(c *fiber.Ctx) error {
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

	var req struct {
		Name           string `json:"name"`
		Key            string `json:"key"`
		FileSize       int64  `json:"file_size"`
		MimeType       string `json:"mime_type"`
		ParentFolderID *int64 `json:"parent_folder_id,omitempty"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid request body",
		})
	}

	if req.Name == "" || req.Key == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "name and key are required",
		})
	}

	req.Name = sanitizeString(req.Name)

	// 부모 폴더 확인
	if req.ParentFolderID != nil {
		var parent model.WorkspaceFile
		err := h.db.Where("id = ? AND workspace_id = ? AND type = ?", *req.ParentFolderID, workspaceID, "FOLDER").First(&parent).Error
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "parent folder not found",
			})
		}
	}

	// S3 URL 생성
	fileURL := h.s3.GetPublicURL(req.Key)

	file := model.WorkspaceFile{
		WorkspaceID:    int64(workspaceID),
		UploaderID:     &claims.UserID,
		ParentFolderID: req.ParentFolderID,
		Name:           req.Name,
		Type:           "FILE",
		FileURL:        &fileURL,
		FileSize:       &req.FileSize,
		MimeType:       &req.MimeType,
		S3Key:          &req.Key,
	}

	if err := h.db.Create(&file).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to save file metadata",
		})
	}

	h.db.Preload("Uploader").First(&file, file.ID)

	return c.Status(fiber.StatusCreated).JSON(h.toFileResponse(&file))
}

// GetWorkspaceFiles 워크스페이스 파일 목록
func (h *StorageHandler) GetWorkspaceFiles(c *fiber.Ctx) error {
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

	// 부모 폴더 ID (없으면 루트)
	parentFolderID := c.QueryInt("parent_folder_id", 0)

	var files []model.WorkspaceFile
	query := h.db.Where("workspace_id = ?", workspaceID)

	if parentFolderID > 0 {
		query = query.Where("parent_folder_id = ?", parentFolderID)
	} else {
		query = query.Where("parent_folder_id IS NULL")
	}

	err = query.
		Preload("Uploader").
		Order("type ASC, name ASC"). // 폴더 먼저, 이름순
		Find(&files).Error

	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to get files",
		})
	}

	responses := make([]FileResponse, len(files))
	for i, f := range files {
		responses[i] = h.toFileResponse(&f)
	}

	// 현재 경로 정보
	var breadcrumbs []FileResponse
	if parentFolderID > 0 {
		breadcrumbs = h.getBreadcrumbs(int64(parentFolderID))
	}

	return c.JSON(fiber.Map{
		"files":       responses,
		"total":       len(responses),
		"breadcrumbs": breadcrumbs,
	})
}

// CreateFolder 폴더 생성
func (h *StorageHandler) CreateFolder(c *fiber.Ctx) error {
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

	var req CreateFolderRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid request body",
		})
	}

	if req.Name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "name is required",
		})
	}

	req.Name = sanitizeString(req.Name)
	if len(req.Name) > 255 {
		req.Name = req.Name[:255]
	}

	// 부모 폴더 확인
	if req.ParentFolderID != nil {
		var parent model.WorkspaceFile
		err := h.db.Where("id = ? AND workspace_id = ? AND type = ?", *req.ParentFolderID, workspaceID, "FOLDER").First(&parent).Error
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "parent folder not found",
			})
		}
	}

	// 같은 위치에 같은 이름의 폴더가 있는지 확인
	var existing model.WorkspaceFile
	query := h.db.Where("workspace_id = ? AND name = ? AND type = ?", workspaceID, req.Name, "FOLDER")
	if req.ParentFolderID != nil {
		query = query.Where("parent_folder_id = ?", *req.ParentFolderID)
	} else {
		query = query.Where("parent_folder_id IS NULL")
	}
	if err := query.First(&existing).Error; err == nil {
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{
			"error": "folder with same name already exists",
		})
	}

	folder := model.WorkspaceFile{
		WorkspaceID:    int64(workspaceID),
		UploaderID:     &claims.UserID,
		ParentFolderID: req.ParentFolderID,
		Name:           req.Name,
		Type:           "FOLDER",
	}

	if err := h.db.Create(&folder).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to create folder",
		})
	}

	h.db.Preload("Uploader").First(&folder, folder.ID)

	return c.Status(fiber.StatusCreated).JSON(h.toFileResponse(&folder))
}

// UploadFile 파일 업로드 (메타데이터만 저장 - 레거시 지원)
func (h *StorageHandler) UploadFile(c *fiber.Ctx) error {
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

	var req struct {
		Name           string `json:"name"`
		ParentFolderID *int64 `json:"parent_folder_id,omitempty"`
		FileURL        string `json:"file_url"`
		FileSize       int64  `json:"file_size"`
		MimeType       string `json:"mime_type"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid request body",
		})
	}

	if req.Name == "" || req.FileURL == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "name and file_url are required",
		})
	}

	req.Name = sanitizeString(req.Name)

	file := model.WorkspaceFile{
		WorkspaceID:    int64(workspaceID),
		UploaderID:     &claims.UserID,
		ParentFolderID: req.ParentFolderID,
		Name:           req.Name,
		Type:           "FILE",
		FileURL:        &req.FileURL,
		FileSize:       &req.FileSize,
		MimeType:       &req.MimeType,
	}

	if err := h.db.Create(&file).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to save file metadata",
		})
	}

	h.db.Preload("Uploader").First(&file, file.ID)

	return c.Status(fiber.StatusCreated).JSON(h.toFileResponse(&file))
}

// DeleteFile 파일/폴더 삭제
func (h *StorageHandler) DeleteFile(c *fiber.Ctx) error {
	claims := c.Locals("claims").(*auth.Claims)
	workspaceID, err := c.ParamsInt("workspaceId")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid workspace id",
		})
	}
	fileID, err := c.ParamsInt("fileId")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid file id",
		})
	}

	// 멤버 확인
	if !h.isWorkspaceMember(int64(workspaceID), claims.UserID) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "you are not a member of this workspace",
		})
	}

	var file model.WorkspaceFile
	err = h.db.Where("id = ? AND workspace_id = ?", fileID, workspaceID).First(&file).Error
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "file not found",
		})
	}

	// 업로더만 삭제 가능 (또는 워크스페이스 소유자)
	var workspace model.Workspace
	h.db.First(&workspace, workspaceID)

	if file.UploaderID == nil || (*file.UploaderID != claims.UserID && workspace.OwnerID != claims.UserID) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "you don't have permission to delete this file",
		})
	}

	// 트랜잭션으로 DB 삭제 (S3 삭제는 별도 처리)
	var s3KeysToDelete []string

	err = h.db.Transaction(func(tx *gorm.DB) error {
		// 폴더인 경우 하위 항목도 삭제
		if file.Type == "FOLDER" {
			h.deleteRecursiveWithTx(tx, file.ID, &s3KeysToDelete)
		}

		// S3 키 수집
		if file.S3Key != nil && *file.S3Key != "" {
			s3KeysToDelete = append(s3KeysToDelete, *file.S3Key)
		}

		return tx.Delete(&file).Error
	})

	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to delete file",
		})
	}

	// DB 삭제 성공 후 S3 파일 삭제 (실패해도 무시)
	if h.s3 != nil {
		for _, key := range s3KeysToDelete {
			h.s3.DeleteFile(key)
		}
	}

	return c.JSON(fiber.Map{
		"message": "file deleted",
	})
}

// RenameFile 파일/폴더 이름 변경
func (h *StorageHandler) RenameFile(c *fiber.Ctx) error {
	claims := c.Locals("claims").(*auth.Claims)
	workspaceID, err := c.ParamsInt("workspaceId")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid workspace id",
		})
	}
	fileID, err := c.ParamsInt("fileId")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid file id",
		})
	}

	// 멤버 확인
	if !h.isWorkspaceMember(int64(workspaceID), claims.UserID) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "you are not a member of this workspace",
		})
	}

	var file model.WorkspaceFile
	err = h.db.Where("id = ? AND workspace_id = ?", fileID, workspaceID).First(&file).Error
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "file not found",
		})
	}

	var req struct {
		Name string `json:"name"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid request body",
		})
	}

	if req.Name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "name is required",
		})
	}

	file.Name = sanitizeString(req.Name)
	h.db.Save(&file)
	h.db.Preload("Uploader").First(&file, file.ID)

	return c.JSON(h.toFileResponse(&file))
}

// GetDownloadURL 파일 다운로드 URL 생성
func (h *StorageHandler) GetDownloadURL(c *fiber.Ctx) error {
	if h.s3 == nil {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
			"error": "S3 service is not configured",
		})
	}

	claims := c.Locals("claims").(*auth.Claims)
	workspaceID, err := c.ParamsInt("workspaceId")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid workspace id",
		})
	}
	fileID, err := c.ParamsInt("fileId")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid file id",
		})
	}

	// 멤버 확인
	if !h.isWorkspaceMember(int64(workspaceID), claims.UserID) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "you are not a member of this workspace",
		})
	}

	var file model.WorkspaceFile
	err = h.db.Where("id = ? AND workspace_id = ?", fileID, workspaceID).First(&file).Error
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "file not found",
		})
	}

	if file.S3Key == nil || *file.S3Key == "" {
		// S3 키가 없으면 기존 URL 반환
		if file.FileURL != nil {
			return c.JSON(fiber.Map{
				"url": *file.FileURL,
			})
		}
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "file URL not found",
		})
	}

	// Presigned URL 생성
	url, err := h.s3.GetFileURL(*file.S3Key)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to generate download URL",
		})
	}

	return c.JSON(fiber.Map{
		"url": url,
	})
}

// 헬퍼 함수
func (h *StorageHandler) isWorkspaceMember(workspaceID, userID int64) bool {
	var count int64
	h.db.Model(&model.WorkspaceMember{}).
		Where("workspace_id = ? AND user_id = ? AND status = ?", workspaceID, userID, model.MemberStatusActive.String()).
		Count(&count)
	return count > 0
}

func (h *StorageHandler) deleteRecursiveWithTx(tx *gorm.DB, folderID int64, s3Keys *[]string) {
	var children []model.WorkspaceFile
	tx.Where("parent_folder_id = ?", folderID).Find(&children)

	for _, child := range children {
		// S3 키 수집 (삭제는 트랜잭션 완료 후)
		if child.S3Key != nil && *child.S3Key != "" {
			*s3Keys = append(*s3Keys, *child.S3Key)
		}

		if child.Type == "FOLDER" {
			h.deleteRecursiveWithTx(tx, child.ID, s3Keys)
		}
		tx.Delete(&child)
	}
}

func (h *StorageHandler) getBreadcrumbs(folderID int64) []FileResponse {
	var breadcrumbs []FileResponse
	currentID := folderID

	for currentID > 0 {
		var folder model.WorkspaceFile
		if err := h.db.First(&folder, currentID).Error; err != nil {
			break
		}
		breadcrumbs = append([]FileResponse{h.toFileResponse(&folder)}, breadcrumbs...)
		if folder.ParentFolderID != nil {
			currentID = *folder.ParentFolderID
		} else {
			break
		}
	}

	return breadcrumbs
}

func (h *StorageHandler) toFileResponse(f *model.WorkspaceFile) FileResponse {
	resp := FileResponse{
		ID:               f.ID,
		WorkspaceID:      f.WorkspaceID,
		UploaderID:       f.UploaderID,
		ParentFolderID:   f.ParentFolderID,
		Name:             f.Name,
		Type:             f.Type,
		FileURL:          f.FileURL,
		FileSize:         f.FileSize,
		MimeType:         f.MimeType,
		S3Key:            f.S3Key,
		RelatedMeetingID: f.RelatedMeetingID,
		CreatedAt:        f.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
	}

	if f.Uploader != nil && f.Uploader.ID != 0 {
		resp.Uploader = &UserResponse{
			ID:         f.Uploader.ID,
			Email:      f.Uploader.Email,
			Nickname:   f.Uploader.Nickname,
			ProfileImg: f.Uploader.ProfileImg,
		}
	}

	return resp
}

// sanitizeString 문자열 정리 (storage 패키지 용)
func sanitizeStorageString(s string) string {
	s = strings.TrimSpace(s)
	// 위험한 문자 제거
	invalidChars := []string{"<", ">", "\"", "/", "\\", "|", "?", "*"}
	for _, char := range invalidChars {
		s = strings.ReplaceAll(s, char, "")
	}
	return s
}
