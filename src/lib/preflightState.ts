export type PreflightPhase =
  | 'permission'
  | 'preparing'
  | 'calibrating'
  | 'stabilizing'
  | 'countdown'
  | 'unavailable'
  | 'timed-out';

export type PreflightState = {
  phase: PreflightPhase;
  stableFrames: number;
  countdown: number | null;
};

export type PreflightEvent =
  | { type: 'PERMISSION_GRANTED' }
  | { type: 'CALIBRATION_PROGRESS' }
  | { type: 'CALIBRATION_READY' }
  | { type: 'STABLE_FRAME'; countdownFrom?: number }
  | { type: 'TRACKING_LOST' }
  | { type: 'COUNTDOWN_TICK' }
  | { type: 'UNAVAILABLE' }
  | { type: 'TIMEOUT' }
  | { type: 'RETRY' };

export const PREFLIGHT_STABLE_FRAMES = 6;

export const PREFLIGHT_COUNTDOWN_SECONDS = 3;

/** Returning users have already proven the framing, so the hold is shorter. */
export const PREFLIGHT_EXPRESS_COUNTDOWN_SECONDS = 2;

export const INITIAL_PREFLIGHT_STATE: PreflightState = {
  phase: 'permission',
  stableFrames: 0,
  countdown: null,
};

export function reducePreflight(
  state: PreflightState,
  event: PreflightEvent,
): PreflightState {
  switch (event.type) {
    case 'PERMISSION_GRANTED':
      return { phase: 'preparing', stableFrames: 0, countdown: null };
    case 'CALIBRATION_PROGRESS':
      return { phase: 'calibrating', stableFrames: 0, countdown: null };
    case 'CALIBRATION_READY':
      return { phase: 'stabilizing', stableFrames: 0, countdown: null };
    case 'STABLE_FRAME': {
      if (state.phase !== 'stabilizing') return state;
      const stableFrames = state.stableFrames + 1;
      return stableFrames >= PREFLIGHT_STABLE_FRAMES
        ? {
            phase: 'countdown',
            stableFrames,
            countdown: event.countdownFrom ?? PREFLIGHT_COUNTDOWN_SECONDS,
          }
        : { ...state, stableFrames };
    }
    case 'TRACKING_LOST':
      return state.phase === 'countdown' || state.phase === 'stabilizing'
        ? { phase: 'calibrating', stableFrames: 0, countdown: null }
        : state;
    case 'COUNTDOWN_TICK':
      return state.phase === 'countdown'
        ? {
            ...state,
            countdown: Math.max(0, (state.countdown ?? PREFLIGHT_COUNTDOWN_SECONDS) - 1),
          }
        : state;
    case 'UNAVAILABLE':
      return { phase: 'unavailable', stableFrames: 0, countdown: null };
    case 'TIMEOUT':
      return state.phase === 'countdown'
        ? state
        : { phase: 'timed-out', stableFrames: 0, countdown: null };
    case 'RETRY':
      return { phase: 'preparing', stableFrames: 0, countdown: null };
  }
}
