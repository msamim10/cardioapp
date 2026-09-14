/**
 * Calibration state machine (preflight screen): a 3-second hold, then the
 * four moves once each.
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
 *               restarts the ring. When the ring is full (and the analyzer
 *               has its baseline, or the lock grace ran out) → `moves`.
 *   moves       JUMP · DUCK · LEFT · RIGHT, one at a time, MOVE_WINDOW_MS
 *               each. A move passes on detection of that move, on ANY
 *               detected move or significant body motion (`bodyMotion.ts`;
 *               the user is clearly moving), or when the window ends — it
 *               cannot fail and is never retried. Every pass
 *               shows a ✓ for at least MOVE_LANDED_MS; the next prompt never
 *               starts sooner than MOVE_WINDOW_MS after the previous one so
 *               each spoken prompt clears the speech gate. Framing and
 *               tracking loss are ignored here.
 *   complete    Route out. `outcome` says how the run should start.
 *   unavailable No detector / camera error; explicit "continue without" only.
 *
 * Happy path ≈ 2 s walking in + 3 s hold + 10–12 s of moves. The first two
 * runs still open with the in-run warm-up (workout.tsx); that is untouched.
 */

import type { Move, TrackingStatus } from '@/lib/poseTracking';
import type { FramingVerdict } from '@/lib/skeletonFraming';

export type PreflightFlowPhase = 'permission' | 'framing' | 'hold' | 'moves' | 'complete' | 'unavailable';

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

/** The four moves, once each, in this order. */
export const MOVE_ORDER: readonly Move[] = ['Jump', 'Duck', 'Left', 'Right'];
/**
 * How long each move prompt is up before it passes on its own. Equal to the
 * speech gate's minimum gap (`SPEECH_MIN_GAP_MS`), so consecutive prompts are
 * always spoken.
 */
export const MOVE_WINDOW_MS = 2_500;
/** Minimum time the ✓ stays up after a pass before the next prompt. */
export const MOVE_LANDED_MS = 600;
/** Everything the move phase can add: four windows, each with a ✓ tail. */
export const MOVES_MAX_MS = MOVE_ORDER.length * (MOVE_WINDOW_MS + MOVE_LANDED_MS);

/** Oversized prompt word per move. */
export const MOVE_WORD: Record<Move, string> = {
  Jump: 'JUMP',
  Duck: 'DUCK',
  Left: 'LEFT',
  Right: 'RIGHT',
};

/** Spoken line per move. */
export const MOVE_SPOKEN: Record<Move, string> = {
  Jump: 'Jump!',
  Duck: 'Duck!',
  Left: 'Left!',
  Right: 'Right!',
};

/** Why the current move passed. `auto` = the window ended (never a failure). */
export type MovePass = 'detected' | 'motion' | 'auto';

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
  /** Index into MOVE_ORDER while in `moves`; MOVE_ORDER.length once all passed. */
  moveIndex: number;
  /** When the current move's window opened; null outside `moves`. */
  moveWindowStartedAt: number | null;
  /** When the current move passed (✓ showing); null while the prompt is up. */
  movePassedAt: number | null;
  movePassedBy: MovePass | null;
  /** How each move passed, in MOVE_ORDER (analytics / dev timer). */
  movePasses: MovePass[];
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
      /**
       * The body clearly moved since the last frames (`bodyMotion.ts`), even
       * if no classifier fired. Only read during `moves`.
       */
      motion?: boolean;
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
    moveIndex: 0,
    moveWindowStartedAt: null,
    movePassedAt: null,
    movePassedBy: null,
    movePasses: [],
    outcome: null,
  };
}

export const ACTIVE_PHASES: readonly PreflightFlowPhase[] = ['framing', 'hold', 'moves'];

/** The camera should be live and frames should reach the analyzer. */
export function isCameraPhase(phase: PreflightFlowPhase): boolean {
  return ACTIVE_PHASES.includes(phase);
}

/** Ring fill 0..1 (1 while waiting on the analyzer lock; 0 outside `hold`). */
export function holdProgress(state: PreflightFlowState, now: number): number {
  if (state.phase !== 'hold' || state.holdStartedAt === null) return 0;
  return Math.max(0, Math.min(1, (now - state.holdStartedAt) / HOLD_MS));
}

/** The move being prompted (or just passed), or null outside `moves`. */
export function currentMove(state: PreflightFlowState): Move | null {
  if (state.phase !== 'moves') return null;
  return MOVE_ORDER[state.moveIndex] ?? null;
}

/** The current move has passed and its ✓ is showing. */
export function moveLanded(state: PreflightFlowState): boolean {
  return state.phase === 'moves' && state.movePassedAt !== null;
}

/** Fraction of the current move's window elapsed, 0..1 (1 once passed). */
export function moveWindowProgress(state: PreflightFlowState, now: number): number {
  if (state.phase !== 'moves' || state.moveWindowStartedAt === null) return 0;
  if (state.movePassedAt !== null) return 1;
  return Math.max(0, Math.min(1, (now - state.moveWindowStartedAt) / MOVE_WINDOW_MS));
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
    moveIndex: 0,
    moveWindowStartedAt: null,
    movePassedAt: null,
    movePassedBy: null,
    movePasses: [],
  };
}

