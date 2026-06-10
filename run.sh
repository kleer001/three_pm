#!/usr/bin/env bash
# Launch the local dev server and open the game in a browser.
# Usage: ./run.sh [port]   (default 8000)
set -euo pipefail
cd "$(dirname "$0")"

PORT="${1:-8000}"
URL="http://localhost:$PORT"
REC_URL="$URL/tools/record.html"

python3 -m http.server "$PORT" &
SERVER=$!
trap 'kill "$SERVER" 2>/dev/null' EXIT

sleep 1                       # let the server bind before opening
echo "Serving game     $URL  (Ctrl-C to stop)"
echo "Serving recorder $REC_URL"
xdg-open "$URL" >/dev/null 2>&1 || echo "Open $URL in your browser."
xdg-open "$REC_URL" >/dev/null 2>&1 || echo "Open $REC_URL in your browser."

wait "$SERVER"
