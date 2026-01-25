#!/usr/bin/env bash
set -euo pipefail

if [ $# -lt 2 ]; then
  echo "Usage: $0 <input.mp4> <output.gif>" >&2
  exit 1
fi

IN="$1"
OUT="$2"

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg not found. Please install ffmpeg." >&2
  exit 1
fi

TMP_PALETTE="${OUT%.*}_palette.png"

# Generate palette for better quality.
ffmpeg -y -i "$IN" -vf "fps=15,scale=960:-1:flags=lanczos" -palettegen "$TMP_PALETTE"
# Use palette to create optimized GIF.
ffmpeg -y -i "$IN" -i "$TMP_PALETTE" -filter_complex "fps=15,scale=960:-1:flags=lanczos[x];[x][1:v]paletteuse" "$OUT"

rm -f "$TMP_PALETTE"

echo "GIF written to: $OUT"
