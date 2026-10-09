# Packaging

## Go backend (standalone)

- `go build -o bin/fdm-enorkity-server ./cmd/server` (from `go-backend/`)  
- Cross-compile with `GOOS` / `GOARCH` as needed.

For **Tauri**, the Go binary is emitted as a **sidecar** next to the Rust app (see below).

## Desktop: Tauri sidecar (Go `externalBin`)

1. **Naming** — Tauri resolves `bundle.externalBin: ["binaries/fdm-enorkity-server"]` to a file:

   `src-tauri/binaries/fdm-enorkity-server-<rustc-host-triple>` (`.exe` on Windows).

2. **Build script** — From `desktop/`:

   ```bash
   npm run build:go-sidecar
   ```

   This runs `scripts/build-go-sidecar.mjs`, which:
   - resolves the host triple from `rustc -vV`, or `FDM_SIDECAR_HOST_TRIPLE`, or a `go env` fallback,
   - invokes `go build` in `../go-backend/` with `-o` pointing at `src-tauri/binaries/…`.

3. **Tauri build** — `beforeBuildCommand` in `tauri.conf.json` runs `npm run build && npm run build:go-sidecar`, then compiles Rust. The CLI copies the sidecar into the app bundle.

4. **Development vs production**
   - **`npm run tauri:dev`** — Rust **debug** profile: the shell **skips** spawning the sidecar unless `FDM_FORCE_SIDECAR=1`. Run Go manually.
   - **`cargo tauri build` / `npm run tauri:build`** — Rust **release**: the shell **starts** the sidecar on launch and **kills** it on exit unless `FDM_SKIP_SIDECAR=1`.

5. **Bundle / installers**
   - Bundling is **enabled** (`bundle.active: true`) so the sidecar is embedded with the app.  
   - **Default Windows build** — `npm run tauri:build` uses the normal Tauri WebView2 install strategy (requires a working WebView2 runtime on the machine, usually already present on Windows 11 / recent Windows 10).
   - **Offline / self-contained WebView2** — use `npm run tauri:build:offline-webview`, which applies `desktop/src-tauri/tauri.fixedruntime.conf.json` (`webviewInstallMode = fixedRuntime`). You **must** place the **full** extracted Microsoft Edge WebView2 **Fixed Version** runtime under `desktop/src-tauri/webview2-runtime/` before building. An empty or partial folder often produces an installer that **installs but the app exits immediately** with no visible window.
   - **Code signing, store submission, and “final” installer polish are not part of this milestone**—expect unsigned artifacts suitable for internal testing.

## Prerequisites

- Rust toolchain + **Tauri prerequisites** for the target OS.  
- Go 1.22+ for `build:go-sidecar`.  
- On Windows, MSVC toolchain is typical (`x86_64-pc-windows-msvc` triple).

### Troubleshooting

| Symptom | Meaning |
|---------|---------|
| `failed to get cargo metadata: program not found` | **Cargo/Rust is not installed** or not on `PATH`. Install via [rustup.rs](https://rustup.rs/) and restart the terminal. **`npm run tauri:dev`** and **`tauri build`** always need Rust. |
| `Cannot resolve Rust-style target triple…` | Rare if **Node** fallback is present; set **`FDM_SIDECAR_HOST_TRIPLE`** to your `rustc -vV` **host** line, or ensure **Go** is on `PATH`. |
| Installed app **never opens** / exits instantly | Often **incomplete `fixedRuntime`**: only use `npm run tauri:build:offline-webview` after populating `webview2-runtime/`, or ship with **`npm run tauri:build`** instead. Check `%TEMP%`: `fdm-enorkity-startup-error.txt` (setup), `fdm-enorkity-panic.txt` (crash), `fdm-enorkity-launch.log` (process reached `main`). A message box may appear for setup/build failures and panics. |

## Extension

- Zip `extension/chrome` / `extension/firefox` for store packaging (future).

## Scripts

`scripts/build-*.sh` in the repo root are optional; the **authoritative** sidecar build for Tauri is `desktop/scripts/build-go-sidecar.mjs`.
