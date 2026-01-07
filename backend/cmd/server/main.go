package main

import (
	"log"

	"realtime-backend/internal/config"
	"realtime-backend/internal/database"
	"realtime-backend/internal/server"
)

func main() {
	// 설정 로드
	// 설정 로드2
	cfg := config.Load()

	// 데이터베이스 연결
	db, err := database.ConnectDB()
	if err != nil {
		log.Fatalf("❌ Database connection failed: %v", err)
	}
	defer database.Close()

	// Ping 테스트
	if err := database.Ping(); err != nil {
		log.Fatalf("❌ Database ping failed: %v", err)
	}
	log.Printf("✅ Database connected successfully")

	// DB 버전 확인
	var version string
	db.Raw("SELECT version()").Scan(&version)
	log.Printf("📦 PostgreSQL: %s", version[:50]+"...")

	// 서버 생성 및 설정
	srv := server.New(cfg, db)
	srv.SetupMiddleware()
	srv.SetupRoutes()

	// 서버 시작
	if err := srv.Start(); err != nil {
		log.Fatalf("Server failed to start: %v", err)
	}
	// Trigger restartAction
}
