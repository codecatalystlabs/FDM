# Security & Compliance

## Principles

1. **Local-only API** — Listen on `127.0.0.1`; never `0.0.0.0` in default config.  
2. **HTTPS-only downloads** — `http` and `https` schemes only; reject `file:`, `javascript:`, etc.  
3. **URL validation** — Parse URL, enforce scheme, optional block of loopback and RFC1918 targets unless `allow_private_urls` is enabled in settings.  
4. **Path safety** — Sanitize filenames; reject `..`, absolute paths, and control characters.  
5. **Pairing** — One-click: the extension asks to connect, the app shows a 4-digit code with **Allow / Don't Allow**, and approving mints a token for that one browser (stored as SHA-256 on its `browser_connections` row). Disconnecting a browser clears its hash, so it is locked out at once while other browsers keep working. See "One-click pairing" below.  
6. **Executable handling** — Backend marks `requires_exec_confirm`; UI must set `exec_confirmed: true` (or dedicated confirm endpoint) before starting `.exe`, `.msi`, `.dmg`, `.sh`, `.AppImage`, etc.  
7. **No browsing history** — Extension does not upload page HTML or full link graphs; only user-selected or explicitly detected direct URLs.  
8. **CORS** — Restrict origins to extension IDs / `moz-extension:` patterns where applicable; MVP may use permissive localhost-only with token still required for browser routes.  
9. **Local-only guard** (`internal/api/middleware.go`) — every request must address `127.0.0.1`, `localhost` or `::1` in its `Host` header (defeats DNS rebinding), and any state-changing request that carries an `Origin` must come from an allowed origin. Browsers attach `Origin` to cross-site POSTs, including plain HTML form posts that CORS alone lets through, so a web page can no longer start downloads, open files or approve browsers. Requests without `Origin` (curl, native tools) still work.  
10. **Open / Show in folder** — `POST /downloads/:id/open` refuses file types that can run code (installers, scripts, launchers); those can only be shown in their folder.

## Out of Scope (Intentionally Not Built)

- DRM removal, HLS/DASH “rippers”, authenticated stream capture.  
- Paywall or authentication bypass.  
- CAPTCHA / anti-bot evasion.  
- Arbitrary code execution from remote pages in the download worker context beyond normal HTTP GET of allowed URLs.

## Threat Model (Local)

- **Web pages** the user visits can send requests to `127.0.0.1` — blocked by the local-only guard (Origin + Host checks) and CORS (they can't read responses).
- **Other browser extensions** with localhost permissions can call the API like the app can; they cannot approve their own pairing request (`/browser/pair/pending/:id/approve` rejects extension origins).
- **Other local processes** can do anything the user can, so they are out of scope.

## One-click pairing

1. Extension → `POST /api/v1/browser/pair/request` `{browser_name, extension_id}` → `{request_id (secret), code, expires_in}`.
2. App polls `GET /api/v1/browser/pair/pending` (never sees the secret) and shows the request with its code.
3. User clicks **Allow** → `POST /api/v1/browser/pair/pending/:id/approve` (app origins only) mints a 24-byte token, stores its SHA-256 on the browser's connection row.
4. Extension polls `GET /api/v1/browser/pair/request/:request_id` → `{status: pending|approved|denied|expired}`; the plaintext token is returned exactly once, then the request is gone.

Pending requests live in memory for 5 minutes (a restart cancels them), a second request from the same extension replaces the first, and at most 20 can wait at once. The old manual token (`POST /settings/generate-pairing-token`) still works for extensions older than 0.3; revoking a browser that used it also retires that shared token.

## Desktop embedded mode (`FDM_EMBEDDED=1`)

When the Go API is spawned by Tauri as a sidecar, CORS permits **webview / Tauri** origins (`tauri://`, `http://127.0.0.1`, etc.) so the packaged UI can call the API without a brittle custom protocol shim. Pairing-token rules for **`/api/v1/browser/*`** are unchanged. The embedded flag does **not** relax URL validation or open the listener beyond `APP_HOST`.
