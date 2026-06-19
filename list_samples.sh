#!/usr/bin/env bash
# Dump the sample library to a flat text file for foley scouting.
# Lists every audio file (path + size) plus a per-folder count summary.
set -euo pipefail

ROOT="/media/menser/larg/Music/samples"
OUT="/tmp/three_pm_samples.txt"
EXTS='wav|aif|aiff|flac|mp3|ogg|m4a|aac|wv|opus'

if [[ ! -d "$ROOT" ]]; then
  echo "ERROR: $ROOT does not exist or is not a directory" >&2
  exit 1
fi

{
  echo "# Sample library dump: $ROOT"
  echo "# Generated: $(date)"
  echo

  echo "## Top-level folders"
  find "$ROOT" -mindepth 1 -maxdepth 1 -type d | sort
  echo

  echo "## Audio-file count by immediate subfolder"
  find "$ROOT" -type f -regextype posix-extended -iregex ".*\.($EXTS)$" -printf '%h\n' \
    | sed "s#^$ROOT/\?##; s#/.*##" | sort | uniq -c | sort -rn
  echo

  TOTAL=$(find "$ROOT" -type f -regextype posix-extended -iregex ".*\.($EXTS)$" | wc -l)
  echo "## All audio files ($TOTAL total) — size, path"
  find "$ROOT" -type f -regextype posix-extended -iregex ".*\.($EXTS)$" -printf '%10s  %p\n' | sort -k2
} > "$OUT"

echo "Wrote $(wc -l < "$OUT") lines to $OUT"
