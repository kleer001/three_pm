#!/usr/bin/env bash
# Trim/normalize the scout.sh survivors into the audition pool and emit a manifest.
# Each clip is rendered through the same recipe install_sfx.sh uses (mono 44.1k,
# dynaudnorm, hard duration cap) so what you hear here == what ships. Run from repo root.
set -u

POOL="art-test/sfx-preview/pool"
MANIFEST="art-test/sfx-preview/win-death-manifest.json"
mkdir -p "$POOL"
command -v ffmpeg >/dev/null || { echo "ERROR: ffmpeg not found" >&2; exit 1; }
rm -f "$POOL"/win__*.wav "$POOL"/death__*.wav   # clear prior win/death clips (regenerable)

slugify() { basename "$1" | sed -E 's/\.[^.]+$//' | tr 'A-Z ' 'a-z_' | sed -E 's/[^a-z0-9]+/_/g; s/_+/_/g; s/^_//; s/_$//'; }
jesc()    { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

emit_event() {  # $1 event, $2 listfile, $3 duration-cap-seconds
  local event="$1" cap="$3"
  declare -A seen
  while IFS=$'\t' read -r dur src; do
    [[ -z "${src:-}" ]] && continue
    local slug base dst
    base="${event}__$(slugify "$src")"
    slug="$base"; local i=2
    while [[ -n "${seen[$slug]:-}" ]]; do slug="${base}_${i}"; i=$((i+1)); done  # de-collide same-named files
    seen[$slug]=1
    dst="$POOL/$slug.wav"
    # -nostdin: ffmpeg must NOT read the loop's stdin (the list file) or it corrupts the next read
    ffmpeg -nostdin -y -loglevel error -i "$src" -ac 1 -ar 44100 -t "$cap" -af dynaudnorm "$dst" || continue
    dur=$(awk -v d="$dur" 'BEGIN{printf "%.3f", d+0}')   # normalize ".46" -> "0.460" for valid JSON
    printf '  {"event":"%s","slug":"%s","file":"sfx-preview/pool/%s.wav","dur":%s,"source":"%s"},\n' \
      "$event" "$(jesc "$slug")" "$(jesc "$slug")" "$dur" "$(jesc "$src")"
  done < "$2"
}

{
  echo "["
  emit_event win   /tmp/three_pm_win_dur.txt   7.0
  emit_event death /tmp/three_pm_death_dur.txt  1.0
  echo "]"
} | sed -z 's/,\n]/\n]/' > "$MANIFEST"

echo "Wrote $(grep -c '"event"' "$MANIFEST") candidates to $MANIFEST"
echo "Pool: $(ls "$POOL"/win__*.wav "$POOL"/death__*.wav 2>/dev/null | wc -l) wav files in $POOL"
