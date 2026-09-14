# Pose pipeline: latency, clock, beatmaps, scoring, rewards

Reference for the body-tracking → scoring → reward path. Code paths in
parentheses. The preflight calibration screen that precedes a run (framing
coaching, move test drive, handoff, fallbacks) is documented separately in
`docs/CALIBRATION_FLOW.md`.

## 1. Frame path and latency stamps

```
AVCaptureSession (front camera, portrait, mirrored)
  → captureQueue: [recording? append CMSampleBuffer to AVAssetWriter]           (CardioSurfPoseModule.swift)
                  throttle to 10 fps, skip if an inference is in flight,
                  retain the pixel buffer
  → inferenceQueue: VNDetectHumanBodyPoseRequest, keypoints
  → main: onPose event
  → JS: WorkoutCameraPreview.onPose → staleness guard → normalizeNativeFrame
  → workout.tsx handlePoseFrame → PoseAnalyzer.process                          (poseTracking.ts)
  → scoring gate (RunClock) → applyRecognizedMove | CueJudge.onMove
```

Every native frame carries epoch-ms stamps in the `Date.now()` domain. The
Swift side converts the camera's host-clock presentation time with one offset
per frame, `epochOffsetMs = Date().timeIntervalSince1970*1000 − CACurrentMediaTime()*1000`
(recomputed per frame — two clock reads — so a wall-clock step mid-run cannot
skew the stamps).

| Stamp          | Where                                            |
| -------------- | ------------------------------------------------ |
| `captureTs`    | `CMSampleBufferGetPresentationTimeStamp` → epoch |
| `extractedTs`  | after Vision + keypoint extraction (inferenceQueue) |
| `dispatchTs`   | on main, immediately before `onPose`             |
| `receivedTs`   | JS, first line of the `onPose` handler           |
| `classifiedTs` | JS, after `PoseAnalyzer.process` returns         |
| `timestamp`    | unchanged meaning: epoch ms at dispatch (= `dispatchTs`); drives analyzer cooldown/gap/velocity |

Deltas (`latencyDeltas` in `poseLatency.ts`), all clamped ≥ 0:

- `inference` = extracted − capture (camera queueing + Vision)
- `mainHop` = dispatch − extracted
- `bridge` = received − dispatch
- `analyze` = classified − received
- `total` = classified − capture

Samples go into `LatencyReservoir` (exact up to 4000 per metric, then
reservoir sampling). At run end (finish or early exit) one `pose_latency`
event is sent through the analytics facade with `{metric}_p50_ms`,
`{metric}_p95_ms`, `{metric}_max_ms` for the five metrics plus `frames` and
`stale_frames_dropped`. `run_complete` also carries `latency_p50_ms`,
`latency_p95_ms`, `stale_frames_dropped`. Nothing is logged per frame. In
`__DEV__` builds the workout HUD shows `lat p50 … · stale … · …f`.

Frames from builds that predate the stamps have no `captureTs`; they are
never dropped and produce no latency samples.

The capture queue never blocks on Vision (it used to run Vision inline on
`visionQueue`): the sample-buffer delegate only appends to the run recorder
when "Record my run" is on and hands at most one frame every 100 ms to the
serial `inferenceQueue`, skipping the hand-off while a previous inference is
still running. The 10 Hz cadence, the stamp semantics and `timestamp` are
unchanged; `inference` now also includes the hop onto `inferenceQueue`, which
is why `pose_latency` is the regression gate for the recording work — see
`docs/RUN_RECORDING.md` §2.

## 2. Staleness guard

`STALE_FRAME_MS = 250` (`poseLatency.ts`). In `WorkoutCameraPreview.onPose`,
`age = max(0, Date.now() − captureTs)`; if `age > 250` the frame is dropped
before the analyzer and before any `setState`, and `staleFramesDropped` is
incremented for the run. Negative ages (clock skew) clamp to 0.

Interaction with `FRAME_GAP_MS` (250, analyzer): the analyzer measures gaps
on `timestamp` (dispatch time) between frames it actually processed. At the
10 fps native cadence, one dropped frame leaves a 200 ms gap (fine); two or
more consecutive drops exceed 250 ms and the analyzer enters its
reacquisition path (3 frames, then "Reconnected", rearm on neutral) while
keeping calibration for up to `POSE_LOSS_GRACE_MS` (6 s). That is the intended
conservative response: a burst of stale frames means the pipeline is
congested, and scoring from positions the player already left is worse than a
300 ms rearm.

## 3. Scoring clock (`runClock.ts`)

The scoring clock is the **video** clock, not wall time. `RunClock` folds
expo-video `timeUpdate` ticks (0.5 s) into monotonic `videoPlayedSec` across
loops and exposes a scoring gate.

Gate — a recognized move scores only when all hold:

