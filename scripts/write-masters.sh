#!/usr/bin/env bash
set -euo pipefail
SRC_DIR="${1:-$HOME/Documents/cardio-media/upload}"
OUT_DIR="${2:-$HOME/Documents/cardio-media/hls}"
LEVELS="${3:-1 2 3 4 5 6 7 8 9 10 11 12}"

# 3-rung ladder: 1080 / 720 / 480 (no 360).
bandwidth_for() {
  case "$1" in
    1080) echo 5478000 ;;
    720)  echo 3128000 ;;
    480)  echo 1596000 ;;
    *)    echo 1000000 ;;
  esac
}
round_even() {
  awk -v x="$1" 'BEGIN{ v=int(x+0.5); if (v%2!=0) v++; print v }'
}

for n in $LEVELS; do
  for orientation in vertical horizontal; do
    outdir="$OUT_DIR/level$n/$orientation"
    src="$SRC_DIR/level$n/$orientation.mp4"
    [[ -d "$outdir" ]] || continue
    [[ -f "$src" ]] || { echo "[warn] missing source $src"; continue; }

    w=$(ffprobe -v error -select_streams v:0 -show_entries stream=width -of csv=p=0 "$src" | awk 'NF{print $1; exit}')
    h=$(ffprobe -v error -select_streams v:0 -show_entries stream=height -of csv=p=0 "$src" | awk 'NF{print $1; exit}')
    [[ -n "$w" && -n "$h" && "$w" != "0" ]] || { echo "[warn] unreadable $src"; continue; }

    content=$'#EXTM3U\n#EXT-X-VERSION:3\n'
    for p in 1080 720 480; do
      [[ -f "$outdir/$p/stream.m3u8" ]] || continue
      if [[ "$w" -ge "$h" ]]; then
        oh="$p"; ow=$(round_even "$(awk -v w="$w" -v h="$h" -v p="$p" 'BEGIN{print w*p/h}')")
      else
        ow="$p"; oh=$(round_even "$(awk -v w="$w" -v h="$h" -v p="$p" 'BEGIN{print h*p/w}')")
      fi
      bw=$(bandwidth_for "$p")
      content+="#EXT-X-STREAM-INF:BANDWIDTH=${bw},RESOLUTION=${ow}x${oh}"$'\n'
      content+="${p}/stream.m3u8"$'\n'
    done
    printf '%s' "$content" > "$outdir/master.m3u8"
    echo "[ok] $(wc -l < "$outdir/master.m3u8") lines -> $outdir/master.m3u8"
  done
done
echo "MASTERS WRITTEN"
