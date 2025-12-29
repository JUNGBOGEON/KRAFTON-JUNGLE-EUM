package handler

import (
	"github.com/gofiber/fiber/v2"
	"gorm.io/gorm"

	"realtime-backend/internal/auth"
	"realtime-backend/internal/model"
)

// WorkspaceHandler 워크스페이스 핸들러
type WorkspaceHandler struct {
	db *gorm.DB
}

// NewWorkspaceHandler WorkspaceHandler 생성
func NewWorkspaceHandler(db *gorm.DB) *WorkspaceHandler {
	return &WorkspaceHandler{db: db}
}

// CreateWorkspaceRequest 워크스페이스 생성 요청
type CreateWorkspaceRequest struct {
	Name      string  `json:"name"`
	MemberIDs []int64 `json:"member_ids,omitempty"`
}

// WorkspaceResponse 워크스페이스 응답
type WorkspaceResponse struct {
	ID        int64                     `json:"id"`
	Name      string                    `json:"name"`
	OwnerID   int64                     `json:"owner_id"`
	CreatedAt string                    `json:"created_at"`
	Owner     *UserResponse             `json:"owner,omitempty"`
	Members   []WorkspaceMemberResponse `json:"members,omitempty"`
}

// WorkspaceMemberResponse 워크스페이스 멤버 응답
type WorkspaceMemberResponse struct {
	ID       int64         `json:"id"`
	UserID   int64         `json:"user_id"`
	RoleID   *int64        `json:"role_id,omitempty"`
	JoinedAt string        `json:"joined_at"`
	User     *UserResponse `json:"user,omitempty"`
}

// CreateWorkspace 워크스페이스 생성
func (h *WorkspaceHandler) CreateWorkspace(c *fiber.Ctx) error {
	claims := c.Locals("claims").(*auth.Claims)

	var req CreateWorkspaceRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid request body",
		})
	}

	// 이름 검증
	if req.Name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "workspace name is required",
		})
	}

	if len(req.Name) < 2 || len(req.Name) > 100 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "workspace name must be between 2 and 100 characters",
		})
	}

	// 이름 정제
	req.Name = sanitizeString(req.Name)

	// 트랜잭션으로 워크스페이스 + 멤버 생성
	var workspace model.Workspace
	err := h.db.Transaction(func(tx *gorm.DB) error {
		// 워크스페이스 생성
		workspace = model.Workspace{
			Name:    req.Name,
			OwnerID: claims.UserID,
		}
		if err := tx.Create(&workspace).Error; err != nil {
			return err
		}

		// 소유자를 멤버로 추가
		ownerMember := model.WorkspaceMember{
			WorkspaceID: workspace.ID,
			UserID:      claims.UserID,
		}
		if err := tx.Create(&ownerMember).Error; err != nil {
			return err
		}

		// 초대할 멤버들 추가
		for _, memberID := range req.MemberIDs {
			// 본인은 이미 추가됨
			if memberID == claims.UserID {
				continue
			}

			// 사용자 존재 확인
			var user model.User
			if err := tx.First(&user, memberID).Error; err != nil {
				continue // 존재하지 않는 사용자는 무시
			}

			member := model.WorkspaceMember{
				WorkspaceID: workspace.ID,
				UserID:      memberID,
			}
			if err := tx.Create(&member).Error; err != nil {
				return err
			}
		}

		return nil
	})

	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to create workspace",
		})
	}

	// 생성된 워크스페이스 조회 (멤버 포함)
	h.db.Preload("Owner").Preload("Members.User").First(&workspace, workspace.ID)

	return c.Status(fiber.StatusCreated).JSON(h.toWorkspaceResponse(&workspace))
}

// GetMyWorkspaces 내 워크스페이스 목록
func (h *WorkspaceHandler) GetMyWorkspaces(c *fiber.Ctx) error {
	claims := c.Locals("claims").(*auth.Claims)

	var workspaces []model.Workspace

	// 내가 멤버로 속한 워크스페이스 조회
	err := h.db.
		Joins("JOIN workspace_members ON workspace_members.workspace_id = workspaces.id").
		Where("workspace_members.user_id = ?", claims.UserID).
		Preload("Owner").
		Preload("Members.User").
		Order("workspaces.created_at DESC").
		Find(&workspaces).Error

	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to get workspaces",
		})
	}

	responses := make([]WorkspaceResponse, len(workspaces))
	for i, ws := range workspaces {
		responses[i] = h.toWorkspaceResponse(&ws)
	}

	return c.JSON(fiber.Map{
		"workspaces": responses,
		"total":      len(responses),
	})
}

