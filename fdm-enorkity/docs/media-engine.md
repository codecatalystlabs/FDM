# Media engine (streaming sites + quality selection)

FDM has two download engines:

| Engine  | Used for | How |
|---------|----------|-----|
| `http`  | Direct file URLs (`.zip`, `.mp4` on a CDN, …) | Native Go downloader (Range resume, Referer) |
| `media` | Pages on streaming sites (YouTube, Vimeo, X, TikTok, Facebook, SoundCloud, HLS `.m3u8`, ~1800 sites) | [yt-dlp](https://github.com/yt-dlp/yt-dlp) + ffmpeg, run as a child process |

Out of scope by design: DRM (Widevine/FairPlay/PlayReady) decryption, paywall or login bypass. With the opt-in
`media_cookies_browser` setting, yt-dlp may reuse the user's **own** browser login for content that account can
already watch. DRM-protected media is detected and reported as `drm: true` / a clear error, never downloaded.

## Binaries

- `YTDLP_PATH` (env) → else `yt-dlp` on `PATH` → else `<STORAGE_ROOT>/bin/yt-dlp`
- `FFMPEG_PATH` (env) → else `ffmpeg` on `PATH` (needed to merge video+audio and convert audio)

## API

### `GET /api/v1/media/status`

```json
{ "available": true, "version": "2026.08.19", "ffmpeg": true, "cookies_browser": "" }
```

### `POST /api/v1/inspect` — body `{ "url": "...", "referrer": "" }`

Also available to the extension as `POST /api/v1/browser/inspect` (requires `X-FDM-Pairing-Token`).
Decides whether a URL is a direct file or a media page and returns what the UI needs to offer a choice.

```jsonc
{
  "kind": "direct" | "media",
  "url": "https://…",            // URL to pass back to add-download
  "title": "Big Buck Bunny",     // video title (media) or filename (direct)
  "filename": "Big Buck Bunny",  // suggested base filename (no extension for media)
  "thumbnail": "https://…",      // "" when unknown
  "duration_seconds": 635,       // 0 when unknown / direct
  "uploader": "Blender",
  "site": "YouTube",             // extractor name, or host for direct files
  "mime_type": "video/mp4",      // direct only
  "size_bytes": 7885982,         // direct only, -1 unknown
  "is_live": false,
  "drm": false,
  "options": [                   // media only; ordered best → worst, video first then audio
    {
      "id": "v2160",             // opaque: pass back as quality_id
      "kind": "video",           // "video" | "audio"
      "label": "4K",             // short chip label: "4K", "1440p", "1080p", "720p", "Best", "MP3", "M4A"
      "detail": "2160p · 60 fps · VP9",
      "height": 2160,
      "fps": 60,
      "ext": "mp4",              // expected output container
      "size_bytes": 1372540000,  // estimate, -1 unknown
      "recommended": false       // exactly one option is recommended (1080p or the best below it)
    }
  ]
}
```

Errors use the normal envelope with HTTP 422 and a human message in `error`, e.g.
`"This video is DRM-protected; CatalystFDM does not download DRM content."`,
`"Media engine unavailable: yt-dlp not found"`, `"Unsupported URL"`.

### `POST /api/v1/downloads` (and `POST /api/v1/browser/add-download`)

Existing body plus optional media fields:

```jsonc
{
  "url": "https://www.youtube.com/watch?v=…",
  "engine": "media",             // "http" (default) | "media"
  "quality_id": "v1080",         // from inspect options; default "best"
  "filename": "My video",        // optional base name override
  "title": "…", "thumbnail": "…", "site": "YouTube", "duration_seconds": 635,
  "size_bytes": 257000000        // optional estimate from the chosen option, shown until real size is known
}
```

`skip_existing` (optional, both add routes): when a download with the same name (`filename`, else `page_title`; media:
`filename`, `title`, `page_title`) is already queued, running, paused, or finished with its file still on disk, the
engine returns that download with `"skipped": true` instead of adding a duplicate, and does not start or resume it.
Failed and cancelled downloads don't count. The extension sets it for Muno Watch series.

Direct (`http`) downloads also keep the optional `title`, `thumbnail`, `site` and `duration_seconds`, so the library
shows a browser-supplied title and poster (the Muno Watch episode tiles).

### Download object — new fields

```jsonc
{
  "engine": "media",
  "quality_id": "v1080",
  "quality_label": "1080p",
  "title": "Big Buck Bunny…",
  "thumbnail": "https://…",
  "site": "YouTube",
  "duration_seconds": 635,
  "stage": "Downloading video" // human stage for media downloads: "Starting", "Downloading video",
                               // "Downloading audio", "Merging", "Converting audio", "" when idle
}
```

Pause / resume / cancel / retry work the same for both engines (`media` resumes yt-dlp `.part` files).

### Settings

`media_cookies_browser`: `""` (off, default) | `"chrome"` | `"chromium"` | `"brave"` | `"edge"` | `"firefox"`,
read via `GET /api/v1/settings` and written via `PUT /api/v1/settings` like other keys.

`preferred_quality`: `""` (smart default: 1080p or the best below it) | `"best"` | `"v2160"` | `"v1440"` | `"v1080"` |
`"v720"` | `"v480"` | `"v360"` | `"a-mp3"` | `"a-m4a"`. Inspect marks the matching option `recommended`, so the app and
the browser button both pre-select it; a resolution the video lacks falls back to the best one below it.

`media_embed_metadata` (default `true`): adds `--embed-metadata --embed-thumbnail` (and `--embed-chapters` for video), so
files carry their title, artist and cover art. `media_subtitles` (default `false`): adds `--embed-subs --sub-langs en.*,en`
for video downloads that have English subtitles.

## Playlists and channels

A playlist or channel URL (`youtube.com/playlist?list=…`, `youtube.com/@name/videos`) inspects as `kind: "playlist"`:
listed flat in one request (up to 500 entries) with `entries: [{url, title, thumbnail, duration_seconds, uploader}]`, and
`options` are presets applied to every video (`best`, `v1080`, `v720`, `v480`, `v360`, `a-mp3`, `a-m4a`, no sizes). The app
estimates total size from the selected videos' length and adds one media download per entry; the queue then runs them
`max_concurrent_downloads` at a time. A watch URL that also carries `&list=` is treated as the single video.

## Automatic retries

Streaming sites hand out short-lived format URLs and occasionally refuse one (YouTube answers some requests with 403). A media
download that fails with a temporary error (HTTP 403/429/5xx, timeouts, dropped connections) is re-run up to 3 times with a
short back-off; each run fetches fresh URLs and resumes the `.part` files. The stage shows `Retrying (2 of 3)` meanwhile.
DRM, removed and private videos fail straight away.

## Finished files

- `POST /api/v1/downloads/:id/open` opens the file with the default app (refused for installers and scripts).
- `POST /api/v1/downloads/:id/reveal` shows it in the file manager.
- `GET /api/v1/downloads/:id/stream` serves video, audio and images with byte ranges for the in-app player (Quick Look).
- `GET /api/v1/downloads/:id/poster` returns a JPEG frame for finished videos without a site thumbnail (rendered once with
  ffmpeg and cached under `<STORAGE_ROOT>/posters`); it also fills in `duration_seconds` when that was unknown.

## Keeping yt-dlp current

`POST /api/v1/media/update` runs yt-dlp's own updater (`yt-dlp --update`, signed GitHub releases) and returns
`{before, after, updated, output}`. Installs managed by pip or a package manager report that in `error` instead.
Settings → Engine → **Update** calls it.

## Night data

`POST /api/v1/downloads` (and `/browser/add-download`) accept `"when": "night"`: the download waits, paused, until the
night window (`night_start` / `night_end`, local `HH:MM`, default `00:00`–`06:00`) opens, runs inside it, and pauses
again with `start_after` set to the next opening if the window closes first. `night_only` and `start_after` appear on the
download object. `POST /api/v1/downloads/:id/start-now` drops the schedule; `POST /api/v1/downloads/:id/tonight`
schedules an existing download. A 30-second ticker in the engine does the starting and pausing (`downloads/night.go`).
