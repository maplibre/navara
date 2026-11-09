#!/usr/bin/env bash
# Joins recorded clips with crossfades and ends on the Navara logo.
#
#   compose.sh -o out.mp4 clip1.mp4 clip2.mp4 ...
#
# Env: FADE (crossfade seconds, default 0.35), LOGO_HOLD (seconds the logo
# stays fully visible, default 2).
set -euo pipefail

FADE=${FADE:-0.35}
LOGO_HOLD=${LOGO_HOLD:-2}
W=1920
H=1080
FPS=30
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
LOGO="$ROOT/docs/public/logo/png/white/white_Navara_Horizontal_logo.png"

out=""
clips=()
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    *) clips+=("$1"); shift ;;
  esac
done
if [ -z "$out" ] || [ ${#clips[@]} -eq 0 ]; then
  echo "Usage: compose.sh -o out.mp4 clip1.mp4 [clip2.mp4 ...]" >&2
  exit 1
fi

inputs=()
filters=""
length=""
prev=""
i=0
for clip in "${clips[@]}"; do
  d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$clip")
  inputs+=(-i "$clip")
  filters+="[$i:v]fps=$FPS,scale=$W:$H:force_original_aspect_ratio=decrease,pad=$W:$H:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p,settb=AVTB[c$i];"
  if [ -z "$prev" ]; then
    prev="c$i"
    length=$d
  else
    offset=$(awk -v l="$length" -v f="$FADE" 'BEGIN { printf "%.3f", l - f }')
    filters+="[$prev][c$i]xfade=transition=fade:duration=$FADE:offset=$offset[x$i];"
    prev="x$i"
    length=$(awk -v l="$length" -v d="$d" -v f="$FADE" 'BEGIN { printf "%.3f", l + d - f }')
  fi
  i=$((i + 1))
done

# Logo card: white horizontal logo at 40% width on black, faded in from the
# last clip, so it lasts FADE + LOGO_HOLD.
card=$(awk -v f="$FADE" -v h="$LOGO_HOLD" 'BEGIN { printf "%.3f", f + h }')
logo_w=$((W * 2 / 5))
inputs+=(-f lavfi -i "color=c=black:s=${W}x${H}:r=$FPS:d=$card" -loop 1 -t "$card" -i "$LOGO")
filters+="[$((i + 1)):v]scale=$logo_w:-1[logo];"
filters+="[$i:v][logo]overlay=(W-w)/2:(H-h)/2:shortest=1,fps=$FPS,setsar=1,format=yuv420p,settb=AVTB[card];"
offset=$(awk -v l="$length" -v f="$FADE" 'BEGIN { printf "%.3f", l - f }')
filters+="[$prev][card]xfade=transition=fade:duration=$FADE:offset=$offset[v]"

ffmpeg -y -loglevel error "${inputs[@]}" -filter_complex "$filters" -map "[v]" \
  -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -r $FPS -an \
  -movflags +faststart "$out"

total=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$out")
echo "✅ $out (${total}s)"
