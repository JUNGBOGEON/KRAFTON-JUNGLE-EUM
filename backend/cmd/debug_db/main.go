package main

import (
	"fmt"
	"log"

	"realtime-backend/internal/config"
	"realtime-backend/internal/database"
	"realtime-backend/internal/model"
)

func main() {
	// 2. config 로드 (godotenv.Load 실행)
	config.Load()

	// 3. DB 연결
	fmt.Println("🔌 Connecting to DB...")
	db, err := database.ConnectDB()
	if err != nil {
		log.Fatalf("❌ Failed to connect to database: %v", err)
	}
	fmt.Println("✅ Database connected successfully")

	// 4. 컬럼 추가
	fmt.Println("🛠️ Checking for 's3_key' column...")

	if db.Migrator().HasColumn(&model.WorkspaceFile{}, "S3Key") {
		fmt.Println("✅ 's3_key' column already exists.")
	} else {
		fmt.Println("⚠️ 's3_key' column missing. Adding it now...")
		if err := db.Migrator().AddColumn(&model.WorkspaceFile{}, "S3Key"); err != nil {
			log.Fatalf("❌ Failed to add 's3_key' column: %v", err)
		}
		fmt.Println("✨ Successfully added 's3_key' column!")
	}

	// 5. ParentFolderID 외래키 제약조건 확인 (혹시 모를 에러 방지)
	// 이것은 나중에 필요하면 추가. 지금은 s3_key가 핵심.
}
