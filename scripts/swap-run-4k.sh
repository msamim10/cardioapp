#!/usr/bin/env bash
#
# Disk-frugal per-rung encoder for 4K sources (adds 2160p + 1440p rungs).
# Encodes ONE rendition at a time, uploads it, deletes it locally, then moves on.
# Intended for high-quality test sources (e.g. level13).
#
# Usage: LEVELS="13" scripts/swap-run-4k.sh
set -uo pipefail

SRC_DIR="${SRC_DIR:-$HOME/Documents/cardio-media/upload}"
SOURCE_PREFIX="${SOURCE_PREFIX-level}"
OUT_DIR="${OUT_DIR:-$HOME/Documents/cardio-media/hls}"
BUCKET="${BUCKET:-cardiosurf-mvp-media}"
HLS_PREFIX="${HLS_PREFIX:-hls}"
DELETE_SOURCE_AFTER_UPLOAD="${DELETE_SOURCE_AFTER_UPLOAD:-0}"
BASE="https://storage.googleapis.com/$BUCKET/$HLS_PREFIX"
LEVELS="${LEVELS:-13}"
SEG=4

# rung: "p vb maxr buf ab"  (p = long-edge scale target)
RUNGS=(
  "2160 16000k 17120k 24000k 128k"
  "1440 9000k  9630k  13500k 128k"
  "1080 5000k  5350k  7500k  128k"
  "720  2800k  3000k  4200k  128k"
)

# master resolution strings per rung, keyed by p and orientation
res_vertical() { case "$1" in 2160) echo 2160x3840;; 1440) echo 1440x2560;; 1080) echo 1080x1920;; 720) echo 720x1280;; esac; }
res_horizontal() { case "$1" in 2160) echo 3840x2160;; 1440) echo 2560x1440;; 1080) echo 1920x1080;; 720) echo 1280x720;; esac; }
bw_of() { case "$1" in 2160) echo 17248000;; 1440) echo 9758000;; 1080) echo 5478000;; 720) echo 3128000;; esac; }

log() { echo "[$(date '+%H:%M:%S')] $*"; }

