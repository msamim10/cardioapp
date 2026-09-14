#!/usr/bin/env bash
#
# Upload the transcoded HLS ladder to the public GCS bucket, with correct
# Content-Type and Cache-Control on every file. Uses the already-authenticated
# gcloud CLI (run `gcloud auth login` once if needed).
#
# Also uploads the per-level composite game assets built by
# scripts/transcode-composite.sh (SRC/composite/level<N>/game-576.mp4) to
# gs://BUCKET/composite/level<N>/game-576.mp4, which the app's run recording
# resolves via getCompositeGameSource() in src/lib/videoSources.ts. Skipped
# when SRC/composite does not exist.
#
# Usage: scripts/upload-hls.sh [BUCKET] [SRC_DIR]
#        HLS_PREFIX=hls-v3 scripts/upload-hls.sh     # new ladder generation
#
# HLS_PREFIX must match `HLS_PREFIX` in src/lib/videoSources.ts (currently
# `hls-v2`); the composite prefix must match `COMPOSITE_PREFIX` there.
set -euo pipefail

BUCKET="${1:-cardiosurf-mvp-media}"
SRC="${2:-$HOME/Documents/cardio-media/hls}"
HLS_PREFIX="${HLS_PREFIX:-hls-v2}"
COMPOSITE_PREFIX="${COMPOSITE_PREFIX:-composite}"

echo "Syncing $SRC -> gs://$BUCKET/$HLS_PREFIX"
gcloud storage rsync -r --exclude="^composite/.*" "$SRC" "gs://$BUCKET/$HLS_PREFIX"

echo "Setting content-type / cache-control..."
# Segments are immutable -> cache for a year. Playlists change on re-encode.
gcloud storage objects update "gs://$BUCKET/$HLS_PREFIX/**/*.ts" \
  --content-type=video/mp2t \
  --cache-control="public,max-age=31536000,immutable"
gcloud storage objects update "gs://$BUCKET/$HLS_PREFIX/**/*.m3u8" \
  --content-type=application/vnd.apple.mpegurl \
  --cache-control="public,max-age=60"

if [[ -d "$SRC/composite" ]]; then
  echo "Syncing $SRC/composite -> gs://$BUCKET/$COMPOSITE_PREFIX"
  # Only the MP4s: the local .done markers stay local.
  gcloud storage rsync -r --exclude=".*\.done$" "$SRC/composite" "gs://$BUCKET/$COMPOSITE_PREFIX"
  # A level's composite is re-cut only with a new slug, so it is immutable
  # too; the app caches it on device (LRU of 3) and HEADs it once per toggle.
  gcloud storage objects update "gs://$BUCKET/$COMPOSITE_PREFIX/**/*.mp4" \
    --content-type=video/mp4 \
    --cache-control="public,max-age=31536000,immutable"
else
  echo "[skip] no $SRC/composite directory (run scripts/transcode-composite.sh first)"
fi

echo "UPLOAD COMPLETE"
echo "Base URL: https://storage.googleapis.com/$BUCKET"
