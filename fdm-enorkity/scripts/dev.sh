#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Starting Go API from: ${ROOT}/go-backend"
(cd "${ROOT}/go-backend" && go run ./cmd/server) &
PID_GO=$!

cleanup() {
  kill "${PID_GO}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "Starting desktop (Vite) from: ${ROOT}/desktop"
(cd "${ROOT}/desktop" && npm run dev)
