export type Lane = -1 | 0 | 1;
export type ChunkKind = 'road' | 'tunnel';

export type GameplayChunk = {
  id: string;
  sequence: number;
  z: number;
  kind: ChunkKind;
  trainLane: Lane | null;
  trainOffsetZ: number;
};

export const ROAD_MODEL = require('../../../assets/models/gameplay/Road.mobile.glb');
export const TUNNEL_MODEL = require('../../../assets/models/gameplay/Tunnel.mobile.glb');
export const TRAIN_MODEL = require('../../../assets/models/gameplay/Train.mobile.glb');

export const GAMEPLAY_MODEL_ASSETS = [ROAD_MODEL, TUNNEL_MODEL, TRAIN_MODEL] as const;

export const LANES: readonly Lane[] = [-1, 0, 1];
export const LANE_X: Record<Lane, number> = {
  [-1]: -3.1,
  0: 0,
  1: 3.1,
};

export const CAMERA_LANE: Lane = 0;
export const CAMERA_START_Z = 7;
export const CAMERA_HEIGHT = 2.35;
export const CAMERA_LOOK_Y = 1.35;
export const CAMERA_LOOK_AHEAD = 18;
export const RUN_SPEED = 9.2;

export const CHUNK_LENGTH = 18.8;
export const VISIBLE_CHUNKS = 8;
export const CHUNKS_BEHIND_CAMERA = 1;

export const ROAD_SCALE = 10;
export const TUNNEL_SCALE = 10;
export const TRAIN_SCALE = 6.2;
export const TRAIN_ROTATION_Y = Math.PI / 2;

export const TUNNEL_CHANCE = 0.24;
export const TRAIN_CHANCE = 0.48;

export const SKY_COLOR = '#73c7ff';
export const FOG_COLOR = '#b8def1';
export const FOG_NEAR = 36;
export const FOG_FAR = 125;
