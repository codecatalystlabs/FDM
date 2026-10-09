#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Building Go server (Windows amd64)…"
(cd "${ROOT}/go-backend" && GOOS=windows GOARCH=amd64 go build -o "${ROOT}/dist/windows/fdm-server.exe" ./cmd/server)

echo "Building desktop (Tauri)…"
(cd "${ROOT}/desktop" && npm ci && npm run tauri:build)

echo "Artifacts under ${ROOT}/dist and ${ROOT}/desktop/src-tauri/target."
