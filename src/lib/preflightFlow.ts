/**
 * Calibration state machine (preflight screen): a 3-second hold, then a
 * teaser of the run — four short clips of real gameplay, one per move, that
 * the user copies.
 *
 * Pure reducer so `scripts/replay-preflight-flow.ts` can drive it with
 * synthetic frames, clock ticks and player positions. It sits ON TOP of
 * `PoseAnalyzer`: the analyzer keeps its own 20-stable-frame calibration,
 * cooldown/rearm and move classifiers, and this reducer only consumes the
 * analyzer's per-frame result (status, move) plus the read-only upper-body
 * framing verdict from `skeletonFraming`.
 *
 * Phases
 *   permission  Screen 1 — "Your body is the controller." + Turn on camera.
 *   framing     "Step into frame": one big word (Step in / Closer / Step back /
 *               Center up) until head + shoulders + hips sit inside the frame.
 *               Legs are optional.
 *   hold        Framing is ok: a HOLD_MS ring fills while the user stands
 *               still. Moving, drifting out of frame or losing the body
 *               restarts the ring. When the ring is full (and the analyzer
 *               has its baseline, or the lock grace ran out) → `teaser`.
 *   teaser      The run, already started: `TEASER_CLIPS` (Jump · Duck · Left ·
 *               Right) play one after another from the bundled MP4 while the
 *               camera sits in the run's PiP. Per clip the steps are
 *                 playing       the clip runs from startMs to endMs
 *                 tail          clip over, frozen frame, TEASER_TAIL_MS more of
 *                               detection (skipped when the move already landed)
 *                 interstitial  "Next up" / "That's it" over the frozen frame
 *               and after the last clip
 *                 done          the score card ("3/4 · You're in.") for
 *                               SCORE_CARD_MS → `complete`.
 *               A classified move inside a clip's window lands it: the clip's
 *               own move is a `perfect`, any other move a `good`. Nothing
 *               lands → the clip just moves on (no miss, no retry). The clock
 *               alone finishes every step: `VIDEO_TIME` ends a clip when the
 *               player reaches endMs, and a wall-clock guard
 *               (`TEASER_PLAY_GRACE_MS` past the clip's own length) ends it
 *               when the player stalls, so a broken video can never hang the
 *               flow. Framing and tracking loss never block anything here;
 *               they only drive the PiP ring and the "Step in" prompt.
 *   complete    Route out. `outcome` says how the run should start.
 *   unavailable No detector / camera error; explicit "continue without" only.
 *
 * Happy path ≈ 2 s walking in + 3 s hold + ~13–17 s of teaser + 1.5 s score
 * card. The run itself has no further prompts (workout.tsx).
 */

import { CALIBRATION_TEASER, type TeaserClip } from '@/data/calibrationTeaser';
import type { Move, TrackingStatus } from '@/lib/poseTracking';
import type { FramingVerdict } from '@/lib/skeletonFraming';

export type PreflightFlowPhase = 'permission' | 'framing' | 'hold' | 'teaser' | 'complete' | 'unavailable';

/**
 * How the run starts once the flow completes.
 *   calibrated  snapshot handoff (the happy path)
 *   defaults    camera works but no lock: no snapshot, the run calibrates live
 *   off         camera denied / detector unavailable: tracking off for the run
 */
export type PreflightOutcome = 'calibrated' | 'defaults' | 'off';

/** The ring: how long the user holds still once framed. */
export const HOLD_MS = 3_000;
/**
 * The ring is full but the analyzer has not locked yet (someone swaying, low
 * light). Keep "Hold still" up this much longer, then start on defaults so
 * the run calibrates live rather than trapping anyone on this screen.
 */
export const HOLD_LOCK_GRACE_MS = 2_500;
/** A framing verdict must hold this long before the big word changes. */
export const FRAMING_DEBOUNCE_MS = 400;

/** The four moves, once each, in this order (also the clip order). */
export const MOVE_ORDER: readonly Move[] = ['Jump', 'Duck', 'Left', 'Right'];

