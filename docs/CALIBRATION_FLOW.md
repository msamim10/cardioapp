# Calibration flow (preflight)

Calibration is a **three-second hold, then a teaser of the run — four short
clips of real gameplay the user copies — upper body only, once per session**.
`src/app/preflight.tsx` runs a far-mode coach on top of the unchanged
`PoseAnalyzer` (`poseTracking.ts`: 20-stable-frame baseline, cooldown/rearm,
move classifiers, snapshot handoff via `trackingSession.ts`). The screen owns
no calibration math. Its state machine is the pure reducer in
`src/lib/preflightFlow.ts` (replay: `npm run test:preflight-flow`); framing
coaching comes from the read-only helper `src/lib/skeletonFraming.ts`; the
once-per-session decision is the pure helper in
`src/lib/calibrationSession.ts`; spoken-prompt rate limiting is the pure
`src/lib/speechGate.ts`; the teaser's clip boundaries are the data file
`src/data/calibrationTeaser.ts`.

No silhouette or body outline is drawn over the camera at any point: the one
big word + arrow are the whole instruction during framing, and during the
teaser **nothing is written over the footage** — the footage is the cue.

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
| `framing` | Live camera full-screen and `FramingCoach`: ONE word ≥ 72 pt — **Step in / Closer / Step back / Center up** — with a big arrow (↑ closer, ↓ back, ↔ center). No outline. | Debounced framing verdict is `ok` (head + shoulders + hips inside the frame). |
| `hold` | Word becomes **Hold still**; a 3 s `HoldRing` fills around a countdown digit. | Ring full (`HOLD_MS`) **and** analyzer `tracking` → `teaser`. No lock after `HOLD_LOCK_GRACE_MS` → `teaser` anyway. Auto-advance, no tap. |
| `teaser` | The run, already started (`CalibrationTeaser`): the camera shrinks into the run's PiP (bottom-right, `RunPipFrame`, 1.5× the run size, thin ring — amber while shoulders/hips are not in view, green when they are) and four clips of real Neon Rails footage play full-screen from the bundled MP4, one per move: **jump, duck, left, right**. The on-screen runner dodges; the user copies it. A classified move inside a clip's window lands it: the run's own **✓ PERFECT** pop (`JudgementPop`, shared with the in-run HUD) for the clip's move, **✓ GOOD** for any other move, plus a coin burst, the success haptic and a green flash on the PiP. Then a 1 s **Next up** (last clip: **That's it**) over the frozen frame. Nothing landed → the same interstitial, no MISS, no retry. After the fourth clip a 1.5 s score card: **3/4** · "You're in." | Score card over → `complete` with `'calibrated'` if the analyzer has a baseline, else `'defaults'`. |
| `complete` | — (the score card was the teaser's last step). | Routes at once: first run → `first-run-ready` (then the paywall); repeat → `/workout`. |
| `unavailable` | "Camera tracking is off" card: Try again / Open Settings, **Continue without camera**. | Retry or continue. |

Happy path ≈ 2 s walking in + 3 s hold + 13–17 s of teaser (8.8 s of
footage, four 1 s interstitials, a 1 s tail only on clips that did not land)
+ 1.5 s score card ≈ 20–24 s. The teaser is a taste of the run, not a test:
it does not gate anything. Once the run starts there are no further prompts:
the HUD's upcoming-cue arrow is the only in-run guidance. A small **Skip**
sits at the bottom of every camera phase for accessibility (bottom-left
during the teaser, where the PiP owns the right corner): `outcome:
'calibrated'` if the analyzer already has its baseline, else `'defaults'`.

Feedback: a tick haptic + sound when framing locks (`hold` entered), the
success cue + PiP flash on every landed clip, the celebration cue +
`ParticleBurst` on the score card, the same guarded `expo-haptics` /
`expo-audio` path as before (ambient category, so the silent switch is
respected).

### Spoken prompts

`src/lib/voicePrompts.ts` wraps `expo-speech` (probed with
`requireOptionalNativeModule('ExpoSpeech')`; **requires a native build**).
`spokenPrompt(state)` picks the line — "Step into frame", "Step back", "Come
closer", "Center up", "Perfect, hold still", "You're set" — and `speechGate`
enforces `SPEECH_MIN_GAP_MS = 2500` between utterances and never repeats the
same line back to back. **The teaser is silent**: the only line it can add
is "Step in", once the body has been missing for `TEASER_STEP_IN_MS` (2 s);
it is sent as urgent so it can recur after the body comes back and leaves
again. The ringer switch is not detectable from JS, so a speaker toggle on
the screen (and "Spoken prompts" in Profile → Tracking) persists
`PlaySetup.voicePrompts` (default on).

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
  teaser anyway so nobody is trapped on the screen (a lock that arrives
  during the teaser still counts; otherwise the run starts on `'defaults'`).
- `bodyVisible(frame)` (used by the in-run gate): verdict ≠ `searching` and
  no clipped core joint.

### Teaser

The footage is ONE bundled, silent, fast-start H.264 MP4
(`assets/video/calibration-neon-rails.mp4`, 720×1280, 30 fps CFR, 265
frames = 8.83 s, ≈ 2.6 MB) cut from the exact 1080p vertical HLS rendition
the run streams (`hls-v2/level13/vertical/1080`), no crop and no letterbox,
so it looks like the run (`contentFit="cover"`, like `workout.tsx`). A copy
is served from `calibration/neon-rails/teaser.mp4` in the media bucket (see
`docs/VIDEO_HOSTING.md`) but the app never streams it: onboarding must not
wait on the network. `src/data/calibrationTeaser.ts` hard-codes the
boundaries (ms into the file) and the moment the runner reacts:

| clip | source (1080p vertical, s) | `startMs`–`endMs` | `reactMs` | obstacle |
| --- | --- | --- | --- | --- |
| Jump | 14.900–16.967 | 0–2067 | 1400 | red/white track barrier dead ahead, trains on both sides — nothing to dodge sideways |
| Duck | 18.800–20.700 | 2067–3967 | 2967 | head-height bar between two traffic-light posts, the camera passes under it |
| Left | 9.400–11.867 | 3967–6433 | 5767 | train coming straight at the camera, slides to the left track |
| Right | 6.600–9.000 | 6433–8833 | 8133 | train coming straight at the camera, slides to the right track |

Reducer (`teaser` phase, sub-state `teaserStep`):

- `playing` — the player is seeked to `startMs` and played; `VIDEO_TIME`
  events (expo-video `timeUpdate`, `timeUpdateEventInterval = 0.1 s`, plus
  `playToEnd`) end the clip when the position reaches `endMs −
  TEASER_END_TOLERANCE_MS (120)`. Positions before the clip's `startMs` are
  ignored as stale seek chatter. **Wall-clock guard:** the step also ends
  `TEASER_PLAY_GRACE_MS (1000)` after the clip's own length on the `TICK`
  clock alone, so a stalled, silent or broken player costs at most one
  second per clip and can never hang the flow. A player `statusChange` to
  `error` sends `VIDEO_FAILED` → `complete` straight away with the camera
  outcome.
- `tail` — the clip ended with nothing landed: frozen frame,
  `TEASER_TAIL_MS (1000)` more of detection. Skipped when the move already
  landed during the clip; a move during the tail lands it and ends the tail
  at once.
- `interstitial` — `TEASER_INTERSTITIAL_MS (1000)` of "Next up" / "That's
  it" over the frozen frame (the screen pauses and parks the player on the
  clip's last frame). Moves here count for nothing. Then the next clip, or
  the score card.
- `done` — the score card for `SCORE_CARD_MS (1500)` → `complete`.
- Detection: `FRAME.move` (the analyzer's classified move, the same events
  the run scores) during `playing` or `tail` lands the current clip once:
  `teaserHits[i] = 'perfect'` for the clip's move, `'good'` for any other
  move (lenient — this is pre-paywall). Nothing else (raw body motion,
  framing) counts.
- Framing verdicts are not applied during the teaser; only `bodyVisible`
  (shoulders + hips seen and the analyzer not `searching`/`reconnecting`)
  is tracked for the PiP ring, and `teaserStepIn` flips after
  `TEASER_STEP_IN_MS` without a body. Neither blocks any step.
- Budget: `TEASER_MIN_MS` (every move landed during its clip) = 14 333 ms;
  `TEASER_MAX_MS` (nobody moves, player stalled on every clip) = 22 333 ms.
- Skip mid-teaser → `complete` at once (no score card), `skipped: true`.

Screen (`preflight.tsx` + `CalibrationTeaser.tsx`): the player is created
with the screen (`useTeaserPlayer`: bundled source, `loop = false`, muted)
so the asset is loaded long before the hold ends; `useTeaserPlayback`
mirrors `(teaserClip, teaserStep)` into seek/play/pause and forwards the
player's clock. The camera is one `WorkoutCameraPreview` instance inside a
`RunPipFrame` whose `expanded` prop flips from full-screen to the PiP —
same view tree, so the native camera session is never remounted mid-flow.

## Once per session

A successful hold stores `PlaySetup.calibrationBaseline`
(`{ capturedAt, cameraFacing, orientation, torsoRatio, shoulderRatio }`).
`hasFreshCalibration(baseline, now)` is true while
`now − capturedAt < CALIBRATION_SESSION_MS` (12 h).

- **Fresh baseline** → `preflight.tsx` renders nothing (no hold, no teaser)
  and routes straight to `/workout` with `framingCheck=1` (the level brief,
  challenge deep links and the paywall return all still go through
  `/preflight`, so every entry point gets the skip). No handoff snapshot:
  the run's analyzer re-acquires the baseline from its first frames, as the
  `defaults` outcome always did.
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

## Fallbacks (always explicit, never silent)

| Situation | UI | Outcome |
| --- | --- | --- |
| Permission denied (Screen 1) | "Camera access is off — open Settings" + "Continue without camera" | `off`: run launches with `tracking: 'off'` (first run: `saveFirstRunTrackingOff(true)`). |
| Detector unavailable (simulator, Android, old build, camera error) | `unavailable` card | `off` as above. |
| Ring full, analyzer never locks (`HOLD_LOCK_GRACE_MS`) | "Hold still" stays up, then the teaser runs | `defaults`: no snapshot is staged, run launches with `tracking: 'calibrated'` and calibrates live. |
| Move not performed / body out of frame during a clip | Clip plays out, 1 s tail, "Next up"; ring amber, "Step in" after 2 s | Never a fail or retry; the next clip (or the score card) follows. |
| Teaser player stalls or never plays | Each clip ends on the wall clock (`TEASER_PLAY_GRACE_MS` after its length); interstitials and the card run on the clock anyway | Flow finishes within `TEASER_MAX_MS`; outcome from the analyzer as usual. |
| Teaser player errors | — | `VIDEO_FAILED` → `complete` at once with the camera outcome. |
| Skip tapped (any camera phase, including the teaser) | — | `calibrated` if the baseline exists, else `defaults`. |
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
- `logCalibrationTeaserCompleted({ landed, skipped, durationMs })` →
  `calibration_teaser_completed` once per teaser when the flow completes
  (score card or Skip): clips landed out of four, whether Skip was tapped,
  and the time from the first clip to completion.
- `calibration_move_skipped` is not emitted: the teaser has no skip per
  clip and no fail state.
