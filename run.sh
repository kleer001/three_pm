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

# Open in Firefox explicitly. xdg-open follows the system default handler, which on
# this box falls back to Chrome through a dangling firefox.desktop reference; launch
# Firefox directly so the dev pages always land where we want. Override with $BROWSER.
open_url() {
  local b="${BROWSER:-firefox}"
  if command -v "$b" >/dev/null 2>&1; then
    "$b" "$1" >/dev/null 2>&1 &
  else
    xdg-open "$1" >/dev/null 2>&1 || echo "Open $1 in your browser."
  fi
}
open_url "$URL"
open_url "$REC_URL"

wait "$SERVER"
