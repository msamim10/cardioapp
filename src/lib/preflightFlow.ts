/**
 * Calibration micro-game state machine (preflight screen).
 *
 * Pure reducer so `scripts/replay-preflight-flow.ts` can drive it with
 * synthetic frames. It sits ON TOP of `PoseAnalyzer`: the analyzer keeps its
 * own 20-stable-frame calibration, cooldown/rearm and move classifiers, and
 * this reducer only consumes the analyzer's per-frame result (status, move,
 * readiness) plus the read-only framing verdict from `skeletonFraming`.
 *
 * Phases
 *   permission  Screen 1 — "Your body is the controller." + Turn on camera.
 *   framing     Phase 1 — body outline + Move closer / Move back coaching.
 *               Advances when the analyzer is calibrated AND framing is ok.
 *   moves       Phase 2 — JUMP / DUCK / DODGE LEFT / DODGE RIGHT test drive
 *               (first run only; each move may be skipped).
 *   handoff     Phase 3 — the analyzer must report PREFLIGHT_STABLE_FRAMES
 *               neutral frames, then a short countdown (3 s guided, 2 s
 *               express) before the snapshot is handed to the run.
 *   complete    Route out. `outcome` says how the run should start.
 *   unavailable No detector / camera error; explicit "continue without" only.
 *
 * Repeat runs skip `moves` entirely (framing → handoff) and keep the express
 * countdown for anyone who has calibrated on this device before.
 */

import type { Move, PoseReadiness, TrackingStatus } from '@/lib/poseTracking';
import {
  PREFLIGHT_COUNTDOWN_SECONDS,
  PREFLIGHT_EXPRESS_COUNTDOWN_SECONDS,
  PREFLIGHT_STABLE_FRAMES,
} from '@/lib/preflightState';
import type { FramingVerdict } from '@/lib/skeletonFraming';

export type PreflightFlowPhase =
  | 'permission'
  | 'framing'
  | 'moves'
  | 'handoff'
  | 'complete'
  | 'unavailable';

/**
 * How the run starts once the flow completes.
 *   calibrated  snapshot handoff (the happy path)
 *   defaults    camera works but no lock: no snapshot, the run calibrates live
 *   off         camera denied / detector unavailable: tracking off for the run
 */
export type PreflightOutcome = 'calibrated' | 'defaults' | 'off';

export const MOVE_TEST_ORDER: readonly Move[] = ['Jump', 'Duck', 'Left', 'Right'];

/** Prompt shown for each test-drive move. */
export const MOVE_PROMPT: Record<Move, string> = {
  Jump: 'JUMP!',
  Duck: 'DUCK!',
  Left: 'DODGE LEFT!',
  Right: 'DODGE RIGHT!',
};

/** A framing verdict must hold this long before the coaching line changes. */
export const FRAMING_DEBOUNCE_MS = 400;
/** After this long in Phase 1 the "Having trouble?" fallback is offered. */
export const FRAMING_FALLBACK_MS = 10_000;
/** First-run end card duration before routing on. */
export const END_CARD_MS = 1_200;

/** Rotating Phase 3 status lines. Never jargon. */
export const SYNC_LINES: readonly string[] = [
  'Syncing your avatar…',
  'Locking in your moves…',
  'Tuning the controller to you…',
];

export type PreflightFlowState = {
  phase: PreflightFlowPhase;
  firstRun: boolean;
  /** Shorter Phase 3 countdown for a body this device has already calibrated. */
  express: boolean;
  /** When the camera went live (dev timer origin). */
  startedAt: number;
  phaseStartedAt: number;
  // Phase 1
  /** Debounced, displayed framing verdict. */
  framing: FramingVerdict;
  framingCandidate: FramingVerdict | null;
  framingCandidateSince: number;
  /** Analyzer has a baseline (status `tracking`). */
  calibrated: boolean;
  /** Body currently not seen by the analyzer (searching / reconnecting). */
  trackingLost: boolean;
  /** Phase 1 has run ≥ FRAMING_FALLBACK_MS: show the fallback link. */
  fallbackOffered: boolean;
  // Phase 2
  moveIndex: number;
  completedMoves: Move[];
  skippedMoves: Move[];
  movesDone: boolean;
  // Phase 3
  stableFrames: number;
  countdown: number | null;
  outcome: PreflightOutcome | null;
};