function enterHold(state: PreflightFlowState, now: number): PreflightFlowState {
  return { ...state, phase: 'hold', phaseStartedAt: now, holdStartedAt: now, trackingLost: false };
}

function enterMoves(state: PreflightFlowState, now: number): PreflightFlowState {
  return {
    ...state,
    phase: 'moves',
    phaseStartedAt: now,
    holdStartedAt: null,
    moveIndex: 0,
    moveWindowStartedAt: now,
    movePassedAt: null,
    movePassedBy: null,
    movePasses: [],
  };
}

function complete(
  state: PreflightFlowState,
  now: number,
  outcome: PreflightOutcome,
): PreflightFlowState {
  return {
    ...state,
    phase: 'complete',
    phaseStartedAt: now,
    outcome,
    holdStartedAt: null,
    moveWindowStartedAt: null,
    movePassedAt: null,
  };
}

/** How the run starts given what the analyzer managed: a baseline or not. */
function cameraOutcome(state: PreflightFlowState): PreflightOutcome {
  return state.calibrated ? 'calibrated' : 'defaults';
}

/** Mark the current move passed (idempotent while its ✓ is up). */
function passMove(state: PreflightFlowState, now: number, by: MovePass): PreflightFlowState {
  if (state.phase !== 'moves' || state.movePassedAt !== null) return state;
  return { ...state, movePassedAt: now, movePassedBy: by, movePasses: [...state.movePasses, by] };
}

/**
 * Clock for the move phase: auto-pass when the window ends; once the ✓ has
 * been up for MOVE_LANDED_MS AND the window has run its course, open the next
 * prompt — or complete after the last one.
 */
function settleMoves(state: PreflightFlowState, now: number): PreflightFlowState {
  if (state.phase !== 'moves' || state.moveWindowStartedAt === null) return state;
  let next = state;
  const windowEnd = next.moveWindowStartedAt! + MOVE_WINDOW_MS;
  if (next.movePassedAt === null) {
    if (now < windowEnd) return next;
    next = passMove(next, now, 'auto');
  }
  const slotEnd = Math.max(windowEnd, next.movePassedAt! + MOVE_LANDED_MS);
  if (now < slotEnd) return next;
  const moveIndex = next.moveIndex + 1;
  if (moveIndex >= MOVE_ORDER.length) return complete({ ...next, moveIndex }, now, cameraOutcome(next));
  return { ...next, moveIndex, moveWindowStartedAt: now, movePassedAt: null, movePassedBy: null };
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
 * Ring full: lock → on to the moves; no lock after the grace → on to the
 * moves anyway (the run will calibrate live; the prompts auto-pass).
 */
function settleHold(state: PreflightFlowState, now: number): PreflightFlowState {
  if (state.phase !== 'hold' || state.holdStartedAt === null) return state;
  const held = now - state.holdStartedAt;
  if (held < HOLD_MS) return state;
  if (state.calibrated || held >= HOLD_MS + HOLD_LOCK_GRACE_MS) return enterMoves(state, now);
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
      return state.phase === 'moves' ? settleMoves(state, event.now) : settleHold(state, event.now);

    case 'TRACKING_LOST': {
      if (!isCameraPhase(state.phase)) return state;
      // The move check never fails: losing the body just lets the window run out.
      if (state.phase === 'moves') return settleMoves({ ...state, trackingLost: true }, event.now);
      const next = applyFraming({ ...state, trackingLost: true }, 'searching', event.now);
      if (next.phase === 'hold' && next.framing !== 'ok') return dropHold(next, event.now);
      return next;
    }

    case 'FRAME':
      return reduceFrame(state, event);

    case 'SKIP':
      if (!isCameraPhase(state.phase)) return state;
      return complete(state, event.now, cameraOutcome(state));
  }
}

function reduceFrame(
  state: PreflightFlowState,
  event: Extract<PreflightFlowEvent, { type: 'FRAME' }>,
): PreflightFlowState {
  if (!isCameraPhase(state.phase)) return state;
  const { now, status, move, motion } = event;
  const trackingLost = status === 'searching' || status === 'reconnecting';
  const calibrated =
    status === 'tracking' ? true : status === 'calibrating' ? false : state.calibrated;

  if (state.phase === 'moves') {
    // Framing is not judged here. The prompted move passes the current
    // prompt ("detected"); any other classified move, or significant body
    // motion the classifiers did not name, passes it too ("motion").
    let next: PreflightFlowState = { ...state, trackingLost, calibrated };
    if (move) next = passMove(next, now, move === currentMove(next) ? 'detected' : 'motion');
    else if (motion) next = passMove(next, now, 'motion');
    return settleMoves(next, now);
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
    case 'moves': {
      const move = currentMove(state);
      return move ? MOVE_SPOKEN[move] : null;
    }
    case 'complete':
      return state.outcome === 'off' ? null : "You're set";
    default:
      return null;
  }
}
