#!/usr/bin/env bash
# Package the game for itch.io: a .zip with index.html at the archive ROOT.
# itch.io requires index.html at the top level, .zip only, <1000 files.
set -euo pipefail

cd "$(dirname "$0")"

OUT="dist/three_pm.zip"
RUNTIME=(index.html styles.css src assets)

rm -f "$OUT"
mkdir -p dist
zip -r "$OUT" "${RUNTIME[@]}" -x '*.DS_Store' '**/.gitkeep'

echo "Built $OUT"
echo "Upload it to itch.io and tick \"This file will be played in the browser.\""