export type PreflightFlowEvent =
  | { type: 'PERMISSION_GRANTED'; now: number }
  | { type: 'SET_EXPRESS'; express: boolean }
  | {
      type: 'FRAME';
      now: number;
      framing: FramingVerdict;
      status: TrackingStatus;
      move: Move | null;
      readiness: PoseReadiness;
    }
  /** Native detector reports no body (no frames arrive while this holds). */
  | { type: 'TRACKING_LOST'; now: number }
  | { type: 'TICK'; now: number }
  | { type: 'SKIP_MOVE'; now: number }
  /**
   * "Having trouble?" in Phase 1. With a calibrated analyzer this is
   * "good enough" and simply advances; otherwise the run starts on defaults.
   */
  | { type: 'FALLBACK_CONTINUE'; now: number }
  /** Denied / unavailable: run without tracking. */
  | { type: 'CONTINUE_WITHOUT_CAMERA'; now: number }
  | { type: 'COUNTDOWN_TICK'; now: number }
  | { type: 'UNAVAILABLE'; now: number }
  | { type: 'RETRY'; now: number };

export function createPreflightFlowState(options: {
  firstRun: boolean;
  express?: boolean;
  now?: number;
}): PreflightFlowState {
  const now = options.now ?? 0;
  return {
    phase: 'permission',
    firstRun: options.firstRun,
    express: options.express ?? false,
    startedAt: now,
    phaseStartedAt: now,
    framing: 'searching',
    framingCandidate: null,
    framingCandidateSince: now,
    calibrated: false,
    trackingLost: false,
    fallbackOffered: false,
    moveIndex: 0,
    completedMoves: [],
    skippedMoves: [],
    movesDone: false,
    stableFrames: 0,
    countdown: null,
    outcome: null,
  };
}

export const ACTIVE_PHASES: readonly PreflightFlowPhase[] = ['framing', 'moves', 'handoff'];

/** The camera should be live and frames should reach the analyzer. */
export function isCameraPhase(phase: PreflightFlowPhase): boolean {
  return ACTIVE_PHASES.includes(phase);
}

export function currentTestMove(state: PreflightFlowState): Move | null {
  return state.phase === 'moves' ? (MOVE_TEST_ORDER[state.moveIndex] ?? null) : null;
}

export function countdownSeconds(express: boolean): number {
  return express ? PREFLIGHT_EXPRESS_COUNTDOWN_SECONDS : PREFLIGHT_COUNTDOWN_SECONDS;
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
    fallbackOffered: false,
    stableFrames: 0,
    countdown: null,
  };
}

function enterHandoff(state: PreflightFlowState, now: number): PreflightFlowState {
  return {
    ...state,
    phase: 'handoff',
    phaseStartedAt: now,
    stableFrames: 0,
    countdown: null,
    trackingLost: false,
  };
}

/** Leave Phase 1: first run goes to the move test drive, repeats to handoff. */
function advanceFromFraming(state: PreflightFlowState, now: number): PreflightFlowState {
  if (state.firstRun && !state.movesDone) {
    return { ...state, phase: 'moves', phaseStartedAt: now, trackingLost: false };
  }
  return enterHandoff(state, now);
}

