# Calibration flow (preflight)

`src/app/preflight.tsx` presents calibration as a short micro-game on top of
the unchanged `PoseAnalyzer` (`poseTracking.ts`: 20-stable-frame baseline,
cooldown/rearm, move classifiers, snapshot handoff via `trackingSession.ts`).
The screen owns no calibration math. Its state machine is the pure reducer in
`src/lib/preflightFlow.ts` (replay: `npm run test:preflight-flow`); framing
coaching comes from the read-only helper `src/lib/skeletonFraming.ts`.

## Screens and phases

| Phase (`preflightFlow`) | What the user sees | Leaves when |
| --- | --- | --- |
| `permission` (Screen 1) | "Your body is the controller." + animated skeleton figure (`CalibrationIntroFigure`), tip line, **Turn on camera**. No skip. | Permission granted (CTA, or auto on repeat runs that already have it). |
| `framing` (Phase 1) | Live camera, `BodyOutline` silhouette (~70 % frame height), coaching line: **Move closer** / **Move back** / **Perfect, hold still.** (outline turns lime). | Analyzer reports `tracking` (baseline locked) **and** the debounced framing verdict is `ok`. |
| `moves` (Phase 2, first run only) | **JUMP! → DUCK! → DODGE LEFT! → DODGE RIGHT!**, one at a time, with progress dots and "Having trouble? Skip this move". | Each move: one `result.move` from `PoseAnalyzer.process` matching the prompt, or a skip. All four done → handoff. |
| `handoff` (Phase 3) | Rotating lines ("Syncing your avatar…", …), then **LOCKED** + countdown. | `PREFLIGHT_STABLE_FRAMES` (6) consecutive neutral frames start the countdown (3 s guided / 2 s express); reaching 0 completes with `outcome: 'calibrated'`. |
| `complete` | First run: end card "Your body is the controller." with a 1.2 s burst, then `first-run-ready`. Repeat: straight into `/workout` with the same params as before. | — |
| `unavailable` | "Camera tracking is off" card: Try again / Open Settings, **Continue with default settings**. | Retry or continue. |

Repeat runs run Phase 1 + Phase 3 only. Screen 1 is skipped when camera
permission is already granted (the compact variant shows otherwise). Express
(2 s countdown) applies when `shouldGuideCalibration(profile)` is false; a
body whose proportions mismatch the stored profile re-enables the 3 s hold,
exactly as before.

Every phase transition and every detected move fires feedback:
`ParticleBurst` (~20 dots in the active HUD theme colours), a haptic
(`expo-haptics`, probed with `requireOptionalNativeModule('ExpoHaptics')`)
and a short sound (`expo-audio`, ambient category so the silent switch is
respected; WAVs in `assets/sfx/` are synthesized with ffmpeg). All three are
guarded and no-op when the native module is missing or reduce-motion is on.

## Thresholds

- `skeletonFraming` (`FRAMING_MIN_HEIGHT = 0.6`, `FRAMING_MAX_HEIGHT = 0.8`,
  `FRAMING_EDGE_MARGIN = 0.03`): skeleton bounding-box height as a fraction of
  the camera frame. `< 0.6` → `closer`; `> 0.8` or any key joint (head,
  shoulders, hips, ankles when the body reaches the bottom edge) missing or
  within 3 % of an edge → `back`; otherwise `ok`. Fewer than three of
  shoulders/hips visible → `searching`.
- `FRAMING_DEBOUNCE_MS = 400`: a new verdict must persist this long before the
  coaching line changes (no flicker at 10 Hz).
- `FRAMING_FALLBACK_MS = 10_000`: Phase 1 shows "Having trouble?" after 10 s.
- Phase 3 reuses `PREFLIGHT_STABLE_FRAMES`, `PREFLIGHT_COUNTDOWN_SECONDS` and
  `PREFLIGHT_EXPRESS_COUNTDOWN_SECONDS` from `preflightState.ts`.
- Happy path ≈ 5 s + 4 × ~3 s + 2–3 s ≤ 30 s (asserted in the replay). A
  `__DEV__`-only timer under the header shows flow and phase elapsed time.

## Fallbacks (always explicit, never silent)

| Situation | UI | Outcome |
| --- | --- | --- |
| Permission denied (Screen 1) | "Camera access is off — open Settings" + "Continue with default settings" | `off`: run launches with `tracking: 'off'` (first run: `saveFirstRunTrackingOff(true)`). |
| Detector unavailable (simulator, Android, old build, camera error) | `unavailable` card | `off` as above. |
| 10 s in Phase 1, analyzer not calibrated | "Having trouble? Continue with default settings" | `defaults`: no snapshot is staged (`clearTrackingHandoff()`), run launches with `tracking: 'calibrated'` and `workout.tsx` calibrates live from its first frames. |
| 10 s in Phase 1, analyzer calibrated but framing never `ok` | "Having trouble? Good enough, continue" | Advances normally (moves / handoff). |
| Move not detected (Phase 2) | "Skip this move" | Advances; `calibration_move_skipped` logged. |
| Analyzer loses its baseline in Phase 2/3 (> `POSE_LOSS_GRACE_MS`) | Back to Phase 1 | Earned moves are kept; first run returns to handoff without repeating the test drive. |
| Snapshot staging fails after the countdown | `unavailable` card | Retry or continue on defaults. |

The old 25 s "No signal" timeout is replaced by the 10 s offer, and the
handoff expiry (`POSE_LOSS_GRACE_MS`, unchanged) is not surfaced here: a stale
snapshot on arrival is handled by the run, as before.

## Analytics

Unchanged semantics through the facade (`analytics.ts`, every call wrapped in
`safely()`):

- `logCalibrationAttempt()` once per cycle on entering Phase 1.
- `logCalibrationSuccess()` when the Phase 3 countdown starts — this is where
  `onboarding_complete` fires on the first ever success and the SKAN ladder
  bumps to `calibration_complete`. `recordCalibrationComplete` stores body
  proportions at the same moment.
- `logCalibrationFailure(reason)` on `unavailable` or on the `defaults`
  fallback, with the reason derived from the last frame.
- New: `logCalibrationMoveSkipped(move)` → Singular `calibration_move_skipped`
  `{ move: jump | duck | left | right }`.
