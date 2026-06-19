#!/usr/bin/env bash
# Serve the repo locally and open the SFX editor (art-test/sfx-editor.html), which boot-loads
# the working slot list from art-test/sfx-picks.json. ES modules need HTTP, not file://.
# Usage: ./sfx_editor.sh [port]   (default 8123)
set -euo pipefail
cd "$(dirname "$0")"

PORT="${1:-8123}"
URL="http://localhost:$PORT/art-test/sfx-editor.html"

python3 -m http.server "$PORT" &
SERVER=$!
trap 'kill "$SERVER" 2>/dev/null' EXIT

sleep 1                         # let the server bind before opening
echo "SFX editor  $URL  (Ctrl-C to stop)"

# Open in Firefox explicitly (see run.sh: xdg-open misfires to Chrome on this box).
# Override with $BROWSER.
open_url() {
  local b="${BROWSER:-firefox}"
  if command -v "$b" >/dev/null 2>&1; then
    "$b" "$1" >/dev/null 2>&1 &
  else
    xdg-open "$1" >/dev/null 2>&1 || echo "Open $1 in your browser."
  fi
}
open_url "$URL"

wait "$SERVER"
