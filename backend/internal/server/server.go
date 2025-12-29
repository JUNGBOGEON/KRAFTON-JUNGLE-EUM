package server

import (
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gofiber/contrib/websocket"
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/limiter"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"gorm.io/gorm"

	"realtime-backend/internal/auth"
	"realtime-backend/internal/config"
	"realtime-backend/internal/handler"
)

// Server Fiber 서버 래퍼
type Server struct {
	app         *fiber.App
	cfg         *config.Config
	db          *gorm.DB
	handler     *handler.AudioHandler
	authHandler *handler.AuthHandler
	userHandler *handler.UserHandler
	jwtManager  *auth.JWTManager
}

// New 새 서버 인스턴스 생성
func New(cfg *config.Config, db *gorm.DB) *Server {
	app := fiber.New(fiber.Config{
		AppName:               "Realtime Voice AI Gateway",
		ServerHeader:          "Fiber",
		StrictRouting:         true,
		CaseSensitive:         true,
		ReadTimeout:           cfg.Server.ReadTimeout,
		WriteTimeout:          cfg.Server.WriteTimeout,
		IdleTimeout:           cfg.Server.IdleTimeout,
		Prefork:               false, // WebSocket과 호환성 문제로 비활성화
		ReadBufferSize:        16384, // 16KB - 큰 헤더 허용
		WriteBufferSize:       16384,
		BodyLimit:             10 * 1024 * 1024, // 10MB
		DisableStartupMessage: false,
	})

	// Auth 초기화
	jwtManager := auth.NewJWTManager(
		cfg.Auth.JWTSecret,
		cfg.Auth.AccessTokenExpiry,
		cfg.Auth.RefreshTokenExpiry,
	)
	googleAuth := auth.NewGoogleAuthenticator(cfg.Auth.GoogleClientID)
	authHandler := handler.NewAuthHandler(db, jwtManager, googleAuth, cfg.Auth.SecureCookie)
	userHandler := handler.NewUserHandler(db)

	return &Server{
		app:         app,
		cfg:         cfg,
		db:          db,
		handler:     handler.NewAudioHandler(cfg),
		authHandler: authHandler,
		userHandler: userHandler,
		jwtManager:  jwtManager,
	}
}

// SetupMiddleware 미들웨어 설정
func (s *Server) SetupMiddleware() {
	// 패닉 복구
	s.app.Use(recover.New(recover.Config{
		EnableStackTrace: true,
	}))

	// 로깅
	s.app.Use(logger.New(logger.Config{
		Format:     "${time} | ${status} | ${latency} | ${ip} | ${method} ${path}\n",
		TimeFormat: "2006-01-02 15:04:05",
		TimeZone:   "Asia/Seoul",
	}))

	// CORS
	s.app.Use(cors.New(cors.Config{
		AllowOrigins:     s.cfg.CORS.AllowOrigins,
		AllowHeaders:     "Origin, Content-Type, Accept, Authorization",
		AllowMethods:     "GET, POST, PUT, DELETE, OPTIONS",
		AllowCredentials: true,
	}))
}

// SetupRoutes 라우트 설정
func (s *Server) SetupRoutes() {
	// 헬스체크 엔드포인트
	s.app.Get("/health", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{
			"status":    "ok",
			"timestamp": time.Now().Unix(),
		})
	})

	// Rate Limiter 설정 (인증 엔드포인트용 - Brute Force 방지)
	authLimiter := limiter.New(limiter.Config{
		Max:        10,              // 최대 10회
		Expiration: 1 * time.Minute, // 1분당
		KeyGenerator: func(c *fiber.Ctx) string {
			return c.IP() // IP 기반 제한
		},
		LimitReached: func(c *fiber.Ctx) error {
			return c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{
				"error": "too many requests, please try again later",
			})
		},
	})

	// Auth 라우트 그룹
	authGroup := s.app.Group("/auth")
	authGroup.Post("/google", authLimiter, s.authHandler.GoogleLogin)
	authGroup.Post("/refresh", authLimiter, s.authHandler.RefreshToken)
	authGroup.Post("/logout", auth.AuthMiddleware(s.jwtManager), s.authHandler.Logout) // 인증된 사용자만
	authGroup.Get("/me", auth.AuthMiddleware(s.jwtManager), s.authHandler.GetMe)

	// User 라우트 그룹 (인증 필요)
	userGroup := s.app.Group("/api/users", auth.AuthMiddleware(s.jwtManager))
	userGroup.Get("/search", s.userHandler.SearchUsers)

	// WebSocket 업그레이드 체크 미들웨어
	s.app.Use("/ws", func(c *fiber.Ctx) error {
		if websocket.IsWebSocketUpgrade(c) {
			c.Locals("allowed", true)
			return c.Next()
		}
		return fiber.ErrUpgradeRequired
	})

	// WebSocket 오디오 스트리밍 엔드포인트
	s.app.Get("/ws/audio", websocket.New(s.handler.HandleWebSocket, websocket.Config{
		ReadBufferSize:  s.cfg.WebSocket.ReadBufferSize,
		WriteBufferSize: s.cfg.WebSocket.WriteBufferSize,
	}))
}

// Start 서버 시작 (Graceful Shutdown 지원)
func (s *Server) Start() error {
	// Graceful Shutdown 설정
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		<-quit
		log.Println("🛑 Shutting down server...")
		if err := s.app.ShutdownWithTimeout(30 * time.Second); err != nil {
			log.Fatalf("Server shutdown error: %v", err)
		}
	}()

	log.Printf("🚀 Realtime Voice AI Gateway starting on %s", s.cfg.Server.Port)
	log.Printf("📡 WebSocket endpoint: ws://localhost%s/ws/audio", s.cfg.Server.Port)

	return s.app.Listen(s.cfg.Server.Port)
}

// Shutdown 서버 종료
func (s *Server) Shutdown() error {
	return s.app.ShutdownWithTimeout(30 * time.Second)
}
