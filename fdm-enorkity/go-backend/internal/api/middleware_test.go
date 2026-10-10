package api

import (
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"
)

func TestLocalGuard(t *testing.T) {
	app := fiber.New()
	app.Use(LocalGuard(func(o string) bool {
		return o == "http://127.0.0.1:5173" || strings.HasPrefix(o, "chrome-extension://")
	}))
	app.All("/x", func(c *fiber.Ctx) error { return c.SendString("ok") })
	app.All("/api/v1/*", func(c *fiber.Ctx) error { return c.SendString("ok") })

	cases := []struct {
		name, method, host, origin string
		want                       int
		path                       string
	}{
		{"app post", "POST", "127.0.0.1:8765", "http://127.0.0.1:5173", 200, ""},
		{"extension post", "POST", "127.0.0.1:8765", "chrome-extension://abc", 403, ""},
		{"extension add-download", "POST", "127.0.0.1:8765", "chrome-extension://abc", 200, "/api/v1/browser/add-download"},
		{"extension claims its token", "GET", "127.0.0.1:8765", "moz-extension://abc", 200, "/api/v1/browser/pair/request/0123"},
		{"extension reads library", "GET", "127.0.0.1:8765", "chrome-extension://abc", 403, "/api/v1/downloads"},
		{"extension approves itself", "POST", "127.0.0.1:8765", "chrome-extension://abc", 403, "/api/v1/browser/pair/pending/1/approve"},
		{"extension lists browsers", "GET", "127.0.0.1:8765", "chrome-extension://abc", 403, "/api/v1/browser/connections"},
		{"app reads library", "GET", "127.0.0.1:8765", "http://127.0.0.1:5173", 200, "/api/v1/downloads"},
		{"curl post", "POST", "127.0.0.1:8765", "", 200, ""},
		{"localhost name", "POST", "localhost:8765", "", 200, ""},
		{"ipv6 loopback", "GET", "[::1]:8765", "", 200, ""},
		{"website form post", "POST", "127.0.0.1:8765", "https://evil.example", 403, ""},
		{"sandboxed iframe", "POST", "127.0.0.1:8765", "null", 403, ""},
		{"website get is readable only via CORS", "GET", "127.0.0.1:8765", "https://evil.example", 200, ""},
		{"dns rebinding", "GET", "evil.example:8765", "", 403, ""},
		{"dns rebinding post", "POST", "evil.example:8765", "http://evil.example:8765", 403, ""},
	}
	for _, tc := range cases {
		path := tc.path
		if path == "" {
			path = "/x"
		}
		req := httptest.NewRequest(tc.method, path, nil)
		req.Host = tc.host
		if tc.origin != "" {
			req.Header.Set("Origin", tc.origin)
		}
		resp, err := app.Test(req)
		if err != nil {
			t.Fatal(err)
		}
		if resp.StatusCode != tc.want {
			t.Errorf("%s: status %d, want %d", tc.name, resp.StatusCode, tc.want)
		}
	}
}
