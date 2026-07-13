#!/usr/bin/env bash
#
# Upload the transcoded HLS ladder to the public GCS bucket, with correct
# Content-Type and Cache-Control on every file. Uses the already-authenticated
# gcloud CLI (run `gcloud auth login` once if needed).
#
# Usage: scripts/upload-hls.sh [BUCKET] [SRC_DIR]
set -euo pipefail

BUCKET="${1:-cardiosurf-mvp-media}"
SRC="${2:-$HOME/Documents/cardio-media/hls}"

echo "Syncing $SRC -> gs://$BUCKET/hls"
gcloud storage rsync -r "$SRC" "gs://$BUCKET/hls"

echo "Setting content-type / cache-control..."
# Segments are immutable -> cache for a year. Playlists change on re-encode.
gcloud storage objects update "gs://$BUCKET/hls/**/*.ts" \
  --content-type=video/mp2t \
  --cache-control="public,max-age=31536000,immutable"
gcloud storage objects update "gs://$BUCKET/hls/**/*.m3u8" \
  --content-type=application/vnd.apple.mpegurl \
  --cache-control="public,max-age=60"

echo "UPLOAD COMPLETE"
echo "Base URL: https://storage.googleapis.com/$BUCKET"
