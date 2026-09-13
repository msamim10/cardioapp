#!/usr/bin/env bash
#
# Build the per-level COMPOSITE game asset used by the post-run video
# composer (docs/RUN_RECORDING.md). The composer cannot read the HLS ladder,
# so each level also gets one progressive, fast-start MP4:
#
#   720x576  (the 45% game region of the 720x1280 share canvas)
#   H.264 high profile, ~1.2 Mbps, 30 fps, keyframe every 2 s
#   AAC 96k stereo audio (muxed into the share video ONLY when the app's
#   includeGameAudio flag is on — off by default until music rights are clear)
#
# Input layout  (SRC_DIR):  level<N>/vertical.mp4        (1080x1920 source)
# Output layout (OUT_DIR):  composite/level<N>/game-576.mp4
#
# The vertical source is scaled to 720 wide (720x1280) and centre-cropped to
# 576 tall. CROP_BIAS moves the crop window: 0 = top, 0.5 = centre (default),
# 1 = bottom. Runner games keep the action mid-frame, so the centre is right
# for every current level; override per run if a level needs it.
#
# Usage:  scripts/transcode-composite.sh [SRC_DIR] [OUT_DIR]
#         LEVELS="1 2 3" CROP_BIAS=0.55 scripts/transcode-composite.sh
set -euo pipefail

SRC_DIR="${1:-$HOME/Documents/cardio-media/upload}"
OUT_DIR="${2:-$HOME/Documents/cardio-media/hls}"
LEVELS="${LEVELS:-1 2 3 4 5 6 7 8 9 10 11 13 14}"
CROP_BIAS="${CROP_BIAS:-0.5}"

WIDTH=720
HEIGHT=576
VIDEO_BITRATE="1200k"
VIDEO_MAXRATE="1400k"
VIDEO_BUFSIZE="2400k"
AUDIO_BITRATE="96k"
FPS=30

transcode_one() {
  local src="$1" out="$2"
  mkdir -p "$(dirname "$out")"
  if [[ -f "$out" && -f "$out.done" ]]; then
    echo "  [skip] $out already built"
    return 0
  fi
  echo "  [enc ] $out (${WIDTH}x${HEIGHT} @ ${VIDEO_BITRATE}, bias ${CROP_BIAS})"
  # scale to 720 wide keeping aspect (-2 keeps the height even), then crop the
  # 576-tall window at the bias point. faststart moves the moov atom to the
  # front so AVFoundation can read duration/tracks before the whole file lands.
  ffmpeg -y -hide_banner -loglevel error -i "$src" \
    -vf "scale=${WIDTH}:-2,crop=${WIDTH}:${HEIGHT}:0:'(ih-${HEIGHT})*${CROP_BIAS}',fps=${FPS}" \
    -c:v libx264 -preset slow -profile:v high -level 4.0 -pix_fmt yuv420p \
    -b:v "$VIDEO_BITRATE" -maxrate "$VIDEO_MAXRATE" -bufsize "$VIDEO_BUFSIZE" \
    -g $((FPS * 2)) -keyint_min $((FPS * 2)) -sc_threshold 0 \
    -c:a aac -b:a "$AUDIO_BITRATE" -ac 2 \
    -movflags +faststart \
    "$out"
  touch "$out.done"
  echo "  [done] $out"
}

echo "SRC_DIR=$SRC_DIR"
echo "OUT_DIR=$OUT_DIR"
echo "LEVELS=$LEVELS"
for n in $LEVELS; do
  src="$SRC_DIR/level$n/vertical.mp4"
  [[ -f "$src" ]] || { echo "[warn] missing $src"; continue; }
  echo "== level$n / composite =="
  transcode_one "$src" "$OUT_DIR/composite/level$n/game-576.mp4"
done

echo "COMPOSITE TRANSCODE COMPLETE"
