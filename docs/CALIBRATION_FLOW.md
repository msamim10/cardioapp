# Calibration flow (preflight)

Calibration is a **three-second hold, then the four moves once each, upper
body only, once per session**. `src/app/preflight.tsx` runs a far-mode coach
on top of the unchanged `PoseAnalyzer` (`poseTracking.ts`: 20-stable-frame
baseline, cooldown/rearm, move classifiers, snapshot handoff via
`trackingSession.ts`). The screen owns no calibration math. Its state machine
is the pure reducer in `src/lib/preflightFlow.ts` (replay: `npm run
test:preflight-flow`); framing coaching comes from the read-only helper
`src/lib/skeletonFraming.ts`; the "clearly moving" signal of the move check
from the read-only `src/lib/bodyMotion.ts`; the once-per-session and warm-up
decisions are the pure helpers in `src/lib/calibrationSession.ts`;
spoken-prompt rate limiting is the pure `src/lib/speechGate.ts`.

No silhouette or body outline is drawn over the camera at any point: the one
big word + arrow (and, during the move check, the move word + arrow) are the
whole instruction.

Legs are optional throughout. The analyzer's baseline needs shoulders + hips
(`PoseAnalyzer` never required ankles: `ankleY` is nullable and body height
falls back to `torso × 3.2`); jump/duck classify on shoulder/hip/torso
vertical motion (ankles only corroborate a jump when visible) and left/right
on lateral shift of the body centre, so a desk setup with the legs out of
frame tracks like a full body. Move classification thresholds were not
touched.

## Screens and phases

| Phase (`preflightFlow`) | What the user sees | Leaves when |
| --- | --- | --- |
| `permission` (Screen 1) | "Your body is the controller." + animated skeleton (`CalibrationIntroFigure`), tip "Head to hips in frame is all it needs. Legs are optional.", **Turn on camera**. | Permission granted (CTA, or auto on repeat runs that already have it). |
| `framing` | Live camera and `FramingCoach`: ONE word ≥ 72 pt — **Step in / Closer / Step back / Center up** — with a big arrow (↑ closer, ↓ back, ↔ center). No outline. | Debounced framing verdict is `ok` (head + shoulders + hips inside the frame). |
| `hold` | Word becomes **Hold still**; a 3 s `HoldRing` fills around a countdown digit. | Ring full (`HOLD_MS`) **and** analyzer `tracking` → `moves`. No lock after `HOLD_LOCK_GRACE_MS` → `moves` anyway. Auto-advance, no tap. |
| `moves` | `MovePromptCoach`: **JUMP → DUCK → LEFT → RIGHT**, one at a time, the word at ≥ 96 pt with an oversized arrow (↑ ↓ ← →), four progress dots, each spoken through the voice gate. A prompt passes on the classified move (`detected`), on any other classified move or significant body motion (`motion`), or on its own when its `MOVE_WINDOW_MS` window ends (`auto`). Every pass flashes **JUMP ✓** in the accent with the success haptic/sound. It can never fail and is never retried. | Fourth move passed and its ✓ shown → `complete` with `'calibrated'` if the analyzer has a baseline, else `'defaults'`. |
| `complete` | First run: end card "You're set." with a burst for `END_CARD_MS`, then `first-run-ready`. Repeat: straight into `/workout`. | — |
| `unavailable` | "Camera tracking is off" card: Try again / Open Settings, **Continue without camera**. | Retry or continue. |

Happy path ≈ 2 s walking in + 3 s hold + 10–12 s of moves (four 2.5 s
windows; a ✓ tail of `MOVE_LANDED_MS` only when a pass lands late). The move
check is a guided warm-up of the controls, not a test: it does not gate
anything, and the in-run warm-up (below) is unchanged. A small **Skip** sits
at the bottom of every camera phase for accessibility: `outcome:
'calibrated'` if the analyzer already has its baseline, else `'defaults'`.

Feedback: a tick haptic + sound when framing locks (`hold` entered), the
success cue on every move ✓, the success cue + `ParticleBurst` when the flow
completes with a baseline, the same guarded `expo-haptics` / `expo-audio` path
as before (ambient category, so the silent switch is respected).

