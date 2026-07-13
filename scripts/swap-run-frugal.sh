#!/usr/bin/env bash
#
# Disk-frugal per-rung swap driver for constrained free space.
# Encodes ONE rendition at a time, uploads it, deletes it locally, then moves
# on. Peak local usage is a single rung (~<500MB) instead of a whole level.
# Master playlists are generated directly (sources are all 1080x1920 / 1920x1080).
#
# Usage: LEVELS="4 5 9" scripts/swap-run-frugal.sh
set -uo pipefail

SRC_DIR="$HOME/Documents/cardio-media/upload"
OUT_DIR="$HOME/Documents/cardio-media/hls"
BUCKET="cardiosurf-mvp-media"
BASE="https://storage.googleapis.com/$BUCKET"
LEVELS="${LEVELS:-4 5 9 10 11 12}"
SEG=4

# rung: "p vb maxr buf ab"
RUNGS=(
  "1080 5000k 5350k 7500k 128k"
  "720  2800k 3000k 4200k 128k"
  "480  1400k 1500k 2100k 96k"
)

log() { echo "[$(date '+%H:%M:%S')] $*"; }

write_master() {
  # $1 = orientation (vertical|horizontal), $2 = dest file
  local o="$1" f="$2"
  if [[ "$o" == "vertical" ]]; then
    printf '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-STREAM-INF:BANDWIDTH=5478000,RESOLUTION=1080x1920\n1080/stream.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=3128000,RESOLUTION=720x1280\n720/stream.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=1596000,RESOLUTION=480x854\n480/stream.m3u8\n' > "$f"
  else
    printf '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-STREAM-INF:BANDWIDTH=5478000,RESOLUTION=1920x1080\n1080/stream.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=3128000,RESOLUTION=1280x720\n720/stream.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=1596000,RESOLUTION=854x480\n480/stream.m3u8\n' > "$f"
  fi
}

log "FRUGAL START levels: $LEVELS"
for n in $LEVELS; do
  log "==================== LEVEL $n ===================="
  for orientation in vertical horizontal; do
    src="$SRC_DIR/level$n/$orientation.mp4"
    [[ -f "$src" ]] || { log "  [skip] no source $orientation"; continue; }
    if [[ "$orientation" == "vertical" ]]; then vf="scale=1080:-2"; else vf="scale=-2:1080"; fi
    ok=1
    for r in "${RUNGS[@]}"; do
      read -r p vb maxr buf ab <<< "$r"
      rdir="$OUT_DIR/level$n/$orientation/$p"
      mkdir -p "$rdir" || { log "  [FAIL] mkdir $rdir"; ok=0; break; }
      if [[ "$orientation" == "vertical" ]]; then vf="scale=${p}:-2"; else vf="scale=-2:${p}"; fi
      df -h "$OUT_DIR" | tail -1 | awk -v L="$n" -v O="$orientation" -v P="$p" '{print "    ["L"/"O"/"P"] free="$4}'
      ffmpeg -y -hide_banner -loglevel error -i "$src" -vf "$vf" \
        -c:v libx264 -preset fast -profile:v high -level 4.1 \
        -b:v "$vb" -maxrate "$maxr" -bufsize "$buf" \
        -force_key_frames "expr:gte(t,n_forced*${SEG})" \
        -c:a aac -b:a "$ab" -ac 2 \
        -hls_time "$SEG" -hls_playlist_type vod \
        -hls_segment_filename "$rdir/seg_%03d.ts" "$rdir/stream.m3u8"
      if [[ $? -ne 0 ]]; then log "  [FAIL] encode level$n/$orientation/$p"; ok=0; break; fi
      # upload this rung then free it
      gcloud storage rsync -r "$rdir" "gs://$BUCKET/hls/level$n/$orientation/$p" >/dev/null 2>&1 || { log "  [FAIL] upload rung $p"; ok=0; break; }
      gcloud storage objects update "gs://$BUCKET/hls/level$n/$orientation/$p/*.ts" \
        --content-type=video/mp2t --cache-control="public,max-age=31536000,immutable" >/dev/null 2>&1
      gcloud storage objects update "gs://$BUCKET/hls/level$n/$orientation/$p/stream.m3u8" \
        --content-type=application/vnd.apple.mpegurl --cache-control="public,max-age=60" >/dev/null 2>&1
      rm -rf "$rdir"
      log "    [ok] rung $p uploaded + freed"
    done
    [[ $ok -eq 1 ]] || { log "  [FAIL] level$n/$orientation incomplete"; continue; }
    # master
    m="$OUT_DIR/level$n/$orientation/master.m3u8"
    write_master "$orientation" "$m"
    gcloud storage cp "$m" "gs://$BUCKET/hls/level$n/$orientation/master.m3u8" \
      --content-type=application/vnd.apple.mpegurl --cache-control="public,max-age=60" >/dev/null 2>&1
    code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/hls/level$n/$orientation/master.m3u8")
    log "  verify $orientation master -> HTTP $code"
    rm -rf "$OUT_DIR/level$n/$orientation"
  done
  rm -rf "$OUT_DIR/level$n"
done
log "FRUGAL COMPLETE"
