package service

import (
	"realtime-backend/internal/model"

	"gorm.io/gorm"
)

// MemberService 멤버십/권한 관련 비즈니스 로직
type MemberService struct {
	db *gorm.DB
}

// NewMemberService MemberService 생성
func NewMemberService(db *gorm.DB) *MemberService {
	return &MemberService{db: db}
}

// IsWorkspaceMember 워크스페이스 멤버 여부 확인
func (s *MemberService) IsWorkspaceMember(workspaceID, userID int64) bool {
	var count int64
	s.db.Model(&model.WorkspaceMember{}).
		Where("workspace_id = ? AND user_id = ? AND status = ?", workspaceID, userID, model.MemberStatusActive.String()).
		Count(&count)
	return count > 0
}

// IsWorkspaceOwner 워크스페이스 소유자 여부 확인
func (s *MemberService) IsWorkspaceOwner(workspaceID, userID int64) bool {
	var ownerID int64
	s.db.Table("workspaces").Where("id = ?", workspaceID).Select("owner_id").Scan(&ownerID)
	return ownerID == userID
}

// IsWorkspaceMemberOrOwner 멤버 또는 소유자 여부 확인
func (s *MemberService) IsWorkspaceMemberOrOwner(workspaceID, userID int64) bool {
	return s.IsWorkspaceMember(workspaceID, userID) || s.IsWorkspaceOwner(workspaceID, userID)
}

// HasPermission 특정 권한 보유 여부 확인
func (s *MemberService) HasPermission(workspaceID, userID int64, permissionCode string) bool {
	// 소유자는 모든 권한 보유
	if s.IsWorkspaceOwner(workspaceID, userID) {
		return true
	}

	// 멤버의 역할 권한 확인
	var count int64
	s.db.Table("workspace_members wm").
		Joins("JOIN role_permissions rp ON wm.role_id = rp.role_id").
		Where("wm.workspace_id = ? AND wm.user_id = ? AND wm.status = ? AND rp.permission_code = ?",
			workspaceID, userID, model.MemberStatusActive.String(), permissionCode).
		Count(&count)

	return count > 0
}

// GetMemberRole 멤버의 역할 조회
func (s *MemberService) GetMemberRole(workspaceID, userID int64) (*model.Role, error) {
	var member model.WorkspaceMember
	err := s.db.Preload("Role").
		Where("workspace_id = ? AND user_id = ? AND status = ?", workspaceID, userID, model.MemberStatusActive.String()).
		First(&member).Error
	if err != nil {
		return nil, err
	}
	return member.Role, nil
}