### Spoken prompts

`src/lib/voicePrompts.ts` wraps `expo-speech` (probed with
`requireOptionalNativeModule('ExpoSpeech')`; **requires a native build**).
`spokenPrompt(state)` picks the line — "Step into frame", "Step back", "Come
closer", "Center up", "Perfect, hold still", "Jump!", "Duck!", "Left!",
"Right!", "You're set" — and `speechGate` enforces `SPEECH_MIN_GAP_MS = 2500`
between utterances and never repeats the same line back to back.
`MOVE_WINDOW_MS` equals that gap and the next prompt never opens sooner than
one window after the previous one, so all four move prompts and the sign-off
are always spoken (asserted by the replay). The ringer switch is not detectable from JS, so a
speaker toggle on the screen (and "Spoken prompts" in Profile → Tracking)
persists `PlaySetup.voicePrompts` (default on).

## Thresholds

- `skeletonFraming` works on the **torso** (shoulder-centre → hip-centre
  distance as a fraction of frame height), not the full bounding box:
  - fewer than 3 of shoulders/hips visible → `searching`
  - torso `< FRAMING_MIN_TORSO (0.16)` → `closer`
  - torso `> FRAMING_MAX_TORSO (0.34)`, any core joint within
    `FRAMING_EDGE_MARGIN (0.03)` of a side/bottom edge, or the head above
    `FRAMING_HEAD_MARGIN (0.07)` (jump headroom) → `back`
  - hip centre outside `[FRAMING_CENTER_MIN_X 0.22, FRAMING_CENTER_MAX_X 0.78]`
    → `center`
  - otherwise `ok`. Ankles/knees are never consulted.
- `FRAMING_DEBOUNCE_MS = 400`: a verdict must persist this long before the
  big word changes (no flicker at 10 Hz).
- `HOLD_MS = 3000`: ring duration. A detected move, a non-`ok` verdict or a
  tracking loss restarts the ring (`holdRestarts`); a non-`ok` verdict drops
  back to `framing`.
- `HOLD_LOCK_GRACE_MS = 2500`: ring full but the analyzer has not locked
  (swaying, low light) → keep "Hold still" this much longer, then go on to the
  move check anyway so nobody is trapped on the screen (a lock that arrives
  during the moves still counts; otherwise the run starts on `'defaults'`).
- `bodyVisible(frame)` (used by the in-run gate): verdict ≠ `searching` and
  no clipped core joint.

### Move check

- `MOVE_ORDER = Jump, Duck, Left, Right`; `MOVE_WINDOW_MS = 2500` per prompt;
  `MOVE_LANDED_MS = 600` minimum ✓ time; `MOVES_MAX_MS = 4 × 3100 = 12 400`
  worst case (nobody moves at all), `4 × 2500 = 10 000` best case.
- Pass reasons (`movePasses`, in order): `detected` — the analyzer classified
  the prompted move; `motion` — it classified a different move, **or**
  `bodyMotion.ts` saw the body centre (shoulder/hip centre) travel
  `MOTION_MIN_TORSO_FRACTION = 0.25` torso lengths within
  `MOTION_WINDOW_MS = 500` (a half-hearted duck or shuffle that the cooled-down
  classifiers ignore still counts as trying); `auto` — the window ended.
- Framing verdicts and tracking loss are ignored during the move check: the
  ring is gone and nothing drops back to `framing`. The clock alone finishes
  the phase even if the body never comes back.

## Once per session

A successful hold stores `PlaySetup.calibrationBaseline`
(`{ capturedAt, cameraFacing, orientation, torsoRatio, shoulderRatio }`).
`hasFreshCalibration(baseline, now)` is true while
`now − capturedAt < CALIBRATION_SESSION_MS` (12 h).

- **Fresh baseline** → `preflight.tsx` renders nothing (no hold, no move
  check) and routes straight to `/workout` with `framingCheck=1` (the level brief, challenge deep links and
  the paywall return all still go through `/preflight`, so every entry point
  gets the skip). No handoff snapshot: the run's analyzer re-acquires the
  baseline from its first frames, as the `defaults` outcome always did.
