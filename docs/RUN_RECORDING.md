# Run recording ("Record my run")

An opt-in, off-by-default way to get a shareable 720×1280 video of a run:
the map on top, the player's camera below, with score/combo/judgement HUD
and a 4 s end card. Everything happens on the phone; nothing is uploaded
unless the user saves or shares the file.

```
level/[id].tsx   "Record my run" toggle (persisted, explainer once)
                 background prefetch of composite/<level>/game-576.mp4
      │ record=1
preflight.tsx    camera at the recording preset (same frame size as the run)
      │ record=1
workout.tsx      RunRecordingSession
                   ├─ cardiosurf-pose  startRecording()  → AVAssetWriter → Caches/cardiosurf-run-<uuid>.mp4
                   └─ RunRecordingLog  judgements, expiries, upcoming cues, RunClock segments, pose focus
                 finish(): stopRecording() → log .json next to the clip → stageRecordedRun(runId)
      │ router.replace('/summary')
summary.tsx      RunVideoCard: consumeRecordedRun(runId)
                   ├─ compositionPlan.ts  RunLogFile → CompositionPlan (pure TS)
                   └─ cardiosurf-composer compose(plan) → Caches/cardiosurf-run-videos/<runId>.mp4 + .jpg
                 Export sheet: Save to Photos (add-only) · Share (system sheet) · Delete
```

Source of truth for each piece:

| Piece | File |
| --- | --- |
| Camera writer + threading | `modules/cardiosurf-pose/ios/CardioSurfPoseModule.swift`, `modules/cardiosurf-pose/src/index.ts` |
| Run log | `src/lib/runRecordingLog.ts` |
| Composition plan (pure TS) | `src/lib/compositionPlan.ts` |
| Composer (Swift, dumb) | `modules/cardiosurf-composer/ios/CardioSurfComposerModule.swift`, `modules/cardiosurf-composer/index.ts` |
| Orchestration | `src/lib/runRecording.ts` |
| Composite asset URL + cache | `src/lib/videoSources.ts` (`getCompositeGameSource`), `src/lib/compositeAssetCache.ts`, `src/lib/compositeCachePolicy.ts` |
| Asset pipeline | `scripts/transcode-composite.sh`, `scripts/upload-hls.sh` |
| UX | `src/app/level/[id].tsx`, `src/components/RecordRunExplainerSheet.tsx`, `src/app/workout.tsx`, `src/components/RunVideoCard.tsx` |
| Preference | `src/lib/playSetup.ts` (`recordRun`, `recordExplainerSeen`) |
| Tests | `npm run test:recording-log` (`scripts/replay-recording-log.ts`) |

## 1. Camera recording (pose module)

The pose module owns the only `AVCaptureSession`. Recording is an
`AVAssetWriter` fed from the existing `AVCaptureVideoDataOutput` delegate —
never `AVCaptureMovieFileOutput`, which starves the data output on most
devices and would kill tracking while recording.

- **Codec:** H.264 High, 4.5 Mbps, 30 fps, keyframe every 2 s, no frame
  reordering, `expectsMediaDataInRealTime = true`. HEVC would be a one-line
  change (`AVVideoCodecType.hevc`) but H.264 is accepted by every share target
  and by the composer's `AVAssetExportSession` preset without a transcode; the
  size difference at 720p over a 5–15 minute run is tens of MB in Caches.
- **Frames** are appended zero-copy (`AVAssetWriterInput.append(CMSampleBuffer)`)
  when `isReadyForMoreMediaData`, else dropped and counted (`dropped` in the
  stop payload). The writer never blocks the capture queue.
- **File:** `Caches/cardiosurf-run-<uuid>.mp4`. `cancelRecording()` and the
  view's `deinit` delete it; `stopRecording()` finalizes it.
- **Orientation/mirroring:** the capture connection already sets portrait
  rotation and `isVideoMirrored = true` for the front camera, so the pixel
  buffers the writer receives are upright and selfie-mirrored. The writer input
  keeps `transform = .identity`: what the preview shows is what the file
  contains. (Vision sees the same buffers, which is why the keypoints match the
  preview today.)
