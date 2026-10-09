#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Building Go server (Linux amd64)…"
(cd "${ROOT}/go-backend" && GOOS=linux GOARCH=amd64 go build -o "${ROOT}/dist/linux/fdm-server" ./cmd/server)

echo "Building desktop (Tauri)…"
(cd "${ROOT}/desktop" && npm ci && npm run tauri:build)
