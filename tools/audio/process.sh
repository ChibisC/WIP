#!/usr/bin/env bash
# Turn raw recordings into game files.
#
#   tools/audio/process.sh            process everything in audio-src/recordings
#   tools/audio/process.sh ant/bite   only files whose path contains "ant/bite"
#
# Put originals in audio-src/recordings/<folder>/<name>_NN.<wav|flac|aif|aiff|mp3|ogg>,
# named after the catalog (docs/audio/sound-list.md gives every path), e.g.
#   audio-src/recordings/ant/step_soil_01.wav
# For each one this writes public/audio/<folder>/<name>_NN.ogg (Vorbis) and .m4a (AAC, for
# older Safari), then rebuilds public/audio/manifest.json so the game uses them.
#
# Processing: a gentle high-pass (rumble below 40 Hz; not for music or deep bosses/ambience),
# silence trimmed from both ends of short sounds, a 10 ms fade-out, normalised to a peak of
# -1 dBFS (loops and music to an integrated loudness instead), mono for effects, stereo kept
# for ambience and music. The originals are never changed.
set -euo pipefail
cd "$(dirname "$0")/../.."
SRC=audio-src/recordings
OUT=public/audio
FILTER="${1:-}"
command -v ffmpeg >/dev/null || { echo "ffmpeg is needed (https://ffmpeg.org)"; exit 1; }
n=0
while IFS= read -r -d '' f; do
  rel="${f#$SRC/}"
  [[ -n "$FILTER" && "$rel" != *"$FILTER"* ]] && continue
  base="${rel%.*}"
  folder="${rel%%/*}"
  mkdir -p "$OUT/$(dirname "$rel")"
  case "$folder" in
    music|amb) ch=2 ;;
    *) ch=1 ;;
  esac
  long=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f" </dev/null | awk '{print ($1 > 8) ? 1 : 0}')
  hp="highpass=f=40,"
  [[ "$folder" == "music" || "$base" == boss/* || "$base" == amb/thunder* || "$base" == amb/nest_room* || "$base" == amb/colony_rumble* ]] && hp=""
  if [[ "$long" == 1 ]]; then
    # loops and music: loudness-normalised, untrimmed (they must loop cleanly)
    af="${hp}loudnorm=I=-20:TP=-2:LRA=11"
  else
    # one-shots: trim silence, fade the tail, then peak-normalise
    peak=$(ffmpeg -nostdin -hide_banner -i "$f" -af "${hp}silenceremove=start_periods=1:start_threshold=-60dB,areverse,silenceremove=start_periods=1:start_threshold=-60dB,areverse,volumedetect" -f null - 2>&1 | awk '/max_volume/ {print $5}')
    gain=$(awk -v p="${peak:-0}" 'BEGIN { print -1 - p }')
    af="${hp}silenceremove=start_periods=1:start_threshold=-60dB,areverse,silenceremove=start_periods=1:start_threshold=-60dB,afade=t=in:d=0.01,areverse,volume=${gain}dB"
  fi
  ffmpeg -nostdin -hide_banner -loglevel error -y -i "$f" -af "$af" -ac "$ch" -ar 44100 -c:a libvorbis -q:a 5 "$OUT/$base.ogg"
  ffmpeg -nostdin -hide_banner -loglevel error -y -i "$OUT/$base.ogg" -c:a aac -b:a 128k "$OUT/$base.m4a"
  echo "  $rel → $OUT/$base.ogg, .m4a"
  n=$((n + 1))
done < <(find "$SRC" -type f \( -iname '*.wav' -o -iname '*.flac' -o -iname '*.aif' -o -iname '*.aiff' -o -iname '*.mp3' -o -iname '*.ogg' \) -print0 | sort -z)
echo "$n file(s) processed"
npx vite-node tools/audio/build-manifest.ts