/** The teaser clips, in playback order. */
export const TEASER_CLIPS: readonly TeaserClip[] = CALIBRATION_TEASER.clips;
/** Extra detection time after a clip ends (frozen frame) when nothing landed yet. */
export const TEASER_TAIL_MS = 1_000;
/** "Next up" / "That's it" over the frozen frame. */
export const TEASER_INTERSTITIAL_MS = 1_000;
/**
 * Wall-clock slack past a clip's own length before the flow moves on without
 * the player: a stalled or broken video costs at most this per clip.
 */
export const TEASER_PLAY_GRACE_MS = 1_000;
/**
 * A player position this close to endMs counts as the end of the clip
 * (timeUpdate ticks every ~100 ms, so waiting for the exact frame would show
 * the first frames of the next clip before the pause).
 */
export const TEASER_END_TOLERANCE_MS = 120;
/** Body not seen for this long during the teaser → "Step in". */
export const TEASER_STEP_IN_MS = 2_000;
/** Score card ("3/4 · You're in.") before routing on. */
export const SCORE_CARD_MS = 1_500;
/** Everything the teaser can add, nobody moving and the player stalled throughout. */
export const TEASER_MAX_MS =
  TEASER_CLIPS.reduce(
    (total, clip) =>
      total + (clip.endMs - clip.startMs) + TEASER_PLAY_GRACE_MS + TEASER_TAIL_MS + TEASER_INTERSTITIAL_MS,
    0,
  ) + SCORE_CARD_MS;
/** Everything the teaser takes when every move lands during its clip. */
export const TEASER_MIN_MS =
  TEASER_CLIPS.reduce((total, clip) => total + (clip.endMs - clip.startMs) + TEASER_INTERSTITIAL_MS, 0) +
  SCORE_CARD_MS;

export type TeaserStep = 'playing' | 'tail' | 'interstitial' | 'done';
/** How a clip landed: its own move, or any other classified move (lenient). */
export type TeaserHit = 'perfect' | 'good';

export type PreflightFlowState = {
  phase: PreflightFlowPhase;
  firstRun: boolean;
  /** When the camera went live (dev timer origin). */
  startedAt: number;
  phaseStartedAt: number;
  /** Debounced, displayed framing verdict. */
  framing: FramingVerdict;
  framingCandidate: FramingVerdict | null;
  framingCandidateSince: number;
  /** Analyzer has a baseline (status `tracking`). */
  calibrated: boolean;
  /** Body currently not seen by the analyzer (searching / reconnecting). */
  trackingLost: boolean;
  /** Hold ring origin; null outside `hold`. */
  holdStartedAt: number | null;
  /** How many times the ring restarted in this cycle (feedback / analytics). */
  holdRestarts: number;
  /** When the teaser began; null before it. */
  teaserStartedAt: number | null;
  /** Index into TEASER_CLIPS while in `teaser` (TEASER_CLIPS.length on the score card). */
  teaserClip: number;
  teaserStep: TeaserStep | null;
  /** When the current step began; null outside `teaser`. */
  teaserStepStartedAt: number | null;
  /** How each clip landed, by clip index (null = nothing detected). */
  teaserHits: (TeaserHit | null)[];
  /** When the current clip landed; null while its window is open. */
  teaserHitAt: number | null;
  /** Last accepted player position (ms into the bundled file); null before playback. */
  teaserVideoMs: number | null;
  /** Shoulders + hips currently visible (PiP ring). Only tracked during the teaser. */
  bodyVisible: boolean;
  /** When the body went missing during the teaser; null while visible. */
  bodyLostSince: number | null;
  /** Body missing for TEASER_STEP_IN_MS: the one spoken prompt of the teaser. */
  teaserStepIn: boolean;
  /** The user tapped Skip to get to `complete`. */
  skipped: boolean;
  outcome: PreflightOutcome | null;
};

