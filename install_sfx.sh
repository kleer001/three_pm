#!/usr/bin/env bash
# Copy chosen source samples into assets/sfx/ under the names the engine looks for
# (src/audio/sfx.js → SAMPLES). Converts to mono 44.1kHz WAV via ffmpeg so decodeAudioData
# is happy everywhere and the files stay small. Edit the MAP below to your picks, then run.
#
# Any event in sfx.js's SAMPLES can be backed: key = destination filename, value = source path.
# Leave a source blank to skip it (that event stays on its synth recipe).
set -u

command -v ffmpeg >/dev/null || { echo "ERROR: ffmpeg not found (needed to convert samples)" >&2; exit 1; }

DST_DIR="assets/sfx"
mkdir -p "$DST_DIR"

# destination_name|source_path   (fill in source paths from the sample library)
SRC="/media/menser/larg/Music/samples"
MAP=(
  "scream_1.wav|$SRC/SamplesOnNirvana/loopSounds/foleyStolen/scream_01-2.wav"
  "scream_2.wav|$SRC/SamplesOnNirvana/loopSounds/foleyStolen/scream_02-2.wav"
  "scream_3.wav|$SRC/SamplesOnNirvana/loopSounds/foleyStolen/scream_03-2.wav"
  "scream_4.wav|$SRC/SamplesOnNirvana/loopSounds/foleyStolen/scream_04-2.wav"
  "ui_move.wav|$SRC/samplesRaw/Old Skool Video Games.rar Folder/Lo-fi Bleeps and Bloops/Blips/1-2.wav"
  "ui_select.wav|$SRC/phoneRings/airline-1ding-2.mp3"
  "ui_back.wav|$SRC/SamplesOnNirvana/loopSounds/8bitGameSmpls/Sonic_Sounds Folder/Sonic beep-2.wav"
)

for entry in "${MAP[@]}"; do
  dst="${entry%%|*}"
  src="${entry#*|}"
  [[ -z "$src" ]] && { echo "skip $dst (no source set)"; continue; }
  [[ -f "$src" ]] || { echo "MISSING source for $dst: $src" >&2; continue; }
  # mono, 44.1k, peak-normalized, hard-capped at 2s so a stray long file can't bloat the zip
  ffmpeg -y -loglevel error -i "$src" -ac 1 -ar 44100 -t 2 -af "dynaudnorm" "$DST_DIR/$dst" \
    && echo "installed $dst  <-  $src"
done

echo "Done. Files in $DST_DIR/ — reload the game; sfx.js picks them up automatically."
