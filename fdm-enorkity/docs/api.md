# REST API — CatalystFDM

**Base URL (MVP):** `http://127.0.0.1:8765` (configurable via `APP_PORT` / `APP_HOST`).

**Binding:** `127.0.0.1` only.

## Response Envelope

**Success**

```json
{
  "success": true,
  "message": "Download added successfully",
  "data": {}
}
```

**Error**

```json
{
  "success": false,
  "message": "Failed to add download",
  "error": "clear error message"
}
```

## Browser Extension Auth

- Header: `X-FDM-Pairing-Token: <plaintext token>`  
- Token is created in the desktop app (Browser Integration) and stored as SHA-256 in `app_settings` (`pairing_token_hash`).  
- `POST /api/v1/browser/pair` registers/heartbeats a `browser_connections` row.

## Endpoints

### Health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/health` | Liveness |

### Downloads

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/downloads` | Body: `{ "url", "filename?", "referrer?", "source?", "category?", "exec_confirmed?" }` |
| GET | `/api/v1/downloads` | Query: `status`, `search`, pagination |
| GET | `/api/v1/downloads/:id` | Detail |
| POST | `/api/v1/downloads/:id/start` | Start or enqueue |
| POST | `/api/v1/downloads/:id/pause` | Pause |
| POST | `/api/v1/downloads/:id/resume` | Resume (Range if supported) |
| POST | `/api/v1/downloads/:id/cancel` | Cancel |
| POST | `/api/v1/downloads/:id/retry` | Reset failed → pending |
| DELETE | `/api/v1/downloads/:id` | Delete record |
| DELETE | `/api/v1/downloads/:id/file` | Delete file on disk + record optional |

### Queue

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/queue` | List queue items |
| POST | `/api/v1/queue/start-all` | |
| POST | `/api/v1/queue/pause-all` | |
| POST | `/api/v1/queue/retry-failed` | |
| POST | `/api/v1/queue/clear-completed` | |
| POST | `/api/v1/queue/:id/move-up` | `:id` = queue item id |
| POST | `/api/v1/queue/:id/move-down` | |

### Settings

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/settings` | Aggregated settings |
| PUT | `/api/v1/settings` | Partial update object |
| POST | `/api/v1/settings/generate-pairing-token` | Creates a new pairing token (plaintext returned once; hash stored) |
| GET | `/api/v1/settings/download-directory` | |
| PUT | `/api/v1/settings/download-directory` | `{ "path" }` |
| PUT | `/api/v1/settings/concurrency` | `{ "max_concurrent_downloads" }` |
| PUT | `/api/v1/settings/bandwidth-limit` | `{ "bytes_per_second": 0 }` unlimited |

### Browser

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/browser/pair` | `{ "browser_name", "extension_id" }` + pairing header |
| POST | `/api/v1/browser/add-download` | `{ "url", "referrer?", "page_title?", "title?", "thumbnail?", "site?", "skip_existing?" }` + media fields (`docs/media-engine.md`) + pairing header |
| GET | `/api/v1/browser/status` | |
| GET | `/api/v1/browser/connections` | |
| DELETE | `/api/v1/browser/connections/:id` | Revoke |

### Logs

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/logs` | Query: `level`, `download_id`, `limit` |
| GET | `/api/v1/logs/:download_id` | Logs for one download |

### Statistics

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/stats/summary` | Counts + totals |
| GET | `/api/v1/stats/download-speeds` | Recent speed samples (MVP: derived) |
| GET | `/api/v1/stats/categories` | Aggregates by category |

## Example cURL

```bash
curl -s http://127.0.0.1:8765/api/v1/health

curl -s -X POST http://127.0.0.1:8765/api/v1/downloads \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/file.zip","source":"curl"}'

curl -s "http://127.0.0.1:8765/api/v1/downloads?status=active"

curl -s -X POST "http://127.0.0.1:8765/api/v1/downloads/<id>/pause"
```

Extension example:

```bash
curl -s -X POST http://127.0.0.1:8765/api/v1/browser/add-download \
  -H "Content-Type: application/json" \
  -H "X-FDM-Pairing-Token: YOUR_TOKEN" \
  -d '{"url":"https://example.com/document.pdf"}'
```