export type PreflightFlowEvent =
  | { type: 'PERMISSION_GRANTED'; now: number }
  | {
      type: 'FRAME';
      now: number;
      framing: FramingVerdict;
      status: TrackingStatus;
      move: Move | null;
    }
  /** Native detector reports no body (no frames arrive while this holds). */
  | { type: 'TRACKING_LOST'; now: number }
  | { type: 'TICK'; now: number }
  /** Teaser player position (`timeUpdate`), ms into the bundled file. */
  | { type: 'VIDEO_TIME'; now: number; positionMs: number }
  /** Teaser player failed to load or play: finish without it. */
  | { type: 'VIDEO_FAILED'; now: number }
  /**
   * The small Skip at the bottom. With a calibrated analyzer the snapshot is
   * still handed off; otherwise the run starts on defaults.
   */
  | { type: 'SKIP'; now: number }
  /** Denied / unavailable: run without tracking. */
  | { type: 'CONTINUE_WITHOUT_CAMERA'; now: number }
  | { type: 'UNAVAILABLE'; now: number }
  | { type: 'RETRY'; now: number };

export function createPreflightFlowState(options: {
  firstRun: boolean;
  now?: number;
}): PreflightFlowState {
  const now = options.now ?? 0;
  return {
    phase: 'permission',
    firstRun: options.firstRun,
    startedAt: now,
    phaseStartedAt: now,
    framing: 'searching',
    framingCandidate: null,
    framingCandidateSince: now,
    calibrated: false,
    trackingLost: false,
    holdStartedAt: null,
    holdRestarts: 0,
    teaserStartedAt: null,
    teaserClip: 0,
    teaserStep: null,
    teaserStepStartedAt: null,
    teaserHits: [],
    teaserHitAt: null,
    teaserVideoMs: null,
    bodyVisible: false,
    bodyLostSince: null,
    teaserStepIn: false,
    skipped: false,
    outcome: null,
  };
}

export const ACTIVE_PHASES: readonly PreflightFlowPhase[] = ['framing', 'hold', 'teaser'];

/** The camera should be live and frames should reach the analyzer. */
export function isCameraPhase(phase: PreflightFlowPhase): boolean {
  return ACTIVE_PHASES.includes(phase);
}

/** Ring fill 0..1 (1 while waiting on the analyzer lock; 0 outside `hold`). */
export function holdProgress(state: PreflightFlowState, now: number): number {
  if (state.phase !== 'hold' || state.holdStartedAt === null) return 0;
  return Math.max(0, Math.min(1, (now - state.holdStartedAt) / HOLD_MS));
}

/** The clip currently playing / frozen, or null outside the clips (score card included). */
export function currentTeaserClip(state: PreflightFlowState): TeaserClip | null {
  if (state.phase !== 'teaser') return null;
  return TEASER_CLIPS[state.teaserClip] ?? null;
}

/** How the current clip landed, or null while its window is open / nothing landed. */
export function teaserHit(state: PreflightFlowState): TeaserHit | null {
  if (state.phase !== 'teaser') return null;
  return state.teaserHits[state.teaserClip] ?? null;
}

/** Clips landed so far (the score card's numerator). */
export function teaserLandedCount(state: PreflightFlowState): number {
  return state.teaserHits.filter((hit) => hit !== null).length;
}

/** The current clip is the last one (interstitial says "That's it"). */
export function teaserOnLastClip(state: PreflightFlowState): boolean {
  return state.phase === 'teaser' && state.teaserClip === TEASER_CLIPS.length - 1;
}

/**
 * Wall-clock moment the current teaser step ends on its own (null outside
 * the teaser). `playing` ends earlier when the player reports endMs.
 */
export function teaserStepDeadline(state: PreflightFlowState): number | null {
  if (state.phase !== 'teaser' || state.teaserStep === null || state.teaserStepStartedAt === null) return null;
  const started = state.teaserStepStartedAt;
  switch (state.teaserStep) {
    case 'playing': {
      const clip = TEASER_CLIPS[state.teaserClip];
      return clip ? started + (clip.endMs - clip.startMs) + TEASER_PLAY_GRACE_MS : started;
    }
    case 'tail':
      return started + TEASER_TAIL_MS;
    case 'interstitial':
      return started + TEASER_INTERSTITIAL_MS;
    case 'done':
      return started + SCORE_CARD_MS;
  }
}

