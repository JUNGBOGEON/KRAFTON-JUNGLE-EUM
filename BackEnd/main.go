package main

import (
	"log"

	"video-call-backend/config"
	"video-call-backend/handlers"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/joho/godotenv"
)

func main() {
	// Load .env file if exists
	godotenv.Load()

	// Load configuration
	cfg := config.Load()

	// Create Fiber app
	app := fiber.New(fiber.Config{
		AppName:        "Video Call Backend",
		ReadBufferSize: 16 * 1024, // Increase buffer size to 16KB to avoid 431 errors
	})

	// Middleware
	app.Use(logger.New())
	app.Use(recover.New()) // Add Recover Middleware
	app.Use(cors.New(cors.Config{
		AllowOrigins: "http://localhost:3000, http://127.0.0.1:3000",
		AllowMethods: "GET,POST,PUT,DELETE,OPTIONS",
		AllowHeaders: "Origin, Content-Type, Accept, Authorization",
	}))

	// Initialize handlers
	roomHandler := handlers.NewRoomHandler(cfg)

	// API routes
	api := app.Group("/api")
	api.Post("/token", roomHandler.GenerateToken)
	api.Get("/rooms", roomHandler.GetRooms)

	// Health check
	app.Get("/health", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{
			"status": "ok",
		})
	})

	// Start server
	log.Printf("🚀 Server starting on port %s", cfg.Port)
	log.Printf("📡 LiveKit Host: %s", cfg.LiveKitHost)
	log.Fatal(app.Listen(":" + cfg.Port))
}
