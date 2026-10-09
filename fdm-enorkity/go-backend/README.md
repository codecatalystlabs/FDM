# FDM-Enorkity — Go backend

Local-only Fiber API + SQLite + download engine.

## Prerequisites

- Go 1.22+

## Setup

```bash
cp .env.example .env
go run ./cmd/server
```

Defaults:

- API: `http://127.0.0.1:8765`
- DB: `./storage/fdm.db`
- Downloads: `./storage/downloads`

## Pairing token (browser extension)

1. Call `POST /api/v1/settings/generate-pairing-token` (or use the desktop UI).
2. Paste the plaintext token into the extension popup.
3. Click **Register / refresh pairing** in the extension popup.

## Useful cURL

```bash
curl -s http://127.0.0.1:8765/api/v1/health

curl -s -X POST http://127.0.0.1:8765/api/v1/downloads ^
  -H "Content-Type: application/json" ^
  -d "{\"url\":\"https://example.com/file.zip\",\"source\":\"curl\"}"
```

(PowerShell users: use `curl.exe` or single-line JSON.)

## Build

```bash
go build -o bin/fdm-server ./cmd/server
```

## Tauri sidecar / embedded mode

When the desktop shell spawns this binary, it sets **`FDM_EMBEDDED=1`** and configures paths **only via environment variables** (no `.env` file on disk is required). Use this to point storage at the per-user app data folder.

- **`APP_HOST`** — must stay `127.0.0.1` in production.
- **`APP_PORT`** — must match `backend.json` managed by the desktop shell (default `8765`).

## Notes

- If you change models in development, delete `./storage/fdm.db` when SQLite migrations conflict (MVP uses AutoMigrate).
- The API binds to `127.0.0.1` only.

## SQLite on Windows (`CGO_ENABLED=0`)

The default `mattn/go-sqlite3` driver requires **CGO**. This project uses **`github.com/glebarez/sqlite`** (pure Go via `modernc.org/sqlite`) so `go run` / `go build` work when CGO is disabled (common on Windows).

`go.mod` includes a `replace` for `modernc.org/sqlite` so the resolved version builds cleanly on Windows. If you prefer the classic driver instead, install a C toolchain, set `CGO_ENABLED=1`, and switch back to `gorm.io/driver/sqlite`.