function enterFraming(state: PreflightFlowState, now: number): PreflightFlowState {
  return {
    ...state,
    phase: 'framing',
    phaseStartedAt: now,
    framing: 'searching',
    framingCandidate: null,
    framingCandidateSince: now,
    calibrated: false,
    trackingLost: false,
    holdStartedAt: null,
    holdRestarts: 0,
    teaserStartedAt: null,
    teaserClip: 0,
    teaserStep: null,
    teaserStepStartedAt: null,
    teaserHits: [],
    teaserHitAt: null,
    teaserVideoMs: null,
    bodyVisible: false,
    bodyLostSince: null,
    teaserStepIn: false,
  };
}

function enterHold(state: PreflightFlowState, now: number): PreflightFlowState {
  return { ...state, phase: 'hold', phaseStartedAt: now, holdStartedAt: now, trackingLost: false };
}

function enterTeaser(state: PreflightFlowState, now: number): PreflightFlowState {
  const next: PreflightFlowState = {
    ...state,
    phase: 'teaser',
    phaseStartedAt: now,
    holdStartedAt: null,
    teaserStartedAt: now,
    teaserClip: 0,
    teaserStep: null,
    teaserStepStartedAt: null,
    teaserHits: TEASER_CLIPS.map(() => null),
    teaserHitAt: null,
    teaserVideoMs: null,
    // The hold just locked with the body framed: the ring starts green.
    bodyVisible: !state.trackingLost,
    bodyLostSince: null,
    teaserStepIn: false,
  };
  return TEASER_CLIPS.length === 0 ? enterScoreCard(next, now) : startClip(next, 0, now);
}

function startClip(state: PreflightFlowState, index: number, now: number): PreflightFlowState {
  return {
    ...state,
    teaserClip: index,
    teaserStep: 'playing',
    teaserStepStartedAt: now,
    teaserHitAt: null,
    teaserVideoMs: null,
  };
}

function enterStep(state: PreflightFlowState, step: TeaserStep, now: number): PreflightFlowState {
  return { ...state, teaserStep: step, teaserStepStartedAt: now };
}

function enterScoreCard(state: PreflightFlowState, now: number): PreflightFlowState {
  return {
    ...state,
    teaserClip: TEASER_CLIPS.length,
    teaserStep: 'done',
    teaserStepStartedAt: now,
    teaserHitAt: null,
  };
}

function complete(
  state: PreflightFlowState,
  now: number,
  outcome: PreflightOutcome,
  skipped = false,
): PreflightFlowState {
  return {
    ...state,
    phase: 'complete',
    phaseStartedAt: now,
    outcome,
    skipped,
    holdStartedAt: null,
    teaserStep: null,
    teaserStepStartedAt: null,
    teaserHitAt: null,
    teaserStepIn: false,
  };
}

/** How the run starts given what the analyzer managed: a baseline or not. */
function cameraOutcome(state: PreflightFlowState): PreflightOutcome {
  return state.calibrated ? 'calibrated' : 'defaults';
}

/** Land the current clip (idempotent). Only while its window is open. */
function landClip(state: PreflightFlowState, now: number, move: Move): PreflightFlowState {
  if (state.phase !== 'teaser') return state;
  if (state.teaserStep !== 'playing' && state.teaserStep !== 'tail') return state;
  const clip = TEASER_CLIPS[state.teaserClip];
  if (!clip || state.teaserHits[state.teaserClip]) return state;
  const teaserHits = state.teaserHits.slice();
  teaserHits[state.teaserClip] = move === clip.move ? 'perfect' : 'good';
  return { ...state, teaserHits, teaserHitAt: now };
}

/** Body seen / not seen during the teaser: PiP ring + the "Step in" prompt. */
function applyBodyVisible(state: PreflightFlowState, visible: boolean, now: number): PreflightFlowState {
  if (visible) {
    return state.bodyVisible && state.bodyLostSince === null && !state.teaserStepIn
      ? state
      : { ...state, bodyVisible: true, bodyLostSince: null, teaserStepIn: false };
  }
  const bodyLostSince = state.bodyLostSince ?? now;
  return { ...state, bodyVisible: false, bodyLostSince };
}

/**
 * Clock for the teaser. Every step ends on its own; `playing` also ends when
 * the player reports the clip's endMs. A landed clip skips the tail.
 */
