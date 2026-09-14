/**
 * Calibration state machine (preflight screen): a 3-second hold.
 *
 * Pure reducer so `scripts/replay-preflight-flow.ts` can drive it with
 * synthetic frames. It sits ON TOP of `PoseAnalyzer`: the analyzer keeps its
 * own 20-stable-frame calibration, cooldown/rearm and move classifiers, and
 * this reducer only consumes the analyzer's per-frame result (status, move)
 * plus the read-only upper-body framing verdict from `skeletonFraming`.
 *
 * Phases
 *   permission  Screen 1 — "Your body is the controller." + Turn on camera.
 *   framing     "Step into frame": one big word (Step in / Closer / Step back /
 *               Center up) until head + shoulders + hips sit inside the frame.
 *               Legs are optional.
 *   hold        Framing is ok: a HOLD_MS ring fills while the user stands
 *               still. Moving, drifting out of frame or losing the body
 *               restarts the ring. When the ring is full AND the analyzer has
 *               its baseline the flow completes on its own — no tap.
 *   complete    Route out. `outcome` says how the run should start.
 *   unavailable No detector / camera error; explicit "continue without" only.
 *
 * Happy path ≈ 2 s walking in + 3 s hold. There is no move test drive any
 * more: the first two runs open with an in-run warm-up instead (workout.tsx).
 */

import type { Move, TrackingStatus } from '@/lib/poseTracking';
import type { FramingVerdict } from '@/lib/skeletonFraming';

export type PreflightFlowPhase = 'permission' | 'framing' | 'hold' | 'complete' | 'unavailable';

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
/** First-run end card duration before routing on. */
export const END_CARD_MS = 1_200;

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
    outcome: null,
  };
}

export const ACTIVE_PHASES: readonly PreflightFlowPhase[] = ['framing', 'hold'];

/** The camera should be live and frames should reach the analyzer. */
export function isCameraPhase(phase: PreflightFlowPhase): boolean {
  return ACTIVE_PHASES.includes(phase);
}

/** Ring fill 0..1 (1 while waiting on the analyzer lock; 0 outside `hold`). */
export function holdProgress(state: PreflightFlowState, now: number): number {
  if (state.phase !== 'hold' || state.holdStartedAt === null) return 0;
  return Math.max(0, Math.min(1, (now - state.holdStartedAt) / HOLD_MS));
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
  };
}

function enterHold(state: PreflightFlowState, now: number): PreflightFlowState {
  return { ...state, phase: 'hold', phaseStartedAt: now, holdStartedAt: now, trackingLost: false };
}

function complete(
  state: PreflightFlowState,
  now: number,
  outcome: PreflightOutcome,
): PreflightFlowState {
  return { ...state, phase: 'complete', phaseStartedAt: now, outcome, holdStartedAt: null };
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

/** Ring full: lock → calibrated; no lock after the grace → defaults. */
function settleHold(state: PreflightFlowState, now: number): PreflightFlowState {
  if (state.phase !== 'hold' || state.holdStartedAt === null) return state;
  const held = now - state.holdStartedAt;
  if (held < HOLD_MS) return state;
  if (state.calibrated) return complete(state, now, 'calibrated');
  if (held >= HOLD_MS + HOLD_LOCK_GRACE_MS) return complete(state, now, 'defaults');
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
        outcome: null,
      };

    case 'RETRY':
      if (state.phase === 'complete') return state;
      return enterFraming({ ...state, startedAt: event.now }, event.now);

    case 'CONTINUE_WITHOUT_CAMERA':
      if (state.phase !== 'permission' && state.phase !== 'unavailable') return state;
      return complete(state, event.now, 'off');

    case 'TICK':
      return settleHold(state, event.now);

    case 'TRACKING_LOST': {
      if (!isCameraPhase(state.phase)) return state;
      const next = applyFraming({ ...state, trackingLost: true }, 'searching', event.now);
      if (next.phase === 'hold' && next.framing !== 'ok') return dropHold(next, event.now);
      return next;
    }

    case 'FRAME':
      return reduceFrame(state, event);

    case 'SKIP':
      if (!isCameraPhase(state.phase)) return state;
      return complete(state, event.now, state.calibrated ? 'calibrated' : 'defaults');
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
 * The screen rate-limits and de-duplicates; this only picks the line.
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
    case 'complete':
      return state.outcome === 'off' ? null : "You're set";
    default:
      return null;
  }
}
