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

	log.Println("Database connected. Starting role reset...")

	// Transaction for reset
	err = db.Transaction(func(tx *gorm.DB) error {
		// 1. Clear role_id from workspace_members to avoid FK constraints
		log.Println("Clearing role assignments from workspace_members...")
		if err := tx.Session(&gorm.Session{AllowGlobalUpdate: true}).Model(&model.WorkspaceMember{}).Update("role_id", nil).Error; err != nil {
			return err
		}

		// 2. Clear role_permissions
		log.Println("Clearing role_permissions...")
		if err := tx.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&model.RolePermission{}).Error; err != nil {
			return err
		}

		// 3. Clear roles
		log.Println("Clearing roles...")
		if err := tx.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&model.Role{}).Error; err != nil {
			return err
		}

		return nil
	})

	if err != nil {
		log.Fatalf("Failed to reset roles: %v", err)
	}

	log.Println("Roles and permissions successfully reset.")
}