- **`framingCheck` in `workout.tsx`**: while the map loads, frames are checked
  with `bodyVisible`; once the body has been seen for
  `FRAMING_GATE_VISIBLE_MS` (1 s) the gate opens and nothing is shown. If the
  gate is still closed `FRAMING_GATE_COACH_DELAY_MS` (1.5 s) after the map is
  ready, the same `FramingCoach` appears inline over the countdown until
  framed (auto-continue); after `FRAMING_GATE_SKIP_AFTER_MS` (8 s) a "Start
  anyway" button appears.
- **Full preflight again** when there is no baseline, the baseline is older
  than 12 h, the camera permission was revoked, or the user re-centers:
  Profile → Tracking → "Body tracking setup" clears the baseline; the run's
  **Re-center** button (top bar, `scan-outline`) pauses the video, resets the
  analyzer and shows the coach until the analyzer locks again, then resumes.
- Tracking off (`tracking: 'off'`) and the TV destination keep their existing
  handling.

## Warm-up (moved out of preflight)

The four move trials are now the first `WARMUP_SECONDS` (15 s) of the run for
the user's first `WARMUP_RUN_COUNT` (2) tracked runs
(`PlaySetup.warmupRunsCompleted`, bumped by `recordWarmupRun` when the run
finishes). `WarmupOverlay` shows the move in ≥ 96 pt with an arrow and flashes
"JUMP ✓" on a landed move.

- Charted run: `CueJudge` is constructed with
  `forgiveMissesUntilSec = WARMUP_SECONDS × playbackRate` (judge time is video
  time). Misses and spurious moves before that point are counted in
  `CueScore.forgiven` and excluded from the displayed score / accuracy /
  combo break, **but the event log is untouched**: `verifiedTotals()` replays
  the log without forgiveness and that is what `stageRunSubmission` sends, so
  the server-side replay (`shared/scoring/submission.ts`) still matches.
- Free-scoring run (no chart yet): the overlay cycles JUMP → DUCK → LEFT →
  RIGHT once each, advancing on the matching recognized move; scoring is the
  normal `applyRecognizedMove` path.

## Fallbacks (always explicit, never silent)

| Situation | UI | Outcome |
| --- | --- | --- |
| Permission denied (Screen 1) | "Camera access is off — open Settings" + "Continue without camera" | `off`: run launches with `tracking: 'off'` (first run: `saveFirstRunTrackingOff(true)`). |
| Detector unavailable (simulator, Android, old build, camera error) | `unavailable` card | `off` as above. |
| Ring full, analyzer never locks (`HOLD_LOCK_GRACE_MS`) | "Hold still" stays up, then the move check runs (prompts auto-pass) | `defaults`: no snapshot is staged, run launches with `tracking: 'calibrated'` and calibrates live. |
| Move not performed / body out of frame during the move check | Prompt stays up until its window ends, then ✓ | Never a fail or retry; the next prompt (or completion) follows. |
| Skip tapped (any camera phase, including the move check) | — | `calibrated` if the baseline exists, else `defaults`. |
| Snapshot staging fails after the hold | `unavailable` card | Retry or continue without camera. |
| In-run gate never sees the body | Coach inline, "Start anyway" after 8 s | Run starts; analyzer calibrates live. |

## Analytics

Unchanged semantics through the facade (`analytics.ts`, every call wrapped in
`safely()`):

- `logCalibrationAttempt()` once per cycle on entering `framing`.
- `logCalibrationSuccess()` when the hold completes with a baseline — where
  `onboarding_complete` fires on the first ever success and the SKAN ladder
  bumps to `calibration_complete`. `recordCalibrationComplete` stores body
  proportions and `saveCalibrationBaseline` stamps the session marker at the
  same moment.
- `logCalibrationFailure(reason)` on `unavailable` or on the `defaults`
  outcome, with the reason derived from the last frame.
- `calibration_move_skipped` is not emitted: the move check has no skip per
  move and no fail state (`movePasses` is available on the flow state for the
  dev timer only).