function settleTeaser(state: PreflightFlowState, now: number): PreflightFlowState {
  if (state.phase !== 'teaser' || state.teaserStep === null || state.teaserStepStartedAt === null) return state;
  let next = state;
  if (next.bodyLostSince !== null && !next.teaserStepIn && now - next.bodyLostSince >= TEASER_STEP_IN_MS) {
    next = { ...next, teaserStepIn: true };
  }
  const deadline = teaserStepDeadline(next)!;
  const landed = next.teaserHits[next.teaserClip] !== null && next.teaserHits[next.teaserClip] !== undefined;
  switch (next.teaserStep) {
    case 'playing': {
      const clip = TEASER_CLIPS[next.teaserClip]!;
      const reachedEnd = next.teaserVideoMs !== null && next.teaserVideoMs >= clip.endMs - TEASER_END_TOLERANCE_MS;
      if (!reachedEnd && now < deadline) return next;
      return enterStep(next, landed ? 'interstitial' : 'tail', now);
    }
    case 'tail':
      if (landed || now >= deadline) return enterStep(next, 'interstitial', now);
      return next;
    case 'interstitial': {
      if (now < deadline) return next;
      const index = next.teaserClip + 1;
      return index < TEASER_CLIPS.length ? startClip(next, index, now) : enterScoreCard(next, now);
    }
    case 'done':
      return now >= deadline ? complete(next, now, cameraOutcome(next)) : next;
    default:
      return next;
  }
}

/** Debounce: a new verdict must persist FRAMING_DEBOUNCE_MS before it shows. */
function applyFraming(
  state: PreflightFlowState,
  verdict: FramingVerdict,
  now: number,
): PreflightFlowState {
  if (verdict === state.framing) {
    return state.framingCandidate === null ? state : { ...state, framingCandidate: null };
  }
  if (state.framingCandidate !== verdict) {
    return { ...state, framingCandidate: verdict, framingCandidateSince: now };
  }
  if (now - state.framingCandidateSince >= FRAMING_DEBOUNCE_MS) {
    return { ...state, framing: verdict, framingCandidate: null };
  }
  return state;
}

/**
 * Ring full: lock → on to the teaser; no lock after the grace → on to the
 * teaser anyway (the run will calibrate live).
 */
function settleHold(state: PreflightFlowState, now: number): PreflightFlowState {
  if (state.phase !== 'hold' || state.holdStartedAt === null) return state;
  const held = now - state.holdStartedAt;
  if (held < HOLD_MS) return state;
  if (state.calibrated || held >= HOLD_MS + HOLD_LOCK_GRACE_MS) return enterTeaser(state, now);
  return state;
}

/** Back to framing from the hold: the body left the frame or was lost. */
function dropHold(state: PreflightFlowState, now: number): PreflightFlowState {
  return {
    ...enterFraming(state, now),
    // Keep the verdict that caused the drop so the big word is instant.
    framing: state.framing,
    calibrated: state.calibrated,
    holdRestarts: state.holdRestarts + 1,
  };
}

