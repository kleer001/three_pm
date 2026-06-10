#!/usr/bin/env bash
# Launch the local dev server and open the game in a browser.
# Usage: ./run.sh [port]   (default 8000)
set -euo pipefail
cd "$(dirname "$0")"

PORT="${1:-8000}"
URL="http://localhost:$PORT"

python3 -m http.server "$PORT" &
SERVER=$!
trap 'kill "$SERVER" 2>/dev/null' EXIT

sleep 1                       # let the server bind before opening
echo "Serving $URL  (Ctrl-C to stop)"
xdg-open "$URL" >/dev/null 2>&1 || echo "Open $URL in your browser."

wait "$SERVER"