local_rung_ready() {
  local dir="$1" playlist="$1/stream.m3u8" segment
  [[ -s "$playlist" ]] || return 1
  grep -q '^#EXT-X-ENDLIST' "$playlist" || return 1
  while IFS= read -r segment; do
    [[ "$segment" == \#* || -z "$segment" ]] && continue
    [[ -s "$dir/$segment" ]] || return 1
  done < "$playlist"
}

remote_rung_ready() {
  local n="$1" orientation="$2" p="$3" playlist segment url
  url="$BASE/level$n/$orientation/$p"
  playlist=$(curl -fsS "$url/stream.m3u8") || return 1
  grep -q '^#EXT-X-ENDLIST' <<< "$playlist" || return 1
  while IFS= read -r segment; do
    [[ "$segment" == \#* || -z "$segment" ]] && continue
    curl -fsS -o /dev/null "$url/$segment" || return 1
  done <<< "$playlist"
}

write_master() {
  # $1 = orientation, $2 = dest file
  local o="$1" f="$2" p bw res
  { printf '#EXTM3U\n#EXT-X-VERSION:3\n'
    for r in "${RUNGS[@]}"; do
      read -r p _ _ _ _ <<< "$r"
      bw=$(bw_of "$p")
      if [[ "$o" == "vertical" ]]; then res=$(res_vertical "$p"); else res=$(res_horizontal "$p"); fi
      printf '#EXT-X-STREAM-INF:BANDWIDTH=%s,RESOLUTION=%s\n%s/stream.m3u8\n' "$bw" "$res" "$p"
    done
  } > "$f"
}

log "4K FRUGAL START levels: $LEVELS"
for n in $LEVELS; do
  log "==================== LEVEL $n ===================="
  for orientation in vertical horizontal; do
    src="$SRC_DIR/${SOURCE_PREFIX}${n}/$orientation.mp4"
    [[ -f "$src" ]] || { log "  [skip] no source $orientation"; continue; }
    ok=1
    for r in "${RUNGS[@]}"; do
      read -r p vb maxr buf ab <<< "$r"
      rdir="$OUT_DIR/level$n/$orientation/$p"
      if remote_rung_ready "$n" "$orientation" "$p"; then
        rm -rf "$rdir"
        log "    [skip] rung $p already uploaded + verified"
        continue
      fi
      mkdir -p "$rdir" || { log "  [FAIL] mkdir $rdir"; ok=0; break; }
      if local_rung_ready "$rdir"; then
        log "    [reuse] complete local rung $p"
      else
        rm -rf "$rdir"
        mkdir -p "$rdir" || { log "  [FAIL] mkdir $rdir"; ok=0; break; }
        if [[ "$orientation" == "vertical" ]]; then vf="scale=${p}:-2"; else vf="scale=-2:${p}"; fi
        df -h "$OUT_DIR" | tail -1 | awk -v L="$n" -v O="$orientation" -v P="$p" '{print "    ["L"/"O"/"P"] free="$4}'
        ffmpeg -y -hide_banner -loglevel error -i "$src" -vf "$vf" \
          -c:v libx264 -preset fast -profile:v high -level 5.1 \
          -b:v "$vb" -maxrate "$maxr" -bufsize "$buf" \
          -force_key_frames "expr:gte(t,n_forced*${SEG})" \
          -c:a aac -b:a "$ab" -ac 2 \
          -hls_time "$SEG" -hls_playlist_type vod \
          -hls_segment_filename "$rdir/seg_%03d.ts" "$rdir/stream.m3u8"
        if [[ $? -ne 0 ]]; then log "  [FAIL] encode level$n/$orientation/$p"; ok=0; break; fi
      fi
      gcloud storage rsync -r --delete-unmatched-destination-objects "$rdir" "gs://$BUCKET/$HLS_PREFIX/level$n/$orientation/$p" >/dev/null 2>&1 || { log "  [FAIL] upload rung $p"; ok=0; break; }
      gcloud storage objects update "gs://$BUCKET/$HLS_PREFIX/level$n/$orientation/$p/*.ts" \
        --content-type=video/mp2t --cache-control="public,max-age=31536000,immutable" >/dev/null 2>&1
      gcloud storage objects update "gs://$BUCKET/$HLS_PREFIX/level$n/$orientation/$p/stream.m3u8" \
        --content-type=application/vnd.apple.mpegurl --cache-control="public,max-age=60" >/dev/null 2>&1
      if ! remote_rung_ready "$n" "$orientation" "$p"; then
        log "  [FAIL] uploaded rung $p unavailable or incomplete"
        ok=0
        break
      fi
      rm -rf "$rdir"
      log "    [ok] rung $p uploaded + freed"
    done
    [[ $ok -eq 1 ]] || { log "  [FAIL] level$n/$orientation incomplete"; continue; }
    m="$OUT_DIR/level$n/$orientation/master.m3u8"
    write_master "$orientation" "$m"
    gcloud storage cp "$m" "gs://$BUCKET/$HLS_PREFIX/level$n/$orientation/master.m3u8" \
      --content-type=application/vnd.apple.mpegurl --cache-control="public,max-age=60" >/dev/null 2>&1 || {
        log "  [FAIL] upload $orientation master"
        continue
      }
    code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/level$n/$orientation/master.m3u8")
    log "  verify $orientation master -> HTTP $code"
    if [[ "$code" != "200" ]]; then
      log "  [FAIL] level$n/$orientation master unavailable"
      continue
    fi
    rm -rf "$OUT_DIR/level$n/$orientation"
    if [[ "$DELETE_SOURCE_AFTER_UPLOAD" == "1" ]]; then
      rm -f "$src"
      log "  removed uploaded source $src"
    fi
  done
  rm -rf "$OUT_DIR/level$n"
done
log "4K FRUGAL COMPLETE"
