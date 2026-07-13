#!/usr/bin/env bash
#
# End-to-end per-level swap driver: transcode -> master -> upload -> verify ->
# free local disk. Processes one level at a time to bound local disk usage
# (full-length HLS output can be ~1GB+ per orientation).
#
# Usage: LEVELS="1 2 3" scripts/swap-run.sh
set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
SRC_DIR="$HOME/Documents/cardio-media/upload"
OUT_DIR="$HOME/Documents/cardio-media/hls"
BUCKET="cardiosurf-mvp-media"
BASE="https://storage.googleapis.com/$BUCKET"
LEVELS="${LEVELS:-1 2 3 4 5 9 10 11 12}"

log() { echo "[$(date '+%H:%M:%S')] $*"; }

log "SWAP-RUN START levels: $LEVELS"
for n in $LEVELS; do
  log "==================== LEVEL $n ===================="
  df -h "$OUT_DIR" | tail -1

  # 1) transcode + write master for this level only
  if ! LEVELS="$n" "$REPO/scripts/transcode-hls.sh" "$SRC_DIR" "$OUT_DIR"; then
    log "[FAIL] transcode level$n"
    continue
  fi

  # 2) upload this level's subtree
  log "uploading level$n ..."
  gcloud storage rsync -r "$OUT_DIR/level$n" "gs://$BUCKET/hls/level$n" || { log "[FAIL] rsync level$n"; continue; }
  gcloud storage objects update "gs://$BUCKET/hls/level$n/**/*.ts" \
    --content-type=video/mp2t --cache-control="public,max-age=31536000,immutable" >/dev/null || log "[warn] ts ctype level$n"
  gcloud storage objects update "gs://$BUCKET/hls/level$n/**/*.m3u8" \
    --content-type=application/vnd.apple.mpegurl --cache-control="public,max-age=60" >/dev/null || log "[warn] m3u8 ctype level$n"

  # 3) verify each orientation that exists
  for orientation in vertical horizontal; do
    [[ -d "$OUT_DIR/level$n/$orientation" ]] || continue
    url="$BASE/hls/level$n/$orientation/master.m3u8"
    code=$(curl -s -o /dev/null -w '%{http_code}' "$url")
    log "  verify $orientation master -> HTTP $code  ($url)"
  done

  # 4) free local disk for this level
  rm -rf "$OUT_DIR/level$n"
  log "  freed local hls/level$n"
done
log "SWAP-RUN COMPLETE"
