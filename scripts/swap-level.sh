#!/usr/bin/env bash
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

N="${1:?level number required}"
SRC="$HOME/Documents/cardio-media/upload"
OUT="$HOME/Documents/cardio-media/hls"
BUCKET="cardiosurf-mvp-media"
APP="$HOME/Documents/cardioapp"

echo "======== LEVEL $N ========"
df -h "$HOME/Documents" | tail -1

encode_orientation() {
  local orientation="$1"
  local src="$SRC/level$N/$orientation.mp4"
  local outdir="$OUT/level$N/$orientation"

  if [[ ! -f "$src" ]]; then
    echo "[skip] no $orientation for level$N"
    return 0
  fi

  local w h
  w=$(ffprobe -v error -select_streams v:0 -show_entries stream=width -of csv=p=0 "$src" | awk 'NF{print $1; exit}')
  h=$(ffprobe -v error -select_streams v:0 -show_entries stream=height -of csv=p=0 "$src" | awk 'NF{print $1; exit}')
  if [[ -z "$w" || -z "$h" || "$w" == "0" ]]; then
    echo "[skip] unreadable $src"
    return 0
  fi

  echo "[transcode] level$N/$orientation (${w}x${h})"
  rm -rf "$outdir"
  mkdir -p "$outdir"

  local short
  if [[ "$w" -ge "$h" ]]; then short="$h"; else short="$w"; fi

  local p vb maxr buf ab vf rdir
  for spec in "1080:5000k:5350k:7500k:128k" "720:2800k:3000k:4200k:128k" "480:1400k:1500k:2100k:96k" "360:800k:856k:1200k:96k"; do
    IFS=':' read -r p vb maxr buf ab <<< "$spec"
    if [[ "$p" -gt "$short" ]]; then
      echo "  [skip] ${p}p > source short side $short"
      continue
    fi
    rdir="$outdir/$p"
    mkdir -p "$rdir"
    if [[ "$w" -ge "$h" ]]; then vf="scale=-2:${p}"; else vf="scale=${p}:-2"; fi
    echo "  [enc] $orientation ${p}p @ $vb"
    ffmpeg -y -hide_banner -loglevel error -i "$src" \
      -vf "$vf" -c:v libx264 -preset veryfast -profile:v high -level 4.1 \
      -b:v "$vb" -maxrate "$maxr" -bufsize "$buf" \
      -force_key_frames "expr:gte(t,n_forced*4)" \
      -c:a aac -b:a "$ab" -ac 2 \
      -hls_time 4 -hls_playlist_type vod \
      -hls_segment_filename "$rdir/seg_%03d.ts" \
      "$rdir/stream.m3u8"
  done
  touch "$outdir/.done"
  echo "  [done] $orientation"
}

encode_orientation vertical
encode_orientation horizontal

"$APP/scripts/write-masters.sh" "$SRC" "$OUT" "$N"

if [[ -d "$OUT/level$N" ]]; then
  echo "[upload] level$N"
  gcloud storage rsync -r "$OUT/level$N" "gs://$BUCKET/hls/level$N"
  gcloud storage objects update "gs://$BUCKET/hls/level$N/**/*.ts" \
    --content-type=video/mp2t --cache-control="public,max-age=31536000,immutable" >/dev/null 2>&1 || true
  gcloud storage objects update "gs://$BUCKET/hls/level$N/**/*.m3u8" \
    --content-type=application/vnd.apple.mpegurl --cache-control="public,max-age=60" >/dev/null 2>&1 || true
  for o in vertical horizontal; do
    code=$(curl -s -o /dev/null -w "%{http_code}" "https://storage.googleapis.com/$BUCKET/hls/level$N/$o/master.m3u8")
    echo "  verify $o -> $code"
  done
  rm -rf "$OUT/level$N"
  echo "[freed] local HLS"
fi
echo "LEVEL $N COMPLETE"
df -h "$HOME/Documents" | tail -1