// GetWorkspace 워크스페이스 상세 조회
func (h *WorkspaceHandler) GetWorkspace(c *fiber.Ctx) error {
	claims := c.Locals("claims").(*auth.Claims)
	workspaceID, err := c.ParamsInt("id")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid workspace id",
		})
	}

	var workspace model.Workspace
	err = h.db.
		Preload("Owner").
		Preload("Members.User").
		First(&workspace, workspaceID).Error

	if err == gorm.ErrRecordNotFound {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "workspace not found",
		})
	}
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to get workspace",
		})
	}

	// 멤버인지 확인
	isMember := false
	for _, member := range workspace.Members {
		if member.UserID == claims.UserID {
			isMember = true
			break
		}
	}

	if !isMember {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "you are not a member of this workspace",
		})
	}

	return c.JSON(h.toWorkspaceResponse(&workspace))
}

// AddMembers 멤버 추가
func (h *WorkspaceHandler) AddMembers(c *fiber.Ctx) error {
	claims := c.Locals("claims").(*auth.Claims)
	workspaceID, err := c.ParamsInt("id")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid workspace id",
		})
	}

	var req struct {
		MemberIDs []int64 `json:"member_ids"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid request body",
		})
	}

	// 워크스페이스 조회
	var workspace model.Workspace
	if err := h.db.Preload("Members").First(&workspace, workspaceID).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "workspace not found",
		})
	}

	// 멤버인지 확인
	isMember := false
	for _, member := range workspace.Members {
		if member.UserID == claims.UserID {
			isMember = true
			break
		}
	}

	if !isMember {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "you are not a member of this workspace",
		})
	}

	// 기존 멤버 ID 맵
	existingMembers := make(map[int64]bool)
	for _, member := range workspace.Members {
		existingMembers[member.UserID] = true
	}

	// 새 멤버 추가
	addedCount := 0
	for _, memberID := range req.MemberIDs {
		// 이미 멤버인 경우 건너뛰기
		if existingMembers[memberID] {
			continue
		}

		// 사용자 존재 확인
		var user model.User
		if err := h.db.First(&user, memberID).Error; err != nil {
			continue
		}

		member := model.WorkspaceMember{
			WorkspaceID: workspace.ID,
			UserID:      memberID,
		}
		if err := h.db.Create(&member).Error; err == nil {
			addedCount++
		}
	}

	return c.JSON(fiber.Map{
		"message":     "members added successfully",
		"added_count": addedCount,
	})
}

// 헬퍼 함수: 워크스페이스 응답 변환
func (h *WorkspaceHandler) toWorkspaceResponse(ws *model.Workspace) WorkspaceResponse {
	resp := WorkspaceResponse{
		ID:        ws.ID,
		Name:      ws.Name,
		OwnerID:   ws.OwnerID,
		CreatedAt: ws.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
	}

	// Owner
	if ws.Owner.ID != 0 {
		resp.Owner = &UserResponse{
			ID:         ws.Owner.ID,
			Email:      ws.Owner.Email,
			Nickname:   ws.Owner.Nickname,
			ProfileImg: ws.Owner.ProfileImg,
		}
	}

	// Members
	if len(ws.Members) > 0 {
		resp.Members = make([]WorkspaceMemberResponse, len(ws.Members))
		for i, m := range ws.Members {
			resp.Members[i] = WorkspaceMemberResponse{
				ID:       m.ID,
				UserID:   m.UserID,
				RoleID:   m.RoleID,
				JoinedAt: m.JoinedAt.Format("2006-01-02T15:04:05Z07:00"),
			}
			if m.User.ID != 0 {
				resp.Members[i].User = &UserResponse{
					ID:         m.User.ID,
					Email:      m.User.Email,
					Nickname:   m.User.Nickname,
					ProfileImg: m.User.ProfileImg,
				}
			}
		}
	}

	return resp
}
