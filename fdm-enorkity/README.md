# FDM-Enorkity

Professional, **local-first** download manager:

- **Go + Fiber + GORM + SQLite** download engine and REST API (**127.0.0.1** only)
- **Tauri + React + TypeScript + Tailwind** desktop UI
- Packaged **`tauri build`** launches the Go API as an **embedded sidecar** (release builds)
- **WebExtension** helpers for Chrome / Edge / Firefox to send **direct** `http/https` URLs with a **pairing token**

This repository intentionally avoids features that bypass DRM, paywalls, authentication, anti-bot systems, or protected streaming.

## Prerequisites

| What | Why |
|------|-----|
| **Go 1.22+** | `go-backend` and `npm run build:go-sidecar` |
| **Node.js + npm** | Vite UI and Tauri CLI |
| **Rust + Cargo** | **`tauri dev`**, **`tauri build`**, and matching the sidecar triple to your toolchain |

If you see **`failed to get cargo metadata: program not found`**, install Rust: [https://rustup.rs/](https://rustup.rs/).  
Open a **new** terminal after installation so **`cargo`** and **`rustc`** are on `PATH`. On Windows, the default host triple is usually **`x86_64-pc-windows-msvc`**.

You can still run **`npm run dev`** (browser-only UI + manual Go API) **without** Rust.

## Repository layout

- `go-backend/` — API + engine
- `desktop/` — Tauri shell + React UI
- `extension/` — browser extension sources
- `docs/` — architecture + contracts
- `scripts/` — optional root helpers (`.sh`)

## Development (recommended day-to-day)

### 1) Run the Go API yourself

Flexible while you hack on the engine:

```powershell
cd fdm-enorkity/go-backend
Copy-Item .env.example .env   # first time only
go run ./cmd/server
```

### 2) Run only the UI (browser)

```powershell
cd fdm-enorkity/desktop
npm install
npm run dev
```

Open Vite’s URL. Optional: set `VITE_API_BASE` in `desktop/.env` if the API is not on `http://127.0.0.1:8765`.

### 3) Tauri window in development

Requires **Rust/Cargo on PATH** (see Prerequisites).

```powershell
cd fdm-enorkity/desktop
npm run tauri:dev
```

**Debug behavior:** the desktop shell **does not** auto-start the Go sidecar (`debug_assertions`), so continue running `go run ./cmd/server` in parallel.

- To **test sidecar spawning** from a debug Tauri build:  
  `set FDM_FORCE_SIDECAR=1` (PowerShell: `$env:FDM_FORCE_SIDECAR='1'`) before `npm run tauri:dev` (requires a prior `npm run build:go-sidecar`).

## Production-shaped desktop build (`tauri build`)

1. Produce the Go binary with the Rust host triple name:

   ```powershell
   cd fdm-enorkity/desktop
   npm run build:go-sidecar
   ```

   If `rustc` is not on `PATH`, set `FDM_SIDECAR_HOST_TRIPLE` (e.g. `x86_64-pc-windows-msvc`).

2. Build Tauri:

   ```powershell
   npm run tauri:build
   ```

   For **offline / bundled WebView2** on Windows, use `npm run tauri:build:offline-webview` instead **after** you extract the Microsoft WebView2 **Fixed Runtime** into `desktop/src-tauri/webview2-runtime/` (see that folder’s `README.md`). The default `tauri:build` relies on the normal WebView2 runtime already on the user’s PC.

Release builds **start** `fdm-enorkity-server` on launch (`FDM_EMBEDDED=1`, data under the app **data/config** dirs) and **kill** it on exit. Override with:

- **`FDM_SKIP_SIDECAR=1`** — do not spawn/kill managed sidecar (advanced).

The UI resolves `http://127.0.0.1:<port>` via **`get_api_base_url`** (`backend.json`; default port **8765**). Keep the browser extension popup URL in sync.

> Bundling is on so the sidecar ships with the app. **Installer signing / store “final” packaging is intentionally not in scope yet**—these are smoke-test-ready artifacts.

## Browser extension

- Chrome/Edge: load unpacked `fdm-enorkity/extension/chrome`
- Firefox: temporary add-on → `extension/firefox/manifest.json`

Flow: Desktop **Browser** page → generate pairing token → extension popup (**Register / refresh pairing**) → context menu on direct links.

See `POST /api/v1/settings/generate-pairing-token` — server stores **SHA-256** only.

## Documentation

See `docs/architecture.md`, `docs/api.md`, `docs/security.md`, `docs/packaging.md` (sidecar details), and the other topic files.
