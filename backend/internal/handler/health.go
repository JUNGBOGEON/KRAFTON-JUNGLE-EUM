package handler

import (
	"net"
	"time"

	"github.com/gofiber/fiber/v2"
	"gorm.io/gorm"
)

// HealthHandler 헬스체크 핸들러
type HealthHandler struct {
	db        *gorm.DB
	aiAddress string
}

// NewHealthHandler HealthHandler 생성
func NewHealthHandler(db *gorm.DB, aiAddress string) *HealthHandler {
	return &HealthHandler{db: db, aiAddress: aiAddress}
}

// ComponentCheck 컴포넌트 상태
type ComponentCheck struct {
	Status  string `json:"status"`
	Latency string `json:"latency,omitempty"`
	Error   string `json:"error,omitempty"`
}

// HealthResponse 헬스체크 응답
type HealthResponse struct {
	Status    string                    `json:"status"`
	Timestamp string                    `json:"timestamp"`
	Checks    map[string]ComponentCheck `json:"checks"`
}

// Check 전체 상태 확인 (DB + AI Server)
func (h *HealthHandler) Check(c *fiber.Ctx) error {
	response := HealthResponse{
		Status:    "healthy",
		Timestamp: time.Now().Format(time.RFC3339),
		Checks:    make(map[string]ComponentCheck),
	}

	// 1. Database 체크
	dbStart := time.Now()
	sqlDB, err := h.db.DB()
	if err != nil {
		response.Status = "unhealthy"
		response.Checks["database"] = ComponentCheck{
			Status: "unhealthy",
			Error:  "failed to get database connection",
		}
	} else if err := sqlDB.Ping(); err != nil {
		response.Status = "unhealthy"
		response.Checks["database"] = ComponentCheck{
			Status: "unhealthy",
			Error:  "database ping failed",
		}
	} else {
		response.Checks["database"] = ComponentCheck{
			Status:  "healthy",
			Latency: time.Since(dbStart).String(),
		}
	}

	// 2. AI Server 체크 (gRPC 연결 확인)
	if h.aiAddress != "" {
		aiStart := time.Now()
		conn, err := net.DialTimeout("tcp", h.aiAddress, 2*time.Second)
		if err != nil {
			response.Checks["ai_server"] = ComponentCheck{
				Status: "degraded",
				Error:  "AI server unreachable",
			}
		} else {
			conn.Close()
			response.Checks["ai_server"] = ComponentCheck{
				Status:  "healthy",
				Latency: time.Since(aiStart).String(),
			}
		}
	} else {
		response.Checks["ai_server"] = ComponentCheck{
			Status: "not_configured",
		}
	}

	statusCode := fiber.StatusOK
	if response.Status == "unhealthy" {
		statusCode = fiber.StatusServiceUnavailable
	}

	return c.Status(statusCode).JSON(response)
}

// Liveness K8s liveness probe용 (단순 체크)
func (h *HealthHandler) Liveness(c *fiber.Ctx) error {
	return c.SendString("OK")
}

// Readiness K8s readiness probe용 (DB 연결 체크)
func (h *HealthHandler) Readiness(c *fiber.Ctx) error {
	sqlDB, err := h.db.DB()
	if err != nil {
		return c.Status(fiber.StatusServiceUnavailable).SendString("NOT READY")
	}
	if err := sqlDB.Ping(); err != nil {
		return c.Status(fiber.StatusServiceUnavailable).SendString("NOT READY")
	}
	return c.SendString("READY")
}
