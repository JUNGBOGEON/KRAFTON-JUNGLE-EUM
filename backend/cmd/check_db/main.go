package main

import (
	"fmt"
	"log"
	"os"

	"github.com/joho/godotenv"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func main() {
	// Load .env file
	if err := godotenv.Load(); err != nil {
		log.Fatal("Error loading .env file")
	}

	// Database connection
	dsn := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=%s TimeZone=%s",
		os.Getenv("DB_HOST"),
		os.Getenv("DB_PORT"),
		os.Getenv("DB_USER"),
		os.Getenv("DB_PASSWORD"),
		os.Getenv("DB_NAME"),
		os.Getenv("DB_SSLMODE"),
		os.Getenv("DB_TIMEZONE"),
	)

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		log.Fatal("Failed to connect to database:", err)
	}

	fmt.Println("✅ Connected to database")
	fmt.Println()

	// Check if status column exists
	var exists bool
	query := `
		SELECT EXISTS (
			SELECT 1 
			FROM information_schema.columns 
			WHERE table_name = 'workspace_members' 
			AND column_name = 'status'
		)
	`
	if err := db.Raw(query).Scan(&exists).Error; err != nil {
		log.Fatal("Failed to check status column:", err)
	}

	fmt.Printf("📊 Status column exists: %v\n", exists)
	fmt.Println()

	if exists {
		// Get column info
		type ColumnInfo struct {
			ColumnName    string
			DataType      string
			ColumnDefault *string
			IsNullable    string
		}
		var colInfo ColumnInfo
		query = `
			SELECT column_name, data_type, column_default, is_nullable
			FROM information_schema.columns
			WHERE table_name = 'workspace_members' 
			AND column_name = 'status'
		`
		if err := db.Raw(query).Scan(&colInfo).Error; err != nil {
			log.Fatal("Failed to get column info:", err)
		}

		fmt.Println("📋 Column Information:")
		fmt.Printf("  - Name: %s\n", colInfo.ColumnName)
		fmt.Printf("  - Type: %s\n", colInfo.DataType)
		if colInfo.ColumnDefault != nil {
			fmt.Printf("  - Default: %s\n", *colInfo.ColumnDefault)
		} else {
			fmt.Println("  - Default: NULL")
		}
		fmt.Printf("  - Nullable: %s\n", colInfo.IsNullable)
		fmt.Println()

		// Get status statistics
		type StatusStats struct {
			Total   int64
			Active  int64
			Pending int64
			Null    int64
		}
		var stats StatusStats
		query = `
			SELECT 
				COUNT(*) as total,
				COUNT(CASE WHEN status = 'ACTIVE' THEN 1 END) as active,
				COUNT(CASE WHEN status = 'PENDING' THEN 1 END) as pending,
				COUNT(CASE WHEN status IS NULL THEN 1 END) as null
			FROM workspace_members
		`
		if err := db.Raw(query).Scan(&stats).Error; err != nil {
			log.Fatal("Failed to get statistics:", err)
		}

		fmt.Println("📈 Member Status Statistics:")
		fmt.Printf("  - Total members: %d\n", stats.Total)
		fmt.Printf("  - ACTIVE: %d\n", stats.Active)
		fmt.Printf("  - PENDING: %d\n", stats.Pending)
		fmt.Printf("  - NULL: %d\n", stats.Null)
		fmt.Println()

		// Get recent members
		type MemberInfo struct {
			ID          int64
			WorkspaceID int64
			UserID      int64
			Status      *string
			JoinedAt    string
		}
		var members []MemberInfo
		query = `
			SELECT id, workspace_id, user_id, status, joined_at
			FROM workspace_members
			ORDER BY id DESC
			LIMIT 10
		`
		if err := db.Raw(query).Scan(&members).Error; err != nil {
			log.Fatal("Failed to get recent members:", err)
		}

		fmt.Println("👥 Recent Members (last 10):")
		for _, m := range members {
			status := "NULL"
			if m.Status != nil {
				status = *m.Status
			}
			fmt.Printf("  - ID: %d, Workspace: %d, User: %d, Status: %s\n",
				m.ID, m.WorkspaceID, m.UserID, status)
		}
	} else {
		fmt.Println("❌ Status column does NOT exist!")
		fmt.Println("⚠️  Need to run migration to add status column")
	}
}
