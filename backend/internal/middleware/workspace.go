package middleware

import (
	"strconv"

	"realtime-backend/internal/auth"
	"realtime-backend/internal/service"

	"github.com/gofiber/fiber/v2"
)

// WorkspaceMiddleware 워크스페이스 권한 미들웨어
type WorkspaceMiddleware struct {
	memberService *service.MemberService
}

// NewWorkspaceMiddleware WorkspaceMiddleware 생성
func NewWorkspaceMiddleware(memberService *service.MemberService) *WorkspaceMiddleware {
	return &WorkspaceMiddleware{memberService: memberService}
}

// getWorkspaceIDFromContext URL에서 워크스페이스 ID 추출
func getWorkspaceIDFromContext(c *fiber.Ctx) (int64, error) {
	// 우선순위: :workspaceId > :id
	idStr := c.Params("workspaceId")
	if idStr == "" {
		idStr = c.Params("id")
	}
	if idStr == "" {
		return 0, fiber.NewError(fiber.StatusBadRequest, "workspace ID is required")
	}
	return strconv.ParseInt(idStr, 10, 64)
}

// RequireMembership 워크스페이스 멤버 필수
func (m *WorkspaceMiddleware) RequireMembership() fiber.Handler {
	return func(c *fiber.Ctx) error {
		claims, err := auth.GetClaimsFromContext(c)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"error": "unauthorized",
			})
		}

		workspaceID, err := getWorkspaceIDFromContext(c)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "invalid workspace ID",
			})
		}

		if !m.memberService.IsWorkspaceMember(workspaceID, claims.UserID) {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
				"error": "not a workspace member",
			})
		}

		// 워크스페이스 ID를 컨텍스트에 저장
		c.Locals("workspaceID", workspaceID)
		return c.Next()
	}
}

// RequireOwnership 워크스페이스 소유자 필수
func (m *WorkspaceMiddleware) RequireOwnership() fiber.Handler {
	return func(c *fiber.Ctx) error {
		claims, err := auth.GetClaimsFromContext(c)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"error": "unauthorized",
			})
		}

		workspaceID, err := getWorkspaceIDFromContext(c)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "invalid workspace ID",
			})
		}

		if !m.memberService.IsWorkspaceOwner(workspaceID, claims.UserID) {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
				"error": "owner permission required",
			})
		}

		c.Locals("workspaceID", workspaceID)
		return c.Next()
	}
}

// RequireMembershipOrOwner 워크스페이스 멤버 또는 소유자 필수
func (m *WorkspaceMiddleware) RequireMembershipOrOwner() fiber.Handler {
	return func(c *fiber.Ctx) error {
		claims, err := auth.GetClaimsFromContext(c)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"error": "unauthorized",
			})
		}

		workspaceID, err := getWorkspaceIDFromContext(c)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "invalid workspace ID",
			})
		}

		if !m.memberService.IsWorkspaceMemberOrOwner(workspaceID, claims.UserID) {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
				"error": "not a workspace member or owner",
			})
		}

		c.Locals("workspaceID", workspaceID)
		return c.Next()
	}
}

// RequirePermission 특정 권한 필수
func (m *WorkspaceMiddleware) RequirePermission(permissionCode string) fiber.Handler {
	return func(c *fiber.Ctx) error {
		claims, err := auth.GetClaimsFromContext(c)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"error": "unauthorized",
			})
		}

		workspaceID, err := getWorkspaceIDFromContext(c)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "invalid workspace ID",
			})
		}

		if !m.memberService.HasPermission(workspaceID, claims.UserID, permissionCode) {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
				"error": "permission denied: " + permissionCode,
			})
		}

		c.Locals("workspaceID", workspaceID)
		return c.Next()
	}
}
