package api

import (
	"net"
	"strings"

	"fdm-enorkity/internal/browser"

	"github.com/gofiber/fiber/v2"
)

// PairingGuard admits requests carrying a token from an approved browser.
func PairingGuard(br *browser.Service) fiber.Handler {
	return func(c *fiber.Ctx) error {
		if !br.Authorize(c.Get("X-FDM-Pairing-Token"), c.Get("X-FDM-Extension-Id")) {
			return Fail(c, fiber.StatusUnauthorized, "Unauthorized", "invalid or missing pairing token")
		}
		return c.Next()
	}
}

// ===== LOCAL-ONLY GUARD =====
// The API listens on 127.0.0.1, but every web page the user visits can still send requests to
// it. Two checks close that door:
//   - The Host header must name the loopback interface. This defeats DNS rebinding, where a
//     page on evil.example re-points its own name at 127.0.0.1 to become "same-origin".
//   - A request that changes state must come from an allowed origin (the app, an extension) or
//     carry no Origin at all (curl, native tools). Browsers always attach Origin to cross-site
//     POSTs, including plain HTML form posts that CORS alone would let through.

// LocalGuard enforces both checks. extraHosts are additional host names that may address the
// API (for example a non-loopback APP_HOST the user chose on purpose).
func LocalGuard(allowOrigin func(string) bool, extraHosts ...string) fiber.Handler {
	allowed := map[string]bool{"127.0.0.1": true, "localhost": true, "::1": true}
	for _, h := range extraHosts {
		h = strings.ToLower(strings.TrimSpace(h))
		if h != "" && h != "0.0.0.0" && h != "::" {
			allowed[h] = true
		}
	}
	return func(c *fiber.Ctx) error {
		if !allowed[hostOnly(string(c.Request().Host()))] {
			return Fail(c, fiber.StatusForbidden, "Forbidden", "requests must address 127.0.0.1 or localhost")
		}
		origin := c.Get(fiber.HeaderOrigin)
		// Extensions get only the routes made for them; the library, settings and approving
		// browsers belong to the app. (Any extension with localhost access sends this Origin.)
		if isExtensionOrigin(origin) && c.Method() != fiber.MethodOptions && !extensionRoute(c.Path()) {
			return Fail(c, fiber.StatusForbidden, "Forbidden", "this route is for the CatalystFDM app only")
		}
		switch c.Method() {
		case fiber.MethodGet, fiber.MethodHead, fiber.MethodOptions:
			return c.Next()
		}
		if origin != "" && !allowOrigin(origin) {
			return Fail(c, fiber.StatusForbidden, "Forbidden", "origin not allowed")
		}
		return c.Next()
	}
}

func hostOnly(hostport string) string {
	h := hostport
	if host, _, err := net.SplitHostPort(hostport); err == nil {
		h = host
	}
	return strings.ToLower(strings.Trim(h, "[]"))
}

// extensionRoutes are the API routes a browser extension may call.
var extensionRoutes = map[string]bool{
	"/api/v1/health":               true,
	"/api/v1/browser/status":       true,
	"/api/v1/browser/me":           true,
	"/api/v1/browser/pair":         true, // legacy manual token
	"/api/v1/browser/pair/request": true,
	"/api/v1/browser/inspect":      true,
	"/api/v1/browser/add-download": true,
}

func extensionRoute(path string) bool {
	path = strings.TrimSuffix(path, "/")
	return extensionRoutes[path] || strings.HasPrefix(path, "/api/v1/browser/pair/request/")
}

func isExtensionOrigin(origin string) bool {
	for _, p := range []string{"chrome-extension://", "moz-extension://", "safari-web-extension://"} {
		if strings.HasPrefix(origin, p) {
			return true
		}
	}
	return false
}