- `player.playing` is true (`playingChange`)
- status is `readyToPlay` (`statusChange`; loading/buffering close it)
- no AirPlay `replaceAsync` swap in flight
- ≥ `SEEK_SCORING_PAUSE_MS` (1000) since the last detected seek

While the gate is closed `handlePoseFrame` still runs the analyzer (tracking
and calibration stay alive) but recognized moves are ignored: no points, no
combo, not counted.

Tick classification with `delta = position − last`,
`naturalMax = max(2 × 0.5 × playbackRate, 1.5)` s:

| Case    | Rule                                                              | Effect                                   |
| ------- | ----------------------------------------------------------------- | ---------------------------------------- |
| natural | `0 < delta ≤ naturalMax`                                          | credited                                 |
| stall   | `delta = 0`                                                       | nothing                                  |
| seek    | `delta > naturalMax`, or backward jump that is not a wrap          | not credited, anchor moved, gate closed 1 s |
| wrap    | `delta < 0`, looping, `(length − last) + position ≤ 2 × LOOP_WRAP_WINDOW_S (6 s)` | tail + head credited |
| ignored | during an AirPlay swap                                            | nothing                                  |

The wrap rule bounds the total distance travelled rather than only how close
`last` was to the end, so one late tick before the wrap is still a wrap
while a seek from near the end back to mid-video is not.

Pause/stall: `playing=false` or status ≠ `readyToPlay` closes the gate; on
resume the anchor is reset to `player.currentTime` so paused wall time cannot
create a phantom delta.

AirPlay swap: `beginSwap()` before `replaceAsync`; after it resolves and
`currentTime` is restored, `endSwap(resumeAt, player.duration)` re-anchors at
`resumeAt`, adopts the new source's duration for wrap math, and suppresses
wraps for `SWAP_WRAP_SUPPRESS_MS` (2000) because the new source may report ~0
on its first tick (that tick becomes a seek, uncredited).

Video time between ticks (`videoTimeSec(now)`) is extrapolated from the wall
clock at the playback rate while advancing, capped at 0.75 s.

Free-scoring combo (`applyRecognizedMove`): two moves chain when their
video-clock stamps are ≤ `COMBO_WINDOW_MS` (3000) apart. The analyzer's own
`COOLDOWN_MS`/`REARM_MS` stay on frame timestamps (physical motion).

Replay: `npm run test:run-clock`.

## 4. Beatmaps (`beatmaps.ts`, `beatmapRegistry.ts`)

