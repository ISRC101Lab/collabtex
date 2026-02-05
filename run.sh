#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="${DATA_DIR:-$ROOT_DIR/collabtex-data}"
WEB_PORT="${WEB_PORT:-4092}"
if [[ -z "${WS_PORT:-}" ]]; then
  WS_PORT="$((WEB_PORT + 1))"
else
  WS_PORT="${WS_PORT}"
fi
WEB_HOST="${WEB_HOST:-0.0.0.0}"
WS_HOST="${WS_HOST:-0.0.0.0}"
INIT_PASSWORD="admin"
OPEN_ACCESS="${OPEN_ACCESS:-0}"
COMPILE_DOCKER="${COMPILE_DOCKER:-0}"
LATEX_BIN_PATH="${LATEX_BIN_PATH:-}"

if [[ -n "$LATEX_BIN_PATH" ]]; then
  export PATH="$LATEX_BIN_PATH:$PATH"
fi

mkdir -p "$DATA_DIR"

cd "$ROOT_DIR"

if [[ ! -d node_modules ]]; then
  npm install
fi

npm run build

# Restrict newly created files (especially under DATA_DIR) to the current user.
umask 077

# Local LaTeX toolchain check (skip if Docker compile is enabled).
if [[ "$COMPILE_DOCKER" != "1" ]]; then
  if ! command -v pdflatex >/dev/null 2>&1 && ! command -v xelatex >/dev/null 2>&1 && ! command -v lualatex >/dev/null 2>&1; then
    echo "LaTeX not found (pdflatex/xelatex/lualatex)."
    echo "Install TeX Live (recommended) or set COMPILE_DOCKER=1."
    exit 1
  fi
  if ! command -v synctex >/dev/null 2>&1; then
    echo "Warning: synctex not found. PDF sync features will be disabled."
  fi
  if ! command -v bibtex >/dev/null 2>&1 && ! command -v biber >/dev/null 2>&1; then
    echo "Warning: bibtex/biber not found. Bibliography may fail."
  fi
fi

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
  COMPILE_DOCKER="$COMPILE_DOCKER" \
  node server/index.js \
  > "$DATA_DIR/server.log" 2>&1 &

echo $! > "$DATA_DIR/server.pid"
sleep 1
if kill -0 "$(cat "$DATA_DIR/server.pid")" 2>/dev/null; then
  echo "Started CollabTeX: http://${WEB_HOST}:${WEB_PORT} (pid $(cat "$DATA_DIR/server.pid"))"
else
  echo "Failed to start CollabTeX. See log: $DATA_DIR/server.log"
  rm -f "$DATA_DIR/server.pid"
  exit 1
fi
