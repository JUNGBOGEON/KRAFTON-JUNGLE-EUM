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
	Status   string        `json:"status"`
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
	var invitedMemberIDs []int64 // 초대된 멤버 ID 목록 저장

	err := h.db.Transaction(func(tx *gorm.DB) error {
		// 워크스페이스 생성
		workspace = model.Workspace{
			Name:    req.Name,
			OwnerID: claims.UserID,
		}
		if err := tx.Create(&workspace).Error; err != nil {
			return err
		}

		// 소유자를 멤버로 추가 (ACTIVE 상태)
		ownerMember := model.WorkspaceMember{
			WorkspaceID: workspace.ID,
			UserID:      claims.UserID,
			Status:      model.MemberStatusActive.String(),
		}
		if err := tx.Create(&ownerMember).Error; err != nil {
			return err
		}

		// 초대할 멤버들 추가 (PENDING 상태)
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

			// PENDING 상태로 멤버 생성
			member := model.WorkspaceMember{
				WorkspaceID: workspace.ID,
				UserID:      memberID,
				Status:      model.MemberStatusPending.String(),
			}
			if err := tx.Create(&member).Error; err != nil {
				continue // 멤버 생성 실패 시 다음 멤버로
			}

			// 성공적으로 생성된 멤버 ID 저장
			invitedMemberIDs = append(invitedMemberIDs, memberID)
		}

		return nil
	})

	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to create workspace",
		})
	}

	// 초대된 멤버들에게 알림 전송
	if len(invitedMemberIDs) > 0 {
		// 초대자 정보 조회
		var inviter model.User
		h.db.First(&inviter, claims.UserID)

		// 각 초대된 멤버에게 알림 생성
		for _, memberID := range invitedMemberIDs {
			// 알림 생성 실패해도 워크스페이스 생성은 성공으로 처리
			CreateWorkspaceInviteNotification(h.db, claims.UserID, memberID, workspace.ID, workspace.Name, inviter.Nickname)
		}
	}

	// 생성된 워크스페이스 조회 (ACTIVE 멤버만 포함)
	h.db.
		Preload("Owner").
		Preload("Members", "status = ?", model.MemberStatusActive.String()).
		Preload("Members.User").
		First(&workspace, workspace.ID)

	return c.Status(fiber.StatusCreated).JSON(h.toWorkspaceResponse(&workspace))
}

// GetMyWorkspaces 내 워크스페이스 목록
func (h *WorkspaceHandler) GetMyWorkspaces(c *fiber.Ctx) error {
	claims := c.Locals("claims").(*auth.Claims)

	var workspaces []model.Workspace

	// 내가 ACTIVE 멤버로 속한 워크스페이스 조회
	err := h.db.
		Joins("JOIN workspace_members ON workspace_members.workspace_id = workspaces.id").
		Where("workspace_members.user_id = ? AND workspace_members.status = ?", claims.UserID, model.MemberStatusActive.String()).
		Preload("Owner").
		Preload("Members", "status = ?", model.MemberStatusActive.String()).
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
		Preload("Members", "status = ?", model.MemberStatusActive.String()).
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

// AddMembers 멤버 초대 (PENDING 멤버 + 알림 생성)
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
	// ACTIVE + PENDING 멤버 모두 로드 (중복 초대 방지용)
	if err := h.db.
		Preload("Members", "status IN ?", []string{
			model.MemberStatusActive.String(),
			model.MemberStatusPending.String(),
		}).
		First(&workspace, workspaceID).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "workspace not found",
		})
	}

	// 멤버인지 확인
	isMember := false
	for _, member := range workspace.Members {
		if member.UserID == claims.UserID && member.Status == model.MemberStatusActive.String() {
			isMember = true
			break
		}
	}

	if !isMember {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "you are not a member of this workspace",
		})
	}

	// 기존 멤버 ID 맵 (ACTIVE + PENDING 모두)
	existingMembers := make(map[int64]bool)
	for _, member := range workspace.Members {
		existingMembers[member.UserID] = true
	}

	// 초대자 정보 조회
	var inviter model.User
	h.db.First(&inviter, claims.UserID)

	// 트랜잭션으로 초대장 생성
	var invitedMemberIDs []int64
	err = h.db.Transaction(func(tx *gorm.DB) error {
		for _, memberID := range req.MemberIDs {
			// 이미 멤버인 경우 건너뛰기
			if existingMembers[memberID] {
				continue
			}

			// 사용자 존재 확인
			var user model.User
			if err := tx.First(&user, memberID).Error; err != nil {
				continue
			}

			// PENDING 상태로 멤버 생성
			member := model.WorkspaceMember{
				WorkspaceID: workspace.ID,
				UserID:      memberID,
				Status:      model.MemberStatusPending.String(),
			}
			if err := tx.Create(&member).Error; err != nil {
				continue
			}

			invitedMemberIDs = append(invitedMemberIDs, memberID)
		}
		return nil
	})

	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to add members",
		})
	}

	// 트랜잭션 완료 후 알림 생성 (알림 실패가 멤버 추가에 영향 X)
	for _, memberID := range invitedMemberIDs {
		CreateWorkspaceInviteNotification(h.db, claims.UserID, memberID, workspace.ID, workspace.Name, inviter.Nickname)
	}

	return c.JSON(fiber.Map{
		"message":       "invitations sent successfully",
		"invited_count": len(invitedMemberIDs),
	})
}

// LeaveWorkspace 워크스페이스 나가기
func (h *WorkspaceHandler) LeaveWorkspace(c *fiber.Ctx) error {
	claims := c.Locals("claims").(*auth.Claims)
	workspaceID, err := c.ParamsInt("id")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid workspace id",
		})
	}

	// 워크스페이스 조회
	var workspace model.Workspace
	if err := h.db.First(&workspace, workspaceID).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "workspace not found",
		})
	}

	// 소유자는 나갈 수 없음
	if workspace.OwnerID == claims.UserID {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "owner cannot leave workspace. Transfer ownership first or delete the workspace.",
		})
	}

	// 멤버십 조회
	var member model.WorkspaceMember
	if err := h.db.Where("workspace_id = ? AND user_id = ?", workspaceID, claims.UserID).First(&member).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "you are not a member of this workspace",
		})
	}

	// 멤버십 삭제
	if err := h.db.Delete(&member).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to leave workspace",
		})
	}

	return c.JSON(fiber.Map{
		"message": "successfully left workspace",
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
				Status:   m.Status,
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
