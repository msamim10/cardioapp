#!/usr/bin/env bash
#
# Transcode the raw runner videos into an HLS adaptive-bitrate ladder.
#
# Input layout  (SRC_DIR):  level<N>/{vertical,horizontal}.mp4   (1080p source)
# Output layout (OUT_DIR):  level<N>/<orientation>/master.m3u8
#                           level<N>/<orientation>/<p>/stream.m3u8 + seg_*.ts
#
# The app streams the per-orientation master.m3u8; the player picks the
# rendition that fits the user's network (adaptive bitrate, like YouTube/TikTok).
#
# Ladder is 3-rung: 1080 / 720 / 480 (no 360).
#
# Usage:  scripts/transcode-hls.sh [SRC_DIR] [OUT_DIR]
#         LEVELS="1 2 3" scripts/transcode-hls.sh   # override level set
set -euo pipefail

SRC_DIR="${1:-$HOME/Documents/cardio-media/upload}"
OUT_DIR="${2:-$HOME/Documents/cardio-media/hls}"
LEVELS="${LEVELS:-1 2 3 4 5 6 7 8 9 10 11 12}"

# Rendition ladder: "shortSide videoBitrate maxrate bufsize audioBitrate"
# shortSide = height for horizontal video, width for vertical video.
RENDITIONS=(
  "1080 5000k 5350k 7500k 128k"
  "720  2800k 3000k 4200k 128k"
  "480  1400k 1500k 2100k 96k"
)

SEG_SECONDS=4

transcode_one() {
  local src="$1" outdir="$2" orientation="$3"
  mkdir -p "$outdir"

  # Skip if already fully built.
  if [[ -f "$outdir/.done" ]]; then
    echo "  [skip] $outdir already transcoded"
    return 0
  fi

  # Probe source short side to avoid upscaling (source is a clean single stream).
  local w h short
  w=$(ffprobe -v error -select_streams v:0 -show_entries stream=width -of csv=p=0 "$src")
  h=$(ffprobe -v error -select_streams v:0 -show_entries stream=height -of csv=p=0 "$src")
  if [[ "$w" -ge "$h" ]]; then short="$h"; else short="$w"; fi

  for r in "${RENDITIONS[@]}"; do
    read -r p vb maxr buf ab <<< "$r"
    if [[ "$p" -gt "$short" ]]; then
      echo "  [skip] ${orientation} ${p}p (source short side ${short})"
      continue
    fi

    local rdir="$outdir/$p"
    mkdir -p "$rdir"

    # Scale keeping aspect: horizontal -> set height, vertical -> set width.
    local vf
    if [[ "$w" -ge "$h" ]]; then vf="scale=-2:${p}"; else vf="scale=${p}:-2"; fi

    echo "  [enc ] ${orientation} ${p}p @ ${vb}"
    ffmpeg -y -hide_banner -loglevel error -i "$src" \
      -vf "$vf" \
      -c:v libx264 -preset fast -profile:v high -level 4.1 \
      -b:v "$vb" -maxrate "$maxr" -bufsize "$buf" \
      -force_key_frames "expr:gte(t,n_forced*${SEG_SECONDS})" \
      -c:a aac -b:a "$ab" -ac 2 \
      -hls_time "$SEG_SECONDS" -hls_playlist_type vod \
      -hls_segment_filename "$rdir/seg_%03d.ts" \
      "$rdir/stream.m3u8"
  done

  # Master playlist is written by scripts/write-masters.sh (computes RESOLUTION
  # arithmetically from the source; probing .ts segments is unreliable).
  touch "$outdir/.done"
  echo "  [done] renditions for $outdir"
}

echo "SRC_DIR=$SRC_DIR"
echo "OUT_DIR=$OUT_DIR"
echo "LEVELS=$LEVELS"
for n in $LEVELS; do
  for orientation in vertical horizontal; do
    src="$SRC_DIR/level$n/$orientation.mp4"
    [[ -f "$src" ]] || { echo "[warn] missing $src"; continue; }
    echo "== level$n / $orientation =="
    transcode_one "$src" "$OUT_DIR/level$n/$orientation" "$orientation"
  done
done

# Build/refresh master playlists for the processed levels from source dimensions.
"$(dirname "$0")/write-masters.sh" "$SRC_DIR" "$OUT_DIR" "$LEVELS"

echo "HLS TRANSCODE COMPLETE"
