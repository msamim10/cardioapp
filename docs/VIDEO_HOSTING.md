# Video Hosting & Streaming

How the 7 runner levels are delivered to the app.

## Architecture (what the big apps do)

We do **not** bundle the videos in the app (they're 5.8 GB raw) and we don't
stream one giant file. Each video is transcoded into an **HLS adaptive-bitrate
ladder** and streamed:

- Every source video → 4 renditions: **1080p / 720p / 480p / 360p**, split into
  4-second segments (`.ts`) with a per-rendition playlist and a `master.m3u8`.
- The player (`expo-video`, AVPlayer on iOS / ExoPlayer on Android) reads the
  `master.m3u8` and **switches quality in real time** to match the network —
  weak signal drops to 480p instead of buffering. Same ABR approach as
  YouTube / TikTok / Netflix.
- Hosting: **Firebase Storage / Google Cloud Storage**, served over the public
  GCS URL so HLS's relative segment paths resolve correctly.

```
<bucket>/hls/level<N>/<vertical|horizontal>/
    master.m3u8          <- app points here
    1080/stream.m3u8 + seg_*.ts
    720/stream.m3u8  + seg_*.ts
    480/stream.m3u8  + seg_*.ts
    360/stream.m3u8  + seg_*.ts
```

Level → game-level mapping lives in `src/lib/videoSources.ts`.

## Live setup (already provisioned)

| Thing | Value |
|-------|-------|
| Firebase / GCP project | `cardiosurf-mvp` |
| Public media bucket | `gs://cardiosurf-mvp-media` (allUsers: Storage Object Viewer) |
| App base URL | `https://storage.googleapis.com/cardiosurf-mvp-media` (in `.env`) |
| Auth for CLI | `gcloud auth login` as the project owner account |

Console: <https://console.firebase.google.com/project/cardiosurf-mvp/overview>

## Pipeline (all scripted)

### 1. Transcode (local)

```bash
scripts/transcode-hls.sh        # ~/Documents/cardio-media/upload -> .../hls
```

`ffmpeg` + `libx264`. Skips levels already marked `.done`, so it's resumable.
It calls `write-masters.sh` at the end to build the master playlists.

### 2. (Re)write master playlists

```bash
scripts/write-masters.sh        # computes RESOLUTION from the source dims
```

Run standalone any time you need to rebuild masters (e.g. after adding a level).

### 3. Upload to the bucket

```bash
scripts/upload-hls.sh           # gcloud storage rsync + correct content-types
```

Sets `Content-Type` (`application/vnd.apple.mpegurl`, `video/mp2t`) and
`Cache-Control` (segments immutable 1y, playlists 60s).

### 4. Point the app at the bucket

`.env` (already created, gitignored):

```
EXPO_PUBLIC_MEDIA_BASE_URL=https://storage.googleapis.com/cardiosurf-mvp-media
```

`getVideoSource('downtown', 'vertical')` →
`https://storage.googleapis.com/cardiosurf-mvp-media/hls/level1/vertical/master.m3u8`.

## Recreating the cloud setup from scratch

If the bucket/project ever needs rebuilding (reference):

```bash
firebase projects:create cardiosurf-mvp --display-name "CardioSurf"
gcloud config set project cardiosurf-mvp
gcloud billing projects link cardiosurf-mvp --billing-account=<ACCOUNT_ID>
gcloud services enable storage.googleapis.com firebasestorage.googleapis.com
gcloud storage buckets create gs://cardiosurf-mvp-media --location=US --uniform-bucket-level-access
gcloud storage buckets add-iam-policy-binding gs://cardiosurf-mvp-media \
  --member=allUsers --role=roles/storage.objectViewer
```

## Cost notes

- The project is on the Blaze (pay-as-you-go) plan; billing is linked. At MVP
  scale this should stay in/near the free tier.
- GCS egress is ~$0.12/GB. HLS + compression cut per-play data ~5x vs the raw
  files and adapt down on slow networks.
- If traffic grows, put a CDN in front (Cloud CDN / Cloudflare / Firebase
  Hosting rewrite) to cache segments at the edge and cut egress cost + latency.

## Security note

The bucket is public read (it only holds non-sensitive workout videos, served
like a CDN). To gate content behind auth/paywall later, switch to short-lived
signed URLs or a token check at a CDN/Cloud Function. `.env`, service-account
keys, and the multi-GB media staging folder (`~/Documents/cardio-media/`) are
never committed.
