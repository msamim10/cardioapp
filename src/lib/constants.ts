import type { Lane } from './types';

export const LANES: Lane[] = [-1, 0, 1];

export const LANE_X = {
  '-1': -1.6,
  '0': 0,
  '1': 1.6,
} as const;

export const TRACK_WIDTH = 5.2;
export const CHUNK_LENGTH = 24;
export const CHUNKS_AHEAD = 5;
export const CHUNKS_BEHIND = 1;

export const CAMERA_FORWARD_SPEED = 11;
export const CAMERA_EYE_HEIGHT = 1.55;
export const LANE_CHANGE_DURATION = 0.32;
export const JUMP_DURATION = 0.7;
export const DUCK_DURATION = 0.55;

// Runner character (the visible player the camera chases).
export const RUNNER_HEIGHT = 1.74;
export const RUNNER_JUMP_PEAK = 1.35;

/**
 * Third-person chase camera matching the reference framing: low and close
 * behind the runner so the character sits large at bottom-center and the
 * track stretches ahead with strong perspective.
 */
export const CAMERA_RIG = {
  back: 4.4, // meters behind the runner
  height: 3.05, // meters above the runner's floor
  lookAhead: 6.5, // look-at point this far in front of the runner
  lookHeight: 1.25,
  /** Fraction of the runner's lane X the camera mirrors (parallax). */
  lateralFollow: 0.6,
  /** Exponential smoothing rate for vertical follow (jump softening). */
  ySmoothing: 6,
  /** Fraction of the runner's Y (jumps, train roofs) the camera follows. */
  yFollow: 0.6,
} as const;

/**
 * Distance the chasing guard trails behind the runner. Tuned with
 * CAMERA_RIG.back (4.4) so the guard sits ~2.4m in front of the camera:
 * visible from the waist up at the bottom edge of the frame, like the
 * reference shot.
 */
export const GUARD_BACK = 2.0;

export const LOOK_AHEAD_DISTANCE = 18;
export const REACT_DISTANCE = 9;

export const FOG_NEAR = 32;
export const FOG_FAR = 105;
export const SKY_COLOR = '#4fb8f7';
export const FOG_COLOR = '#bfe2f9';
export const GROUND_COLOR = '#7d5c3c';

// Canyon-run palette matched to the reference shot: red/cream trains on a
// dirt-and-gravel track corridor between mossy blue-grey cliffs topped
// with low-poly pines, under a bright blue sky.
export const ARCADE_PALETTE = {
  // Train liveries: [body, roof, trim/stripe, nose]. The classic red/cream
  // car is the hero look (weighted heavily in pickers); a blue and a green
  // variant keep consists from looking copy-pasted.
  trainLiveries: [
    { body: '#d8403a', roof: '#f3ecdb', trim: '#8e2722', nose: '#e0635c' }, // classic red
    { body: '#2f7fc1', roof: '#f3ecdb', trim: '#1c5687', nose: '#5ba0d6' }, // lake blue
    { body: '#3da152', roof: '#f3ecdb', trim: '#1f6e35', nose: '#67bd78' }, // forest green
  ],
  // Window glass + frames (light blue panes in white frames, as in the ref).
  windowGlass: '#aeddf2',
  windowFrame: '#f6f3ea',
  // Cargo wagon hulls + container colors for the freight variant.
  cargoHulls: ['#6b7280', '#57534e', '#475569'],
  containers: ['#e2574c', '#2f9e6e', '#3577c9', '#e8a33d', '#7f5fc4'],
  // Track materials
  ballast: '#9b948a',
  ballastShoulder: '#857e74',
  sleeper: '#3d2f22',
  rail: '#e8eaee',
  railSide: '#9aa1ac',
  dirt: '#7d5c3c',
  // Canyon rock + greenery
  rock: '#8fa6b8',
  rockDark: '#71889b',
  rockShadow: '#5d7184',
  moss: '#56b04e',
  pineDark: '#2e8b46',
  pine: '#46b35a',
  pineLight: '#67cf72',
  trunk: '#7a5230',
  wallConcrete: '#cfc4b2',
  steel: '#3f4753',
  steelLight: '#5d6673',
  hazardRed: '#e23b3b',
  hazardWhite: '#f8f5ee',
};

export const DEFAULT_MET = 7.0;
export const DEFAULT_WEIGHT_KG = 70;

export const STORAGE_KEYS = {
  sessions: '@cardiosurf/sessions',
  profile: '@cardiosurf/profile',
} as const;
