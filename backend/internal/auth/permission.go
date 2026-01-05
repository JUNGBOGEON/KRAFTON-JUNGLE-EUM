package auth

import "gorm.io/gorm"

// CheckPermission 권한 확인
func CheckPermission(db *gorm.DB, workspaceID, userID int64, permissionCode string) (bool, error) {
	// 1. 소유자(Owner) 확인 - 소유자는 모든 권한을 가짐 (Super User)
	var ownerID int64
	if err := db.Table("workspaces").Where("id = ?", workspaceID).Select("owner_id").Scan(&ownerID).Error; err != nil {
		return false, err
	}
	if ownerID == userID {
		return true, nil
	}

	// 2. ADMIN 권한 확인 (Super User)
	var adminCount int64
	err := db.Table("role_permissions").
		Joins("JOIN workspace_members ON workspace_members.role_id = role_permissions.role_id").
		Where("workspace_members.workspace_id = ? AND workspace_members.user_id = ? AND role_permissions.permission_code = 'ADMIN'", workspaceID, userID).
		Count(&adminCount).Error

	if err == nil && adminCount > 0 {
		return true, nil
	}

	// 3. 역할 기반 권한 확인
	var count int64
	err = db.Table("role_permissions").
		Joins("JOIN workspace_members ON workspace_members.role_id = role_permissions.role_id").
		Where("workspace_members.workspace_id = ? AND workspace_members.user_id = ? AND role_permissions.permission_code = ?", workspaceID, userID, permissionCode).
		Count(&count).Error

	if err != nil {
		return false, err
	}

	return count > 0, nil
}
