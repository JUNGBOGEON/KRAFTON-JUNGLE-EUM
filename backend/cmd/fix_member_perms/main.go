package main

import (
	"log"

	"github.com/joho/godotenv"
	"gorm.io/gorm"

	"realtime-backend/internal/database"
	"realtime-backend/internal/model"
)

func main() {
	// Load environment variables
	if err := godotenv.Load(".env"); err != nil {
		log.Fatal("Error loading .env file")
	}

	// Connect to database
	db, err := database.ConnectDB()
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}

	log.Println("Database connected. Starting member permission fix...")

	// Transaction for fix
	err = db.Transaction(func(tx *gorm.DB) error {
		// 1. Find all default "Member" roles
		var memberRoles []model.Role
		if err := tx.Where("name = ? AND is_default = ?", "Member", true).Find(&memberRoles).Error; err != nil {
			return err
		}

		log.Printf("Found %d default 'Member' roles to update.\n", len(memberRoles))

		for _, role := range memberRoles {
			// 2. Ensure CONNECT_MEDIA exists
			var count int64
			if err := tx.Model(&model.RolePermission{}).
				Where("role_id = ? AND permission_code = ?", role.ID, "CONNECT_MEDIA").
				Count(&count).Error; err != nil {
				return err
			}

			if count == 0 {
				log.Printf("Adding CONNECT_MEDIA to role ID %d (Workspace %d)\n", role.ID, role.WorkspaceID)
				if err := tx.Create(&model.RolePermission{
					RoleID:         role.ID,
					PermissionCode: "CONNECT_MEDIA",
				}).Error; err != nil {
					return err
				}
			}

			// 3. Ensure SEND_MESSAGES exists
			if err := tx.Model(&model.RolePermission{}).
				Where("role_id = ? AND permission_code = ?", role.ID, "SEND_MESSAGES").
				Count(&count).Error; err != nil {
				return err
			}

			if count == 0 {
				log.Printf("Adding SEND_MESSAGES to role ID %d (Workspace %d)\n", role.ID, role.WorkspaceID)
				if err := tx.Create(&model.RolePermission{
					RoleID:         role.ID,
					PermissionCode: "SEND_MESSAGES",
				}).Error; err != nil {
					return err
				}
			}

			// 4. Remove CONNECT_VOICE if exists
			if err := tx.Where("role_id = ? AND permission_code = ?", role.ID, "CONNECT_VOICE").
				Delete(&model.RolePermission{}).Error; err != nil {
				return err
			}
		}

		return nil
	})

	if err != nil {
		log.Fatalf("Failed to fix member permissions: %v", err)
	}

	log.Println("Member permissions successfully updated.")
}