- **Preset:** `.hd1280x720` whenever `recordingEnabled` is set on the view
  (level toggle on), `.high` otherwise. One preset for the whole run matters
  more than the choice itself: a >15% change in delivered frame size resets
  the analyzer's calibration, so preflight and workout both receive
  `recordingEnabled` and the handoff sees a constant frame size. Detection
  quality is unaffected — Vision's body-pose model downsamples its input far
  below 720p, so 1080p buys nothing for keypoints while costing ISP bandwidth
  and encoder work. `.high` stays the default so existing latency baselines
  keep their meaning.
- **Backgrounding:** `UIApplication.didEnterBackgroundNotification` and
  `AVCaptureSession.wasInterruptedNotification` finalize the file as it stands
  and emit `onRecordingState { state: 'interrupted', durationMs }`. JS marks the
  log as interrupted (`recording.interruptedAtEpochMs`) and the composition
  simply ends where the clip ends. A later `stopRecording()` rejects with
  `E_NOT_RECORDING`, which JS treats as "already ended".
- **Teardown race:** the run ends with `stopRecording()` and a
  `router.replace('/summary')`. The camera view's `deinit` cancels a recorder
  that is still writing, but leaves one that is `finishing`/`finished` alone,
  and `workout.tsx` waits (≤1.5 s) for the stop to settle before navigating.
- **JS surface** (`cardiosurf-pose`): `startRunRecording(): Promise<{ path,
  startedAtEpochMs }>` (resolves on the first written frame, 3 s timeout),
  `stopRunRecording(): Promise<{ path, durationMs, startedAtEpochMs, frames,
  dropped }>`, `cancelRunRecording()`, `isRunRecordingActive()`,
  `addRecordingStateListener(cb)` with states
  `finished | interrupted | cancelled | error`. `startedAtEpochMs` is the
  camera PTS mapped through the same `epochOffsetMs` as the pose stamps, so
  the run log's wall times line up with the clip to the frame.

## 2. Threading restructure and the latency gate

Before: `captureOutput` ran on `visionQueue`, throttled to 10 Hz and executed
`VNDetectHumanBodyPoseRequest` **inline**, so every camera frame waited behind
the previous inference. A writer on that queue would have dropped most frames.

Now (`CardioSurfPoseModule.swift`, `captureOutput`):

1. `captureQueue` (delegate queue, cheap work only): stamp `captureTs`, if a
   recorder exists append the sample buffer, then
2. if ≥100 ms have passed since the last dispatched inference **and**
   `inferenceInFlight == false`: retain the `CVPixelBuffer`, set the flag and
   `inferenceQueue.async { Vision → keypoints → extractedTs → main → onPose }`,
   clearing the flag when done. Otherwise drop the frame for inference (the
   writer still gets it).

The cadence stays 10 Hz (a slow inference lowers it, exactly as the inline
version did, but no longer stalls capture). `captureTs / extractedTs /
dispatchTs` keep their meaning and `timestamp` is still the dispatch time.
Vision is still one request at a time, on one serial queue.

**Regression check.** `pose_latency` (`src/lib/poseLatency.ts`, sent once per
run by `logPoseLatency`) is the gate. On the same device and the same level,
with the toggle OFF:

1. Play three runs on the build before this change and note the
   `pose_latency` event's `total_p50_ms` and `inference_p50_ms` (Singular
   dashboard, or the `[analytics]` console line in a dev build; the workout HUD
   also shows `lat p50` live in `__DEV__`).
2. Play three runs on this build, toggle OFF. Median of the new
   `total_p50_ms` must be **≤ the old median + 5 ms** and `stale_frames_dropped`
   must not increase. `inference_p50_ms` may move by the cost of one queue hop
   (single-digit ms); `mainHop`, `bridge`, `analyze` must be unchanged.