function complete(
  state: PreflightFlowState,
  now: number,
  outcome: PreflightOutcome,
): PreflightFlowState {
  return { ...state, phase: 'complete', phaseStartedAt: now, outcome, countdown: null };
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

function offerFallbackIfDue(state: PreflightFlowState, now: number): PreflightFlowState {
  if (state.phase !== 'framing' || state.fallbackOffered) return state;
  return now - state.phaseStartedAt >= FRAMING_FALLBACK_MS
    ? { ...state, fallbackOffered: true }
    : state;
}

function finishMove(state: PreflightFlowState, now: number): PreflightFlowState {
  if (state.moveIndex >= MOVE_TEST_ORDER.length) {
    return enterHandoff({ ...state, movesDone: true }, now);
  }
  return state;
}

export function reducePreflightFlow(
  state: PreflightFlowState,
  event: PreflightFlowEvent,
): PreflightFlowState {
  switch (event.type) {
    case 'PERMISSION_GRANTED':
      if (state.phase !== 'permission' && state.phase !== 'unavailable') return state;
      return enterFraming({ ...state, startedAt: event.now }, event.now);

    case 'SET_EXPRESS':
      return state.express === event.express ? state : { ...state, express: event.express };

    case 'UNAVAILABLE':
      // Allowed from `complete` too: staging the handoff snapshot can fail
      // after the countdown, and that must surface instead of a blank screen.
      return {
        ...state,
        phase: 'unavailable',
        phaseStartedAt: event.now,
        countdown: null,
        outcome: null,
      };

    case 'RETRY':
      if (state.phase === 'complete') return state;
      return enterFraming({ ...state, startedAt: event.now }, event.now);

    case 'CONTINUE_WITHOUT_CAMERA':
      if (state.phase !== 'permission' && state.phase !== 'unavailable') return state;
      return complete(state, event.now, 'off');

    case 'TICK':
      return offerFallbackIfDue(state, event.now);

    case 'TRACKING_LOST': {
      if (!isCameraPhase(state.phase)) return state;
      let next: PreflightFlowState = { ...state, trackingLost: true };
      if (state.phase === 'framing') {
        next = offerFallbackIfDue(applyFraming(next, 'searching', event.now), event.now);
      } else if (state.phase === 'handoff') {
        next = { ...next, stableFrames: 0, countdown: null };
      }
      return next;
    }

    case 'FRAME':
      return reduceFrame(state, event);

    case 'SKIP_MOVE': {
      const move = currentTestMove(state);
      if (!move) return state;
      return finishMove(
        {
          ...state,
          moveIndex: state.moveIndex + 1,
          skippedMoves: [...state.skippedMoves, move],
        },
        event.now,
      );
    }

    case 'FALLBACK_CONTINUE':
      if (state.phase !== 'framing') return state;
      return state.calibrated
        ? advanceFromFraming(state, event.now)
        : complete(state, event.now, 'defaults');

    case 'COUNTDOWN_TICK': {
      if (state.phase !== 'handoff' || state.countdown === null) return state;
      const countdown = state.countdown - 1;
      if (countdown <= 0) return complete(state, event.now, 'calibrated');
      return { ...state, countdown };
    }
  }
}

function reduceFrame(
  state: PreflightFlowState,
  event: Extract<PreflightFlowEvent, { type: 'FRAME' }>,
): PreflightFlowState {
  if (!isCameraPhase(state.phase)) return state;
  const { now, status, move, readiness } = event;
  const trackingLost = status === 'searching' || status === 'reconnecting';
  const calibrated =
    status === 'tracking' ? true : status === 'calibrating' ? false : state.calibrated;
  let next: PreflightFlowState = { ...state, trackingLost, calibrated };

  switch (state.phase) {
    case 'framing': {
      next = applyFraming(next, event.framing, now);
      if (next.calibrated && next.framing === 'ok') return advanceFromFraming(next, now);
      return offerFallbackIfDue(next, now);
    }
    case 'moves': {
      // The analyzer dropped its baseline (lost > grace): re-frame, keep the
      // moves already earned.
      if (status === 'calibrating') return enterFraming(next, now);
      const expected = MOVE_TEST_ORDER[state.moveIndex];
      if (move && move === expected) {
        return finishMove(
          {
            ...next,
            moveIndex: state.moveIndex + 1,
            completedMoves: [...state.completedMoves, move],
          },
          now,
        );
      }
      return next;
    }
    case 'handoff': {
      if (status === 'calibrating') return enterFraming(next, now);
      const neutral = status === 'tracking' && !move && readiness === 'ready';
      if (!neutral) return { ...next, stableFrames: 0, countdown: null };
      const stableFrames = state.stableFrames + 1;
      if (state.countdown === null && stableFrames >= PREFLIGHT_STABLE_FRAMES) {
        return { ...next, stableFrames, countdown: countdownSeconds(state.express) };
      }
      return { ...next, stableFrames };
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
