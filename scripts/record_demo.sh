#!/usr/bin/env bash
set -euo pipefail

# Usage: ./scripts/record_demo.sh
# Environment overrides:
# BASE_URL, USERNAME, PASSWORD, PROJECT_NAME, HEADFUL, WIDTH, HEIGHT
# OUTPUT_WEBM, OUTPUT_MP4, CONVERT_MP4

if ! command -v node >/dev/null 2>&1; then
  echo "node not found" >&2
  exit 1
fi

node scripts/record_demo.js
