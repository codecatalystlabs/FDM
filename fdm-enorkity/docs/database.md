# Database Schema (SQLite)

All tables map to GORM models in `go-backend/internal/models`. Auto-migration runs on startup for development; `migrations/` holds SQL references for production discipline.

## Entity Relationships

- **Download** 1—N **DownloadChunk** (optional multi-chunk mode)  
- **Download** 1—N **DownloadLog**  
- **QueueItem** N—1 **Download** (one queue row per download)  
- **Download** may reference **DownloadCategory** by name/slug (string field `category` on download for MVP simplicity)

## Tables

### `downloads`

| Column | Type | Notes |
|--------|------|--------|
| id | TEXT (UUID) | PK |
| url | TEXT | Original URL |
| final_url | TEXT | After redirects |
| filename | TEXT | Sanitized display/final name |
| original_filename | TEXT | From Content-Disposition or URL |
| file_path | TEXT | Final path when complete |
| temp_file_path | TEXT | `.part` path while in progress |
| file_size | INTEGER | -1 if unknown |
| downloaded_bytes | INTEGER | |
| status | TEXT | pending, queued, active, paused, completed, failed, cancelled |
| category | TEXT | documents, archives, ... |
| mime_type | TEXT | |
| extension | TEXT | file extension without dot |
| speed_bytes_per_second | INTEGER | rolling / snapshot |
| eta_seconds | INTEGER | |
| progress_percent | REAL | 0–100 |
| supports_resume | BOOLEAN | server advertised Range |
| checksum | TEXT | optional future |
| error_message | TEXT | |
| source | TEXT | ui, browser, api |
| referrer | TEXT | optional; extension may omit |
| requires_exec_confirm | BOOLEAN | set when URL looks like executable |
| exec_confirmed | BOOLEAN | user acknowledged |
| created_at, updated_at, started_at, completed_at, paused_at, cancelled_at | DATETIME | |

### `download_chunks`

| Column | Type |
|--------|------|
| id | TEXT UUID |
| download_id | TEXT FK |
| chunk_index | INTEGER |
| start_byte, end_byte | INTEGER |
| downloaded_bytes | INTEGER |
| status | TEXT |
| temp_file_path | TEXT |
| created_at, updated_at | DATETIME |

### `download_categories`

| Column | Type |
|--------|------|
| id | TEXT UUID |
| name | TEXT |
| extensions | TEXT | JSON array of extensions |
| default_directory | TEXT |
| created_at, updated_at | DATETIME |

### `app_settings`

| Column | Type |
|--------|------|
| id | TEXT UUID |
| key | TEXT UNIQUE |
| value | TEXT |
| value_type | TEXT | string, int, bool, json |
| description | TEXT |
| created_at, updated_at | DATETIME |

Keys include: `download_directory`, `max_concurrent_downloads`, `chunk_size_bytes`, `bandwidth_limit_bps`, `theme`, `allow_private_urls`, `pairing_token_hash`, etc.

### `browser_connections`

| Column | Type |
|--------|------|
| id | TEXT UUID |
| browser_name | TEXT |
| extension_id | TEXT |
| pairing_token_hash | TEXT | SHA-256 hex of issued token |
| status | TEXT | active, revoked |
| last_seen_at | DATETIME |
| created_at, updated_at | DATETIME |

### `download_logs`

| Column | Type |
|--------|------|
| id | TEXT UUID |
| download_id | TEXT FK |
| level | TEXT | info, warn, error |
| message | TEXT |
| details | TEXT | JSON |
| created_at | DATETIME |

### `queue_items`

| Column | Type |
|--------|------|
| id | TEXT UUID |
| download_id | TEXT UNIQUE FK |
| priority | INTEGER | higher first |
| position | INTEGER | ordering within status bucket |
| status | TEXT | mirrors download lifecycle for queue ops |
| created_at, updated_at | DATETIME |
