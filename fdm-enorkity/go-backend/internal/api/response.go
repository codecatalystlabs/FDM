package api

import "github.com/gofiber/fiber/v2"

func OK(c *fiber.Ctx, message string, data any) error {
	return c.JSON(fiber.Map{
		"success": true,
		"message": message,
		"data":    data,
	})
}

func Fail(c *fiber.Ctx, status int, message, err string) error {
	return c.Status(status).JSON(fiber.Map{
		"success": false,
		"message": message,
		"error":   err,
	})
}