export function reducePreflightFlow(
  state: PreflightFlowState,
  event: PreflightFlowEvent,
): PreflightFlowState {
  switch (event.type) {
    case 'PERMISSION_GRANTED':
      if (state.phase !== 'permission' && state.phase !== 'unavailable') return state;
      return enterFraming({ ...state, startedAt: event.now }, event.now);

    case 'UNAVAILABLE':
      // Allowed from `complete` too: staging the handoff snapshot can fail
      // after the hold, and that must surface instead of a blank screen.
      return {
        ...state,
        phase: 'unavailable',
        phaseStartedAt: event.now,
        holdStartedAt: null,
        teaserStep: null,
        teaserStepStartedAt: null,
        outcome: null,
      };

    case 'RETRY':
      if (state.phase === 'complete') return state;
      return enterFraming({ ...state, startedAt: event.now }, event.now);

    case 'CONTINUE_WITHOUT_CAMERA':
      if (state.phase !== 'permission' && state.phase !== 'unavailable') return state;
      return complete(state, event.now, 'off');

    case 'TICK':
      return state.phase === 'teaser' ? settleTeaser(state, event.now) : settleHold(state, event.now);

    case 'VIDEO_TIME': {
      if (state.phase !== 'teaser' || state.teaserStep !== 'playing') return state;
      const clip = TEASER_CLIPS[state.teaserClip];
      // Positions from before the seek to this clip (or from nowhere near
      // it) are stale player chatter, not progress.
      if (!clip || event.positionMs < clip.startMs - TEASER_END_TOLERANCE_MS) return state;
      return settleTeaser({ ...state, teaserVideoMs: event.positionMs }, event.now);
    }

    case 'VIDEO_FAILED':
      // The bundled clip could not play: the teaser is decoration, the
      // baseline is what matters — finish with it.
      if (state.phase !== 'teaser') return state;
      return complete(state, event.now, cameraOutcome(state));

    case 'TRACKING_LOST': {
      if (!isCameraPhase(state.phase)) return state;
      // The teaser never fails: losing the body only turns the ring amber.
      if (state.phase === 'teaser') {
        return settleTeaser(applyBodyVisible({ ...state, trackingLost: true }, false, event.now), event.now);
      }
      const next = applyFraming({ ...state, trackingLost: true }, 'searching', event.now);
      if (next.phase === 'hold' && next.framing !== 'ok') return dropHold(next, event.now);
      return next;
    }

    case 'FRAME':
      return reduceFrame(state, event);

    case 'SKIP':
      if (!isCameraPhase(state.phase)) return state;
      return complete(state, event.now, cameraOutcome(state), true);
  }
}

function reduceFrame(
  state: PreflightFlowState,
  event: Extract<PreflightFlowEvent, { type: 'FRAME' }>,
): PreflightFlowState {
  if (!isCameraPhase(state.phase)) return state;
  const { now, status, move } = event;
  const trackingLost = status === 'searching' || status === 'reconnecting';
  const calibrated =
    status === 'tracking' ? true : status === 'calibrating' ? false : state.calibrated;

  if (state.phase === 'teaser') {
    // Framing is not judged here: shoulders + hips in view is all the ring
    // reports. A classified move inside the open window lands the clip.
    let next = applyBodyVisible(
      { ...state, trackingLost, calibrated },
      !trackingLost && event.framing !== 'searching',
      now,
    );
    if (move) next = landClip(next, now, move);
    return settleTeaser(next, now);
  }

  let next: PreflightFlowState = applyFraming({ ...state, trackingLost, calibrated }, event.framing, now);

  switch (state.phase) {
    case 'framing':
      return next.framing === 'ok' ? enterHold(next, now) : next;
    case 'hold': {
      if (next.framing !== 'ok') return dropHold(next, now);
      // A detected move means the user is not holding still: restart the ring
      // (never the phase — the big word stays "Hold still").
      if (move) next = { ...next, holdStartedAt: now, holdRestarts: state.holdRestarts + 1 };
      return settleHold(next, now);
    }
    default:
      return state;
  }
}

/** Whole-flow elapsed seconds for the dev timer (0 before the camera is live). */
export function flowElapsedSeconds(state: PreflightFlowState, now: number): number {
  if (state.phase === 'permission' || state.phase === 'unavailable') return 0;
  return Math.max(0, (now - state.startedAt) / 1000);
}

/**
 * Spoken prompt for the current state, or null when nothing should be said.
 * The screen rate-limits and de-duplicates; this only picks the line. The
 * teaser is silent except for "Step in" once the body has been missing for
 * TEASER_STEP_IN_MS, and the sign-off on the score card.
 */
export function spokenPrompt(state: PreflightFlowState): string | null {
  switch (state.phase) {
    case 'framing':
      switch (state.framing) {
        case 'back':
          return 'Step back';
        case 'closer':
          return 'Come closer';
        case 'center':
          return 'Center up';
        case 'searching':
          return 'Step into frame';
        default:
          return null;
      }
    case 'hold':
      return 'Perfect, hold still';
    case 'teaser':
      if (state.teaserStep === 'done') return "You're set";
      return state.teaserStepIn ? 'Step in' : null;
    case 'complete':
      return state.outcome === 'off' ? null : "You're set";
    default:
      return null;
  }
}
