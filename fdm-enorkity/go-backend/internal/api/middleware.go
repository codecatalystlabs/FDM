package api

import (
	"fdm-enorkity/internal/settings"

	"github.com/gofiber/fiber/v2"
)

func PairingGuard(st *settings.Store) fiber.Handler {
	return func(c *fiber.Ctx) error {
		tok := c.Get("X-FDM-Pairing-Token")
		if !st.VerifyPairingToken(tok) {
			return Fail(c, fiber.StatusUnauthorized, "Unauthorized", "invalid or missing pairing token")
		}
		return c.Next()
	}
}
