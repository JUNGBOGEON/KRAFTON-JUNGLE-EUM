package database

import (
	"fmt"
	"log"
	"os"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"realtime-backend/internal/model"
)

// DB 전역 데이터베이스 인스턴스
var DB *gorm.DB

// Config 데이터베이스 설정
type Config struct {
	Host     string
	Port     string
	User     string
	Password string
	DBName   string
	SSLMode  string
	TimeZone string
}

// LoadConfig 환경변수에서 DB 설정 로드
func LoadConfig() *Config {
	return &Config{
		Host:     getEnv("DB_HOST", "localhost"),
		Port:     getEnv("DB_PORT", "5432"),
		User:     getEnv("DB_USER", "postgres"),
		Password: getEnv("DB_PASSWORD", ""),
		DBName:   getEnv("DB_NAME", "postgres"),
		SSLMode:  getEnv("DB_SSLMODE", "require"), // Aurora는 SSL 필수
		TimeZone: getEnv("DB_TIMEZONE", "Asia/Seoul"),
	}
}

// ConnectDB 데이터베이스 연결 수립
func ConnectDB() (*gorm.DB, error) {
	cfg := LoadConfig()

	// PostgreSQL DSN 생성
	dsn := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=%s TimeZone=%s",
		cfg.Host, cfg.Port, cfg.User, cfg.Password, cfg.DBName, cfg.SSLMode, cfg.TimeZone,
	)

	// GORM 로거 설정
	gormLogger := logger.New(
		log.New(os.Stdout, "\r\n", log.LstdFlags),
		logger.Config{
			SlowThreshold:             200 * time.Millisecond,
			LogLevel:                  logger.Warn,
			IgnoreRecordNotFoundError: true,
			Colorful:                  true,
		},
	)

	// GORM 연결
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: gormLogger,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to connect to database: %w", err)
	}

	// 커넥션 풀 설정
	sqlDB, err := db.DB()
	if err != nil {
		return nil, fmt.Errorf("failed to get underlying sql.DB: %w", err)
	}

	// Aurora Serverless v2 최적화 설정
	sqlDB.SetMaxIdleConns(10)                  // 유휴 연결 수
	sqlDB.SetMaxOpenConns(100)                 // 최대 연결 수
	sqlDB.SetConnMaxLifetime(time.Hour)        // 연결 최대 수명
	sqlDB.SetConnMaxIdleTime(10 * time.Minute) // 유휴 연결 최대 시간

	// 전역 변수에 저장
	DB = db

	// AutoMigrate - 테이블 스키마 자동 업데이트
	if err := db.AutoMigrate(
		&model.User{},
		&model.Workspace{},
		&model.Role{},
		&model.RolePermission{},
		&model.WorkspaceMember{},
		&model.Meeting{},
		&model.Participant{},
		&model.Whiteboard{},
		&model.ChatLog{},
		&model.VoiceRecord{},
		&model.CalendarEvent{},
		&model.EventAttendee{},
		&model.WorkspaceFile{},
		&model.Notification{},
	); err != nil {
		log.Printf("⚠️ AutoMigrate warning: %v", err)
	}

	return db, nil
}

// Ping 데이터베이스 연결 테스트
func Ping() error {
	sqlDB, err := DB.DB()
	if err != nil {
		return fmt.Errorf("failed to get underlying sql.DB: %w", err)
	}

	if err := sqlDB.Ping(); err != nil {
		return fmt.Errorf("failed to ping database: %w", err)
	}

	return nil
}

// Close 데이터베이스 연결 종료
func Close() error {
	if DB == nil {
		return nil
	}

	sqlDB, err := DB.DB()
	if err != nil {
		return err
	}

	return sqlDB.Close()
}

// getEnv 환경변수 조회 (기본값 지원)
func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
