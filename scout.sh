#!/usr/bin/env bash
# Mine the sample library for `win` and `death` foley candidates.
# Keyword-filters the dump from list_samples.sh, drops obvious music/loops, then
# gates by real audio duration via a parallel ffprobe sweep (byte-size can't tell
# you length — compression varies by format). Output feeds the audition page.
set -u

IN="/tmp/three_pm_samples.txt"
[[ -f "$IN" ]] || { echo "ERROR: run list_samples.sh first ($IN missing)" >&2; exit 1; }
command -v ffprobe >/dev/null || { echo "ERROR: ffprobe not found" >&2; exit 1; }

# Noise/exclusion regexes are matched against the FILENAME only (the trailing path
# segment) so a useful clip under a folder like .../loopSounds/foleyStolen/ survives.
NOISE='loop|bpm|[0-9]{2,3}bpm|beat|melody|bassline|chord|fullmix|riff'
# Full-path exclusions: music-loop / novelty folders that a keyword matches via the folder
# name (e.g. "Bonus loops" hip-hop kit, the "human trumpet" raspberry pack) — not win cues.
PATH_NOT='street beats|human trumpet|/loops?/|bonus samp|bonus.ambien|ir samples'
# 'win' substring false-positives + flood-traps (drum kits, arp loops, reverb IRs that
# slip in via folder names or musical-loop packs — they read as "win" by name but aren't).
WIN_NOT='wind|rewind|winch|window|winter|wing|wink|twin|waterkit|arpeggio|epic_hall|_kick_|_snare_|_hats_'

# event keyword regexes (case-insensitive, matched against the full path so folder
# hints like .../VEC3 Impacts/ or .../Drops/ count too). WIN is tuned for short victory
# JINGLES/FLOURISHES, not single notes or musical loops — full stage-clear tunes run 3-6s.
WIN_KW='win|victory|triumph|fanfare|success|tada|ta[-_]?da|level[-_]?up|stage[-_]?win|beat[-_]?boss|defeat|bonus|1up|power[-_ ]?up|huzzah|hooray|hurrah|jingle|cheer|woohoo|yeehaw|applause|glissando|beeptheme|dingwoosh|dingflip|musicswell|christal'
DEATH_KW='thud|thump|whump|thwack|body|fall|impact|crunch|squish|splat|smash|punch|drop|whomp|boom|die|death|gore|bone|crush|crumble|gloppy|rip\b'

# $1 = keyword regex, $2 = extra filename-exclusion regex (may be empty)
paths_for() {
  local body; body=$(sed -n '/## All audio files/,$p' "$IN" | grep -oE '/media/.*')
  printf '%s\n' "$body" \
    | grep -iE "$1" \
    | grep -ivE "$PATH_NOT" \
    | grep -ivE "/[^/]*(${NOISE})[^/]*$" \
    | { [[ -n "$2" ]] && grep -ivE "/[^/]*(${2})[^/]*$" || cat; }
}

# Parallel ffprobe gate. stdin: newline paths. $1 min, $2 max -> stdout "dur<TAB>path".
probe_gate() {
  tr '\n' '\0' \
    | MIN="$1" MAX="$2" xargs -0 -P"$(nproc)" -I{} bash -c '
        d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$1" 2>/dev/null)
        [ -z "$d" ] && exit 0
        awk -v d="$d" -v lo="$MIN" -v hi="$MAX" "BEGIN{exit !(d+0>=lo && d+0<=hi)}" \
          && printf "%s\t%s\n" "$d" "$1"
      ' _ {} \
    | sort -n
}

# stdin: sorted "dur<TAB>path" -> keep at most $1 shortest per parent folder
cap_per_folder() {
  awk -F'\t' -v n="$1" '{d=$2; sub(/\/[^\/]*$/,"",d); if(++c[d]<=n) print}'
}

run_event() {  # $1 label, $2 keyword, $3 exclusion, $4 min, $5 max, $6 per-folder cap, $7 outfile
  local label="$1" cap="$6" cand n
  cand=$(paths_for "$2" "$3")
  n=$(printf '%s\n' "$cand" | grep -c . || true)
  echo "[$label] $n keyword matches (filename noise culled); probing ${4}-${5}s ..."
  printf '%s\n' "$cand" | probe_gate "$4" "$5" | cap_per_folder "$cap" > "$7"
  echo "[$label] $(wc -l < "$7") survivors (<=${cap}/folder) -> $7"
}

# win: short victory jingles/flourishes (full stage-clear tunes run to ~6s); 8/folder
# because the 8bitGameSmpls pack alone holds many distinct genuine win cues.
run_event win   "$WIN_KW"   "$WIN_NOT" 0.20 7.00 8 /tmp/three_pm_win_dur.txt
run_event death "$DEATH_KW" ""         0.10 1.20 4 /tmp/three_pm_death_dur.txt
