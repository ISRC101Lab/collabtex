#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="${DATA_DIR:-$ROOT_DIR/collabtex-data}"
WEB_PORT="${WEB_PORT:-3080}"
WS_PORT="${WS_PORT:-3081}"
WEB_HOST="${WEB_HOST:-0.0.0.0}"
WS_HOST="${WS_HOST:-0.0.0.0}"
INIT_PASSWORD="${INIT_PASSWORD:-ChangeMe!2026}"
OPEN_ACCESS="${OPEN_ACCESS:-0}"

mkdir -p "$DATA_DIR"

cd "$ROOT_DIR"

if [[ ! -d node_modules ]]; then
  npm install
fi

npm run build

# Restrict newly created files (especially under DATA_DIR) to the current user.
umask 077

if [[ -f "$DATA_DIR/server.pid" ]] && kill -0 "$(cat "$DATA_DIR/server.pid")" 2>/dev/null; then
  echo "CollabTeX already running (pid $(cat "$DATA_DIR/server.pid"))."
  exit 0
fi

nohup env \
  DATA_DIR="$DATA_DIR" \
  WEB_HOST="$WEB_HOST" \
  WEB_PORT="$WEB_PORT" \
  WS_HOST="$WS_HOST" \
  WS_PORT="$WS_PORT" \
  INIT_PASSWORD="$INIT_PASSWORD" \
  OPEN_ACCESS="$OPEN_ACCESS" \
  node server/index.js \
  > "$DATA_DIR/server.log" 2>&1 &

echo $! > "$DATA_DIR/server.pid"
echo "Started CollabTeX: http://${WEB_HOST}:${WEB_PORT} (pid $(cat "$DATA_DIR/server.pid"))"