3. Play three runs with the toggle ON (recording at 720p). `total_p50_ms`
   must stay within 10 ms of step 2 and `frames` must stay ≈ 10 × run
   seconds — that proves the writer is not starving inference. Check the
   stop payload's `dropped` (logged in dev) is a small fraction of `frames`.

If step 2 fails the restructure itself regressed; if only step 3 fails the
encoder is contending for the capture queue (lower the bitrate before touching
the threading).

## 3. Run log (`runRecordingLog.ts`)

`RunRecordingSession` (in `runRecording.ts`) creates a `RunRecordingLog` with
the run's metadata and hooks it into the existing workout paths:

| Event | Hook in `workout.tsx` | Log entry |
| --- | --- | --- |
| Graded move | `handlePoseFrame` → `cueJudge.onMove` | `{k:'j', w, v, g, d, m, s, c}` |
| Cue expiry | `timeUpdate` → `cueJudge.onTick > 0` | `{k:'e', w, v, n, s, c}` |
| Upcoming cue change | `timeUpdate` → `cueJudge.upcoming()[0]` | `{k:'u', w, m, at}` |
| Playback segments | `runClock.tick` kind + `isAdvancing()` on every tick; `onGate` on status/playing/swap | `segments: {ws, we, vs, ve, r, loop}` |
| Body position | `handlePoseFrame` (nose + hips, conf ≥ 0.3) | `pose: {headY, hipY, samples}` |

`w` is wall ms since the recording's first frame, `v` is video seconds. A
segment says "from wall `ws` to `we` the game showed video `vs`→`ve` at rate
`r`, in loop `loop`". Pauses, stalls, buffering, seeks and the AirPlay swap
close a segment (the game freezes in the composite); loop wraps close one and
open the next at `vs = 0`. Memory is bounded (`MAX_LOG_EVENTS = 5000`,
`MAX_LOG_SEGMENTS = 2000`, pose focus is a running mean over at most 600
samples) and the file is
`serializeRunLog` JSON next to the clip. `parseRunLog` validates the version
and shapes on the way back in.

## 4. Composite game asset

The composer cannot read the HLS ladder (no random access to a progressive
track), so each level also ships one MP4 cut to the game region:

```
# 720x576, H.264 ~1.2 Mbps, 30 fps, fast-start, AAC 96k (used only when includeGameAudio is on)
scripts/transcode-composite.sh ~/Documents/cardio-media/upload ~/Documents/cardio-media/hls
#   → ~/Documents/cardio-media/hls/composite/level<N>/game-576.mp4
#   CROP_BIAS=0.5 (centre) by default; LEVELS="3 4" to cut a subset

# uploads hls/ as before AND composite/ → gs://cardiosurf-mvp-media/composite/<slug>/game-576.mp4
scripts/upload-hls.sh cardiosurf-mvp-media ~/Documents/cardio-media/hls
```

Neither script has been run (no media locally, no credentials). Composite
MP4s get `Cache-Control: public, max-age=31536000, immutable`; re-cutting a
level means a new slug, as with the HLS masters.

In the app, `getCompositeGameSource(levelId)` resolves the URL and
`compositeAssetCache.ts` keeps an LRU of `CACHE_CAPACITY = 3` levels under
`Caches/cardiosurf-composite/`, with an `index.json` of `{levelId, file,
bytes, lastUsedAt}`. `checkCompositeAvailable` HEADs the URL; a 404 disables
the toggle with "Recording isn't available for this map yet." The level screen
prefetches as soon as the toggle is on ("Preparing your recording…"); the
summary falls back to a foreground download if that never landed.

## 5. Composition plan (`compositionPlan.ts` → Swift)

`buildCompositionPlan(log, { gameDurationSec, cameraDurationSec, theme,
endCard, includeGameAudio })` turns the run log into a plan the Swift composer
executes literally. Everything with a decision in it lives here so it is
testable in Node.

