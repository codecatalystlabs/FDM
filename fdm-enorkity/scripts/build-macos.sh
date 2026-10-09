#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Building Go server (macOS arm64)…"
(cd "${ROOT}/go-backend" && GOOS=darwin GOARCH=arm64 go build -o "${ROOT}/dist/macos/fdm-server" ./cmd/server)

echo "Building desktop (Tauri)…"
(cd "${ROOT}/desktop" && npm ci && npm run tauri:build)
