This directory holds the Go API binary bundled as a **Tauri sidecar**.

## Naming

Tauri resolves `bundle.externalBin: ["binaries/fdm-enorkity-server"]` to a file named:

`fdm-enorkity-server-<rustc-host-triple>` (plus `.exe` on Windows),

for example `fdm-enorkity-server-x86_64-pc-windows-msvc.exe`.

## Build

Run from `desktop/`:

```bash
npm run build:go-sidecar
```

This is wired into `npm run tauri build` via `beforeBuildCommand` (see `tauri.conf.json`).

Do not commit the built binaries (`*.exe`, target-prefixed files); regenerate them locally or in CI before packaging.
