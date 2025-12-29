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
	"realtime-backend/internal/storage"
)

// Server Fiber 서버 래퍼
type Server struct {
	app              *fiber.App
	cfg              *config.Config
	db               *gorm.DB
	handler          *handler.AudioHandler
	authHandler      *handler.AuthHandler
	userHandler      *handler.UserHandler
	workspaceHandler *handler.WorkspaceHandler
	chatHandler      *handler.ChatHandler
	chatWSHandler    *handler.ChatWSHandler
	meetingHandler   *handler.MeetingHandler
	calendarHandler  *handler.CalendarHandler
	storageHandler   *handler.StorageHandler
	jwtManager       *auth.JWTManager
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
	workspaceHandler := handler.NewWorkspaceHandler(db)
	chatHandler := handler.NewChatHandler(db)
	chatWSHandler := handler.NewChatWSHandler(db)
	meetingHandler := handler.NewMeetingHandler(db)
	calendarHandler := handler.NewCalendarHandler(db)

	// S3 서비스 초기화 (선택적)
	var s3Service *storage.S3Service
	if cfg.S3.BucketName != "" && cfg.S3.AccessKeyID != "" {
		var err error
		s3Service, err = storage.NewS3Service(&cfg.S3)
		if err != nil {
			log.Printf("⚠️ S3 service initialization failed: %v (file upload will be disabled)", err)
		} else {
			log.Printf("✅ S3 service initialized (bucket: %s)", cfg.S3.BucketName)
		}
	} else {
		log.Println("ℹ️ S3 service not configured (file upload will be disabled)")
	}
	storageHandler := handler.NewStorageHandler(db, s3Service)

	return &Server{
		app:              app,
		cfg:              cfg,
		db:               db,
		handler:          handler.NewAudioHandler(cfg),
		authHandler:      authHandler,
		userHandler:      userHandler,
		workspaceHandler: workspaceHandler,
		chatHandler:      chatHandler,
		chatWSHandler:    chatWSHandler,
		meetingHandler:   meetingHandler,
		calendarHandler:  calendarHandler,
		storageHandler:   storageHandler,
		jwtManager:       jwtManager,
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

	// Workspace 라우트 그룹 (인증 필요)
	workspaceGroup := s.app.Group("/api/workspaces", auth.AuthMiddleware(s.jwtManager))
	workspaceGroup.Post("/", s.workspaceHandler.CreateWorkspace)
	workspaceGroup.Get("/", s.workspaceHandler.GetMyWorkspaces)
	workspaceGroup.Get("/:id", s.workspaceHandler.GetWorkspace)
	workspaceGroup.Post("/:id/members", s.workspaceHandler.AddMembers)

	// Chat 라우트 (워크스페이스 하위) - 레거시
	workspaceGroup.Get("/:workspaceId/chats", s.chatHandler.GetWorkspaceChats)
	workspaceGroup.Post("/:workspaceId/chats", s.chatHandler.SendMessage)

	// ChatRoom 라우트 (새 채팅방 시스템)
	workspaceGroup.Get("/:workspaceId/chatrooms", s.chatHandler.GetChatRooms)
	workspaceGroup.Post("/:workspaceId/chatrooms", s.chatHandler.CreateChatRoom)
	workspaceGroup.Delete("/:workspaceId/chatrooms/:roomId", s.chatHandler.DeleteChatRoom)
	workspaceGroup.Get("/:workspaceId/chatrooms/:roomId/messages", s.chatHandler.GetChatRoomMessages)
	workspaceGroup.Post("/:workspaceId/chatrooms/:roomId/messages", s.chatHandler.SendChatRoomMessage)
	workspaceGroup.Put("/:workspaceId/chatrooms/:roomId/messages/:messageId", s.chatHandler.UpdateChatMessage)
	workspaceGroup.Delete("/:workspaceId/chatrooms/:roomId/messages/:messageId", s.chatHandler.DeleteChatMessage)

	// Meeting 라우트 (워크스페이스 하위)
	workspaceGroup.Get("/:workspaceId/meetings", s.meetingHandler.GetWorkspaceMeetings)
	workspaceGroup.Post("/:workspaceId/meetings", s.meetingHandler.CreateMeeting)
	workspaceGroup.Get("/:workspaceId/meetings/:meetingId", s.meetingHandler.GetMeeting)
	workspaceGroup.Post("/:workspaceId/meetings/:meetingId/start", s.meetingHandler.StartMeeting)
	workspaceGroup.Post("/:workspaceId/meetings/:meetingId/end", s.meetingHandler.EndMeeting)

	// Calendar 라우트 (워크스페이스 하위)
	workspaceGroup.Get("/:workspaceId/events", s.calendarHandler.GetWorkspaceEvents)
	workspaceGroup.Post("/:workspaceId/events", s.calendarHandler.CreateEvent)
	workspaceGroup.Put("/:workspaceId/events/:eventId", s.calendarHandler.UpdateEvent)
	workspaceGroup.Delete("/:workspaceId/events/:eventId", s.calendarHandler.DeleteEvent)
	workspaceGroup.Put("/:workspaceId/events/:eventId/status", s.calendarHandler.UpdateAttendeeStatus)

	// Storage 라우트 (워크스페이스 하위)
	workspaceGroup.Get("/:workspaceId/files", s.storageHandler.GetWorkspaceFiles)
	workspaceGroup.Post("/:workspaceId/files/folder", s.storageHandler.CreateFolder)
	workspaceGroup.Post("/:workspaceId/files", s.storageHandler.UploadFile)
	workspaceGroup.Delete("/:workspaceId/files/:fileId", s.storageHandler.DeleteFile)
	workspaceGroup.Put("/:workspaceId/files/:fileId", s.storageHandler.RenameFile)

	// S3 파일 업로드 라우트
	workspaceGroup.Post("/:workspaceId/files/presign", s.storageHandler.GetPresignedURL)
	workspaceGroup.Post("/:workspaceId/files/confirm", s.storageHandler.ConfirmUpload)
	workspaceGroup.Get("/:workspaceId/files/:fileId/download", s.storageHandler.GetDownloadURL)

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

	// WebSocket 채팅 엔드포인트
	s.app.Get("/ws/chat/:workspaceId/:roomId", func(c *fiber.Ctx) error {
		if !websocket.IsWebSocketUpgrade(c) {
			return fiber.ErrUpgradeRequired
		}

		// 쿠키에서 JWT 토큰 추출
		accessToken := c.Cookies("access_token")
		if accessToken == "" {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"error": "authentication required",
			})
		}

		// JWT 검증
		claims, err := s.jwtManager.ValidateAccessToken(accessToken)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"error": "invalid token",
			})
		}

		workspaceID, err := c.ParamsInt("workspaceId")
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "invalid workspace id",
			})
		}

		roomID, err := c.ParamsInt("roomId")
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "invalid room id",
			})
		}

		// 멤버 확인
		var count int64
		s.db.Table("workspace_members").
			Where("workspace_id = ? AND user_id = ?", workspaceID, claims.UserID).
			Count(&count)
		if count == 0 {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
				"error": "not a member of this workspace",
			})
		}

		// 채팅방이 해당 워크스페이스에 속하는지 확인
		var roomCount int64
		s.db.Table("meetings").
			Where("id = ? AND workspace_id = ? AND type = ?", roomID, workspaceID, "CHAT_ROOM").
			Count(&roomCount)
		if roomCount == 0 {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
				"error": "chat room not found in this workspace",
			})
		}

		// 유저 정보 조회
		var user struct {
			Nickname string
		}
		s.db.Table("users").Select("nickname").Where("id = ?", claims.UserID).Scan(&user)

		c.Locals("roomId", int64(roomID))
		c.Locals("userId", claims.UserID)
		c.Locals("nickname", user.Nickname)

		return c.Next()
	}, websocket.New(s.chatWSHandler.HandleWebSocket, websocket.Config{
		ReadBufferSize:  4096,
		WriteBufferSize: 4096,
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