```jsonc
{
  "version": 1,
  "canvas": { "width": 720, "height": 1280 },
  "gameRegion":   { "x": 0, "y": 0,   "width": 720, "height": 576 },
  "cameraRegion": { "x": 0, "y": 576, "width": 720, "height": 704 },
  "safeZone": { "minX": 40, "maxX": 600, "minY": 160, "maxY": 960 },
  "durationSec": 184.0,          // camera + end card
  "runDurationSec": 180.0,       // camera duration
  "camera": { "durationSec": 180.0, "source": { "width": 720, "height": 1280 },
              "cropRect": { "x": 0, "y": 231.4, "width": 720, "height": 704 }, "focusY": 0.52 },
  "inserts": [
    { "kind": "play",   "gameStart": 0,     "gameEnd": 62.4, "canvasStart": 0,    "canvasEnd": 52.0 },  // 1.2×
    { "kind": "freeze", "gameAt": 62.4,                       "canvasStart": 52.0, "canvasEnd": 55.3 },  // pause
    { "kind": "play",   "gameStart": 62.4,  "gameEnd": 90.0, "canvasStart": 55.3, "canvasEnd": 78.3 },
    { "kind": "play",   "gameStart": 0,     "gameEnd": 41.0, "canvasStart": 78.3, "canvasEnd": 112.5 }  // loop wrap
  ],
  "hud": {
    "pops": [{ "at": 12.3, "grade": "perfect", "text": "PERFECT", "deltaMs": -18 }],
    "popCenter": { "x": 360, "y": 300 },
    "score": [{ "start": 0, "end": 12.3, "text": "0" }, { "start": 12.3, "end": 20.1, "text": "300" }],
    "combo": [{ "start": 12.3, "end": 20.1, "text": "×1" }],
    "scoreAnchor": { "right": 600, "top": 176 },
    "chevrons": [{ "start": 10.8, "end": 12.3, "move": "jump" }],
    "chevronCenter": { "x": 360, "y": 470 },
    "watermark": { "text": "CARDIOSURF", "x": 40, "y": 940 }
  },
  "endCard": { "start": 180.0, "durationSec": 4, "levelName": "Neon Harbor", "score": 8420,
               "accuracyPct": 91, "maxCombo": 27, "personalBest": true,
               "cta": "Beat my score", "wordmark": "CARDIOSURF" },
  "theme": { "accent": "#D7FF3E", "perfect": "#D7FF3E", "good": "#3DC5F0", "miss": "#FF3B30" },
  "audio": { "includeGameAudio": false }
}
```

