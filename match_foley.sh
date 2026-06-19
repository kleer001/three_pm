#!/usr/bin/env bash
# Scan the sample dump and bucket candidate foley by game sound event.
# Reads the flat dump produced by list_samples.sh; writes a compact shortlist.
set -u  # not -e/pipefail: head closing a big sort pipe early would SIGPIPE-abort the run

IN="/tmp/three_pm_samples.txt"
OUT="/tmp/three_pm_foley.txt"
CAP=40   # max candidates listed per event

[[ -f "$IN" ]] || { echo "ERROR: run list_samples.sh first ($IN missing)" >&2; exit 1; }

# Only the "All audio files" body (skip the summary header so counts don't match).
BODY=$(sed -n '/## All audio files/,$p' "$IN")

# event  =>  case-insensitive extended regex over the full path
declare -A EV=(
  [shoot]='laser|zap|\bpew|blaster|plasma|phaser|gunshot|\bshot\b|\bgun\b|beam|ray.?gun'
  [enemyShoot]='laser|zap|synth.?(hit|stab)|\bbeam|alien|robot|\bevil|menace'
  [swing]='swoosh|whoosh|woosh|swish|swipe|\bslash|\bwhip|\bair\b|sword'
  [nova]='shockwave|\bnova|whoomp|sub.?drop|down.?lifter|impact.?(wave|hit)|\briser|\bsweep|wobble|\bdrop\b'
  [field]='\bdrone|\bhum\b|atmos|ambient|texture|\bzone\b|\bpad\b|noise.?loop|energy'
  [hit]='\bhit\b|\bimpact|\bsmack|\bwhack|\bpunch|\bslap|\bknock|\bclick|\btick|\bsnap'
  [hurt]='\bgrunt|\bouch|\bow\b|\bhurt|\bpain|\boof|\bbody|\bmale.?(v|h)|\bhuff'
  [freeze]='\bice\b|\bfrost|freeze|\bglass|crystal|\bchime|shatter|\bbell\b|icy'
  [death]='\bsplat|squish|\bcrunch|\bgore|\bbone|\bcrush|\bdie\b|\bdeath|flesh|\bgut'
  [explode]='explos|\bboom\b|\bblast|\bbomb|kaboom|detonat|\bsub\b|\b808|cannon|\bgun.?big'
  [pickup]='\bcoin|\bchime|sparkle|\bmagic|pickup|power.?up|\bbonus|\bpluck|\bblip|\bding|kalimba|glock|\bbell\b|\bget\b|\bitem'
  [win]='fanfare|victory|\bwin\b|triumph|success|\bjingle|\btada|level.?up|complete'
  [lose]='\bfail|game.?over|defeat|\bsad\b|\bdowner|\blose|wah.?wah|trombone|\bdoom'
  [ui_msn]='\bui\b|\bbutton|\bbeep|notif|\bmessage|\balert|\bping|\bmenu|\bselect|confirm|\bmsn\b|\baim\b|\bpop\b|\bphone|ringtone|\bdialog'
)

ORDER=(shoot enemyShoot swing nova field hit hurt freeze death explode pickup win lose ui_msn)

{
  echo "# Foley candidates by game sound event"
  echo "# (size in bytes + path; capped at $CAP per event; smaller files = likelier one-shots)"
  echo
  for ev in "${ORDER[@]}"; do
    echo "===================================================================="
    echo "## $ev"
    echo "--------------------------------------------------------------------"
    # match, drop multi-second loops by preferring smaller files, cap the list
    matches=$(printf '%s\n' "$BODY" | grep -iE "${EV[$ev]}" || true)
    n=$(printf '%s\n' "$matches" | grep -c . || true)
    echo "(matched $n; showing up to $CAP smallest)"
    printf '%s\n' "$matches" | sort -n | head -n "$CAP"
    echo
  done
} > "$OUT"

echo "Wrote $(wc -l < "$OUT") lines to $OUT"
