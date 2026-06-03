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
export const CAMERA_DUCK_HEIGHT = 0.85;
export const CAMERA_JUMP_PEAK = 2.6;
export const LANE_CHANGE_DURATION = 0.32;
export const JUMP_DURATION = 0.7;
export const DUCK_DURATION = 0.55;

export const LOOK_AHEAD_DISTANCE = 18;
export const REACT_DISTANCE = 9;

export const FOG_NEAR = 32;
export const FOG_FAR = 105;
export const SKY_COLOR = '#5fc4ff';
export const FOG_COLOR = '#c2e3f7';
export const GROUND_COLOR = '#5a4126';

// Subway Surfers-ish arcade palette: bright, saturated, candy-cartoon.
export const ARCADE_PALETTE = {
  trainBodies: ['#fde047', '#ec4899', '#22c55e', '#06b6d4', '#a855f7', '#ef4444'],
  trainRoofs: ['#dc2626', '#fde047', '#ef4444', '#fde047', '#fde047', '#22c55e'],
  trainTrims: ['#ef4444', '#fde047', '#fde047', '#facc15', '#22c55e', '#fde047'],
  buildings: [
    '#f97316', '#ec4899', '#22d3ee', '#fde047', '#a855f7', '#22c55e',
    '#fb7185', '#60a5fa', '#fbbf24', '#34d399',
  ],
  graffiti: ['#fde047', '#ec4899', '#22c55e', '#06b6d4', '#fb923c', '#a855f7', '#84cc16'],
  windowsLit: ['#fef3c7', '#fde68a', '#fef08a'],
  windowsDark: '#1f2937',
};

export const DEFAULT_MET = 7.0;
export const DEFAULT_WEIGHT_KG = 70;

export const STORAGE_KEYS = {
  sessions: '@cardiosurf/sessions',
  profile: '@cardiosurf/profile',
} as const;