- **Inserts** are contiguous and cover `[0, runDurationSec]` exactly (checked
  by `validateCompositionPlan`). A `play` insert is `insertTimeRange` +
  `scaleTimeRange` (rate 0.85/1.0/1.2 falls out of the two ranges' lengths); a
  `freeze` inserts a single frame (`FREEZE_FRAME_SEC`) and stretches it. Gaps
  between segments (pauses, stalls, swap) freeze the last shown frame; time
  before the first segment freezes frame 0.
- **Camera layout — cover-crop with body bias.** The clip is 9:16 (720×1280)
  and the camera region is 720×704, so a `cropRect` of 720×704 slides
  vertically. `focusY` is the mean of head and hip y from the run log's pose
  focus (else 0.5) and the crop is centred on it, clamped to the frame. Chosen
  over aspect-fit with a blurred fill because the fill would waste ~45% of the
  region on blur and shrink the player to ~400 px wide; a cover-crop keeps
  the player full-width and the bias keeps head and hips inside the crop.
  `focusY` is in the plan for diagnostics.
- **Safe zone** `x∈[40,600], y∈[160,960]`: every HUD anchor (score/combo
  top-right, chevrons, watermark bottom-left, end-card text) is inside it so
  TikTok/Reels UI never covers it. Pops are centred in the game half.
- **Audio:** `includeGameAudio` is `false` by default — the owner has not
  confirmed music rights, so exports are silent. When `true`, the game asset's
  AAC track is inserted with the same time ranges (freezes are silent). The
  microphone is never used.
- **End card** is `END_CARD_SEC = 4` s appended after the camera ends: level
  name, score, accuracy %, max combo, a PB badge when
  `personalBestForRun` said so, "Beat my score", wordmark.

`CardioSurfComposerModule.swift` decodes the plan and builds
`AVMutableComposition` (game video, camera video, optional game audio),
`AVMutableVideoComposition` (720×1280 @ 30 fps; camera layer transform =
crop + translate, game layer identity) and an
`AVVideoCompositionCoreAnimationTool` layer tree with `CAKeyframeAnimation`s
(discrete, `beginTime = AVCoreAnimationBeginTimeAtZero`) for every HUD
interval and pop. Export uses `AVAssetExportSession` preset 1280×720,
`shouldOptimizeForNetworkUse = true`, on a background queue, with progress
events at 4 Hz; a JPEG thumbnail is written next to the output. `probe(path)`
returns duration and size for the plan builder.

## 6. UX rules

- The toggle lives on the level screen's "Share" section, default OFF,
  persisted per install. It is disabled with a reason when the destination is
  TV (v1 does not record AirPlay runs — the companion remount would release
  the writer), when tracking is unavailable, when camera access is denied, or
  when the composite asset 404s. First ON shows `RecordRunExplainerSheet` once.
- Onboarding never passes `record=1`, so the first run is never recorded.
- `workout.tsx` starts the session on the first `readyToPlay`, shows a red
  dot + "REC" pill next to the AirPlay control and on the PiP; hiding the PiP
  is withheld while recording because the PiP *is* the recorder. `finish()`
  stops and stages; `exitEarly` cancels and deletes; moving to a TV mid-run
  cancels.
- `summary.tsx` shows `RunVideoCard` only for recorded runs: "Saving your
  recording…" → "Building your video… NN%" → thumbnail + Save/Share, with an
  export sheet (inline preview, Save to Photos, Share…, Delete). The last 3
  composites are kept in `Caches/cardiosurf-run-videos/`; raw clips and logs
  are deleted after a successful compose (or on failure).
- Analytics (facade, `safely`): `run_recording_enabled`,
  `run_recording_completed {duration_ms, compose_ms, file_bytes}`,
  `run_recording_shared {target: photos|share}`,
  `run_recording_failed {stage: record|asset|log|plan|compose|export}`.

## 7. Verifying without a device

- `npm run test:recording-log` — log round-trip, segment → insert planning
  (rates, loops, pauses, clipping), HUD keyframes, bounded memory, camera crop
  bias, asset URL resolver, cache LRU policy.
- `npx tsc --noEmit`, eslint on the changed files, `xcrun swiftc -parse` on
  both Swift modules. The AVFoundation/CoreAnimation parts of both Swift files
  were also type-checked against the iphoneos SDK with a stub of the
  ExpoModulesCore surface (locally, not committed).

Needs a device build: the writer (frame drops, first-frame timeout,
backgrounding), the preset switch and calibration handoff, the composer's
actual output (layer geometry, text rendering, export duration), Save to
Photos and the share sheet, and the latency gate in §2.

## 8. Owner TODOs (in order)

1. **Cut and upload the composites** for every hosted level
   (`scripts/transcode-composite.sh` then `scripts/upload-hls.sh`); until a
   level's `composite/<slug>/game-576.mp4` exists the toggle is disabled for
   that map. Note `upload-hls.sh` syncs `hls/` while the app reads `hls-v2/`
   — point the script at the right prefix when you next upload.
2. **Device build** and run the §2 latency check before shipping.
3. **App Privacy labels:** leave "Photos or Videos" as *not collected* (see
   `APP_STORE_SUBMISSION.md` for the reasoning), update the Review Notes
   sentence there, and re-check the camera permission string wherever it is
   quoted in marketing.
4. **Music rights:** exports are silent until confirmed. When cleared, expose
   `includeGameAudio` (currently a `ComposeRunOptions` flag) as a user
   setting; the pipeline already muxes the AAC track.
5. Publish the updated `docs/privacy.html`.
