#!/usr/bin/env bash
# Launch the local dev server and open the wobble battlefield sandbox.
# Usage: ./art_wobble.sh [port]   (default 8000)
set -euo pipefail
cd "$(dirname "$0")"

PORT="${1:-8000}"
URL="http://localhost:$PORT/art-test/art_wobble.html"

python3 -m http.server "$PORT" &
SERVER=$!
trap 'kill "$SERVER" 2>/dev/null' EXIT

sleep 1                       # let the server bind before opening
echo "Serving wobble battlefield $URL  (Ctrl-C to stop)"
xdg-open "$URL" >/dev/null 2>&1 || echo "Open $URL in your browser."

wait "$SERVER"