Charts are **derived from real players' moves** on the server and mirrored to
the client from Firestore (`beatmaps/{levelId}`, AsyncStorage cache, 6 h TTL,
refreshed on launch / sign-in / level open and adopted from the `startRun`
reply that pins a run's chart). See `docs/LEADERBOARDS.md` → "Consensus
charts" for the algorithm; bundled JSON below is dev-only. The chart format is
unchanged:

```json
{
  "version": 1,
  "levelId": "neon-rails",
  "videoDurationSec": 123.4,
  "orientation": "vertical",
  "cues": [{ "t": 12.4, "move": "jump" }]
}
```

`move ∈ jump | duck | left | right`; `t` is seconds into the vertical cut.
`parseBeatmap` validates without dependencies, sorts by `t`, drops exact
duplicates, and returns `null` on any malformed input (the level then falls
back to free scoring). `cuesForLoopedPlayback(beatmap, from, to, videoLength)`
yields cues across loop wraps at `t + k × videoLength` for the source
actually playing.

Bundled registration is static (Metro) and `__DEV__`-only: add
`require('../data/beatmaps/<levelId>.json')` to `BEATMAP_SOURCES` in
`beatmapRegistry.ts`. A remote chart always wins over a bundled one.
`example.dev.json` (level id `example-dev-level`, no real level) is the only
entry.

Move samples for the consensus chart are recorded in `workout.tsx` for every
detected move during natural playback: `t = runClock.videoPositionSec(now) −
DETECTION_LATENCY_COMPENSATION_MS / 1000` (wrapped into `[0, length)`), ≤ 600
per run, sent with `submitRun`.

Horizontal (AirPlay) source: if `player.duration` differs from
`videoDurationSec` by more than 0.5 s a warning is logged once and the
vertical timings are still used; loops wrap at the real length. Known
limitation until horizontal maps are authored.

### Authoring

Dev builds only: Profile → **Beatmap authoring (debug)** (`dev-beatmap.tsx`).

1. Pick the level chip. The vertical stream loads with the native scrubber.
   If the level already has a registered beatmap its cues prefill.
2. Play (0.5× toggle available) and press **JUMP / DUCK / LEFT / RIGHT** on
   the beat. The cue lands at `player.currentTime + author offset` (ms field,
   default 0 — use a negative offset if you consistently press late).
3. Tap a cue row to seek 1 s before it; **−50 / +50** nudges 50 ms; **×**
   deletes; **Undo** reverts the last change; trash clears all.
4. **Preview** flashes the move as the playhead passes each cue.
5. **Share** (top right) exports pretty JSON via the share sheet and
   `console.log`. Save it as `src/data/beatmaps/<levelId>.json` and add the
   `require` line for dev, or publish it with `scripts/publish-beatmap.ts`
   (locks the level against consensus rebuilds). `videoDurationSec` is taken
   from the player.
6. **Force rebuild charts** calls the admin `rebuildConsensusBeatmaps`
   callable and shows the per-level summary.

## 5. Timing-window scoring (`cueScoring.ts`)

Active only when the run has a chart (resolved before playback starts; see
`workout.tsx` → `chart`). `CueJudge` receives
classified moves with their video time and clock ticks; the analyzer's
debounce/cooldown/rearm are untouched.

Constants: `DETECTION_LATENCY_COMPENSATION_MS = 150`, `CUE_WINDOW_MS = 400`,
`PERFECT_MS = 120`, `GOOD_MS = 250`, `PERFECT_POINTS = 100`, `GOOD_POINTS = 50`,
`CUE_LOOKAHEAD_S = 3`.

`DETECTION_LATENCY_COMPENSATION_MS` is a placeholder derived from the audit's
latency floor. Set it from the `pose_latency` `total_p50_ms` once measured on
a device build (roughly p50 plus the analyzer's evidence delay).

Move at video time `v`:

1. `adjusted = v − 0.150`
2. candidates = unconsumed scheduled cues with `|cue.at − adjusted| ≤ 0.400`
3. prefer the nearest candidate whose move matches; otherwise the nearest
   candidate (wrong move) → **Miss**, cue consumed; no candidate → **Miss**,
   combo breaks, nothing consumed (`spurious`)
4. `|Δ| ≤ 120 ms` → **Perfect** (100), `≤ 250` → **Good** (50), else **Miss**
   (0); the cue is consumed either way

On each tick, any unconsumed cue with `at + 0.400 + 0.150 < videoTime`
expires → Miss, combo 0.

Points: `pts = base × (1 + min(70, (combo − 1) × 5) / 100)` where `combo` is
the value after this hit incremented it (×1.00 at combo 1 … ×1.70 from
combo 15). Combo increments on Perfect/Good only.

`accuracy = (perfect + 0.5 × good) / (perfect + good + miss)`, 0 with no
cues judged. `miss` counts beatmap cues missed (timing, wrong move, expiry);
spurious moves are tracked separately and do not enter accuracy.

HUD (`PoseOverlay.tsx`): PERFECT/GOOD/MISS flash on each judgement, upcoming
cue arrow + countdown, combo from the judge. Summary score =
`progressScoreFromPlayback + CueScore.score` (same composition as free
scoring).

Replay: `npm run test:cue-scoring`.

## 6. Rewards (`progression.ts`, `ProgressContext.recordRun`)

```
base            = rewardForRun(durationMin, classKey)          // duration × class multiplier
accuracyFactor  = 0.3 + 0.7 × accuracy                          // beatmap level
                = 0.3 + 0.7 × clamp(movesPerMin / 30, 0, 1)     // no beatmap (30/min ≈ one move every 2 s)
comboFactor     = 1 + min(0.25, maxCombo / 100)
xpBonusFactor   = 1.25 if the run completes today's daily challenge, else 1
coins           = round(base.coins × accuracyFactor × comboFactor)
xp              = round(base.xp × accuracyFactor × comboFactor × xpBonusFactor)
```

Standing still earns 30% of base. Calories are unchanged (duration × class
speed × intensity MET estimate). `RunRecord` stores `perfectCount`,
`goodCount`, `missCount`, `maxCombo`, `accuracy`, `rewardBreakdown{base,
accuracyFactor, comboFactor, xpBonusFactor}`; legacy records normalize to
factors of 1 with `base = stored coins/xp`. The summary screen shows the
breakdown card; `run_complete` carries accuracy, max_combo, perfect/good/miss,
has_beatmap, coins, xp.

Levels (1–50 curve, grandfather floor), level rewards, campaign gates (the
0.70 accuracy gate only applies to levels with a beatmap), streak freezes and
the daily challenge are documented in `docs/PROGRESSION.md`.

Replay: `npm run test:progression`, `npm run test:levels`, `npm run test:streaks`.

## 7. Validating on a device build

Stamps and live latency need a native build (≥ build 20 with the Swift
changes). Then:

1. Run a workout in a dev build; the HUD's `lat p50` should settle to a
   steady value and `stale` should stay near 0 on a healthy device.
2. Finish the run; confirm one `pose_latency` event in Singular (or the
   console in dev) with plausible ordering
   `inference ≫ mainHop ≈ bridge ≈ analyze`.
3. Set `DETECTION_LATENCY_COMPENSATION_MS` from `total_p50_ms`.
4. Author one beatmap on a level, register it, play it, and check the
   PERFECT/GOOD distribution centres near Δ ≈ 0 (`lastDeltaMs` in dev).
