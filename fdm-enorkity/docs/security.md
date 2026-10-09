# Security & Compliance

## Principles

1. **Local-only API** — Listen on `127.0.0.1`; never `0.0.0.0` in default config.  
2. **HTTPS-only downloads** — `http` and `https` schemes only; reject `file:`, `javascript:`, etc.  
3. **URL validation** — Parse URL, enforce scheme, optional block of loopback and RFC1918 targets unless `allow_private_urls` is enabled in settings.  
4. **Path safety** — Sanitize filenames; reject `..`, absolute paths, and control characters.  
5. **Pairing token** — Random token shown once in UI; stored as SHA-256; constant-time compare for extension requests.  
6. **Executable handling** — Backend marks `requires_exec_confirm`; UI must set `exec_confirmed: true` (or dedicated confirm endpoint) before starting `.exe`, `.msi`, `.dmg`, `.sh`, `.AppImage`, etc.  
7. **No browsing history** — Extension does not upload page HTML or full link graphs; only user-selected or explicitly detected direct URLs.  
8. **CORS** — Restrict origins to extension IDs / `moz-extension:` patterns where applicable; MVP may use permissive localhost-only with token still required for browser routes.

## Out of Scope (Intentionally Not Built)

- DRM removal, HLS/DASH “rippers”, authenticated stream capture.  
- Paywall or authentication bypass.  
- CAPTCHA / anti-bot evasion.  
- Arbitrary code execution from remote pages in the download worker context beyond normal HTTP GET of allowed URLs.

## Threat Model (Local)

Attacker on same machine could call localhost without token if they guess port — **mitigation**: pairing token for browser routes; UI can use same token or localhost-only session (future). Users should treat pairing token like a local password.

## Desktop embedded mode (`FDM_EMBEDDED=1`)

When the Go API is spawned by Tauri as a sidecar, CORS permits **webview / Tauri** origins (`tauri://`, `http://127.0.0.1`, etc.) so the packaged UI can call the API without a brittle custom protocol shim. Pairing-token rules for **`/api/v1/browser/*`** are unchanged. The embedded flag does **not** relax URL validation or open the listener beyond `APP_HOST`.
