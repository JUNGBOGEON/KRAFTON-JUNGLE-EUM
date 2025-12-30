package handler

import (
	"github.com/gofiber/fiber/v2"
	"gorm.io/gorm"

	"realtime-backend/internal/auth"
	"realtime-backend/internal/model"
)

// RoleHandler 역할 핸들러
type RoleHandler struct {
	db *gorm.DB
}

// NewRoleHandler RoleHandler 생성
func NewRoleHandler(db *gorm.DB) *RoleHandler {
	return &RoleHandler{db: db}
}

// CreateRoleRequest 역할 생성 요청
type CreateRoleRequest struct {
	Name        string   `json:"name"`
	Color       *string  `json:"color,omitempty"`
	Permissions []string `json:"permissions,omitempty"`
}

// UpdateRoleRequest 역할 수정 요청
type UpdateRoleRequest struct {
	Name        string   `json:"name"`
	Color       *string  `json:"color,omitempty"`
	Permissions []string `json:"permissions,omitempty"`
}

// GetRoles 역할 목록 조회
func (h *RoleHandler) GetRoles(c *fiber.Ctx) error {
	claims := c.Locals("claims").(*auth.Claims)
	workspaceID, err := c.ParamsInt("id")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid workspace id"})
	}

	// 멤버십 확인
	var memberCount int64
	h.db.Model(&model.WorkspaceMember{}).
		Where("workspace_id = ? AND user_id = ? AND status = ?", workspaceID, claims.UserID, model.MemberStatusActive.String()).
		Count(&memberCount)

	if memberCount == 0 {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "forbidden"})
	}

	var roles []model.Role
	// Preload 사용하여 권한 함께 로드
	if err := h.db.Preload("Permissions").Where("workspace_id = ?", workspaceID).Order("id asc").Find(&roles).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to get roles"})
	}

	return c.JSON(roles)
}

// CreateRole 역할 생성
func (h *RoleHandler) CreateRole(c *fiber.Ctx) error {
	claims := c.Locals("claims").(*auth.Claims)
	workspaceID, err := c.ParamsInt("id")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid workspace id"})
	}

	// 워크스페이스 소유자 확인
	var workspace model.Workspace
	if err := h.db.First(&workspace, workspaceID).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "workspace not found"})
	}

	if workspace.OwnerID != claims.UserID {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "only workspace owner can manage roles"})
	}

	var req CreateRoleRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
	}

	role := model.Role{
		WorkspaceID: int64(workspaceID),
		Name:        req.Name,
		Color:       req.Color,
		IsDefault:   false,
	}

	// 트랜잭션으로 역할 및 권한 생성
	err = h.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&role).Error; err != nil {
			return err
		}

		if len(req.Permissions) > 0 {
			var permissions []model.RolePermission
			for _, code := range req.Permissions {
				permissions = append(permissions, model.RolePermission{
					RoleID:         role.ID,
					PermissionCode: code,
				})
			}
			if err := tx.Create(&permissions).Error; err != nil {
				return err
			}
		}
		return nil
	})

	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to create role"})
	}

	// 생성된 역할정보 다시 조회 (권한 포함)
	h.db.Preload("Permissions").First(&role, role.ID)

	return c.Status(fiber.StatusCreated).JSON(role)
}

// UpdateRole 역할 수정
func (h *RoleHandler) UpdateRole(c *fiber.Ctx) error {
	claims := c.Locals("claims").(*auth.Claims)
	workspaceID, err := c.ParamsInt("id")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid workspace id"})
	}
	roleID, err := c.ParamsInt("roleId")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid role id"})
	}

	// 워크스페이스 소유자 확인
	var workspace model.Workspace
	if err := h.db.First(&workspace, workspaceID).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "workspace not found"})
	}
	if workspace.OwnerID != claims.UserID {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "only workspace owner can manage roles"})
	}

	var req UpdateRoleRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
	}

	var role model.Role
	if err := h.db.Where("id = ? AND workspace_id = ?", roleID, workspaceID).First(&role).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "role not found"})
	}

	// 트랜잭션으로 역할 정보 및 권한 업데이트
	err = h.db.Transaction(func(tx *gorm.DB) error {
		// 기본 정보 업데이트
		role.Name = req.Name
		role.Color = req.Color
		if err := tx.Save(&role).Error; err != nil {
			return err
		}

		// 기존 권한 삭제 후 재 생성 (permissions 필드가 있는 경우에만)
		if req.Permissions != nil {
			// 기존 권한 삭제
			if err := tx.Where("role_id = ?", role.ID).Delete(&model.RolePermission{}).Error; err != nil {
				return err
			}

			// 새 권한 추가
			if len(req.Permissions) > 0 {
				var permissions []model.RolePermission
				for _, code := range req.Permissions {
					permissions = append(permissions, model.RolePermission{
						RoleID:         role.ID,
						PermissionCode: code,
					})
				}
				if err := tx.Create(&permissions).Error; err != nil {
					return err
				}
			}
		}
		return nil
	})

	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to update role"})
	}

	// 업데이트된 정보 다시 조회
	h.db.Preload("Permissions").First(&role, role.ID)

	return c.JSON(role)
}

// DeleteRole 역할 삭제
func (h *RoleHandler) DeleteRole(c *fiber.Ctx) error {
	claims := c.Locals("claims").(*auth.Claims)
	workspaceID, err := c.ParamsInt("id")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid workspace id"})
	}
	roleID, err := c.ParamsInt("roleId")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid role id"})
	}

	// 워크스페이스 소유자 확인
	var workspace model.Workspace
	if err := h.db.First(&workspace, workspaceID).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "workspace not found"})
	}
	if workspace.OwnerID != claims.UserID {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "only workspace owner can manage roles"})
	}

	// 역할 삭제 트랜잭션
	err = h.db.Transaction(func(tx *gorm.DB) error {
		// 1. 해당 역할을 가진 멤버들의 RoleID를 null로 설정
		if err := tx.Model(&model.WorkspaceMember{}).
			Where("workspace_id = ? AND role_id = ?", workspaceID, roleID).
			Update("role_id", nil).Error; err != nil {
			return err
		}

		// 2. 역할 권한 삭제 (Cascading이 안되어 있을 수 있으므로 명시적 삭제)
		if err := tx.Where("role_id = ?", roleID).Delete(&model.RolePermission{}).Error; err != nil {
			return err
		}

		// 3. 역할 삭제
		if err := tx.Where("id = ? AND workspace_id = ?", roleID, workspaceID).Delete(&model.Role{}).Error; err != nil {
			return err
		}
		return nil
	})

	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to delete role"})
	}

	return c.SendStatus(fiber.StatusNoContent)
}
