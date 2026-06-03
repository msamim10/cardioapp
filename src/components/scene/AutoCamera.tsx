import { useFrame, useThree } from '@react-three/fiber/native';
import { MutableRefObject, useEffect, useRef } from 'react';
import {
  CAMERA_DUCK_HEIGHT,
  CAMERA_EYE_HEIGHT,
  CAMERA_FORWARD_SPEED,
  CAMERA_JUMP_PEAK,
  DUCK_DURATION,
  JUMP_DURATION,
  LANE_CHANGE_DURATION,
  LANE_X,
  REACT_DISTANCE,
} from '@/lib/constants';
import { cameraBaseY, forcedLaneFor, upcomingRoofLane } from '@/lib/roofRun';
import type { ActionCue, ChunkSpec, Lane, ObstacleSpec } from '@/lib/types';

type Props = {
  chunksRef: MutableRefObject<ChunkSpec[]>;
  paused?: boolean;
  onCueChange?: (cue: ActionCue) => void;
};

type CameraState = {
  currentLane: Lane;
  targetLane: Lane;
  laneSwitching: boolean;
  laneStartTime: number;
  laneFromX: number;
  laneToX: number;
  jumping: boolean;
  jumpStartTime: number;
  ducking: boolean;
  duckStartTime: number;
  elapsed: number;
  /**
   * Direction of an in-progress combined jump+lane leap (the roof-run
   * 'lane' variant). Set when both `jumping` and `laneSwitching` start in
   * the same frame, cleared when the jump arc finishes. Keeps the cue at
   * 'jump-left' / 'jump-right' for the whole leap instead of falling back
   * to plain 'jump' once the (shorter) lane change finishes.
   */
  comboLeapDirection: 'left' | 'right' | null;
};

function clamp(v: number, min: number, max: number) {
  return v < min ? min : v > max ? max : v;
}

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function jumpOffsetY(t: number): number {
  // parabolic arc peaking at JUMP_PEAK above EYE_HEIGHT
  const peakDelta = CAMERA_JUMP_PEAK - CAMERA_EYE_HEIGHT;
  return 4 * peakDelta * t * (1 - t);
}

function duckOffsetY(t: number): number {
  // sinusoidal dip toward DUCK_HEIGHT
  const dipDelta = CAMERA_EYE_HEIGHT - CAMERA_DUCK_HEIGHT;
  return -Math.sin(Math.PI * t) * dipDelta;
}

/** Distance ahead (positive) of the camera until the next obstacle in `lane`. */
function distanceToNextObstacleInLane(
  chunks: ChunkSpec[],
  lane: Lane,
  cameraZ: number,
): { obstacle: ObstacleSpec; dist: number } | null {
  let best: ObstacleSpec | null = null;
  let bestDist = Infinity;
  for (let c = 0; c < chunks.length; c++) {
    const obs = chunks[c].obstacles;
    for (let i = 0; i < obs.length; i++) {
      const o = obs[i];
      if (o.lane !== lane) continue;
      const dist = cameraZ - o.z; // ob is ahead if more negative => dist > 0
      if (dist > 0 && dist < bestDist) {
        bestDist = dist;
        best = o;
      }
    }
  }
  return best ? { obstacle: best, dist: bestDist } : null;
}

/** Returns true if the given lane is clear for at least `distance` meters ahead. */
function laneClearAhead(
  chunks: ChunkSpec[],
  lane: Lane,
  cameraZ: number,
  distance: number,
): boolean {
  const next = distanceToNextObstacleInLane(chunks, lane, cameraZ);
  if (!next) return true;
  return next.dist > distance;
}

const ADJACENT: Record<string, Lane[]> = {
  '-1': [0],
  '0': [-1, 1],
  '1': [0],
};

const JUMP_TRIGGER = (CAMERA_FORWARD_SPEED * JUMP_DURATION) / 2 + 0.5;
const DUCK_TRIGGER = (CAMERA_FORWARD_SPEED * DUCK_DURATION) / 2 + 0.5;
const LANE_TRIGGER = CAMERA_FORWARD_SPEED * LANE_CHANGE_DURATION + 1.5;
const CUE_PREP_DISTANCE = REACT_DISTANCE;

/**
 * AutoCamera weaves between 3 lanes, jumps over barriers, and ducks under
 * overhead signs - all without user input. The camera starts in the center
 * lane and reacts to obstacles as they enter REACT_DISTANCE.
 */
export function AutoCamera({ chunksRef, paused, onCueChange }: Props) {
  const { camera } = useThree();
  const lastCueRef = useRef<ActionCue>(null);
  const stateRef = useRef<CameraState>({
    currentLane: 0,
    targetLane: 0,
    laneSwitching: false,
    laneStartTime: 0,
    laneFromX: 0,
    laneToX: 0,
    jumping: false,
    jumpStartTime: 0,
    ducking: false,
    duckStartTime: 0,
    elapsed: 0,
    comboLeapDirection: null,
  });

  useEffect(() => {
    camera.position.x = 0;
    camera.position.y = CAMERA_EYE_HEIGHT;
    stateRef.current = {
      currentLane: 0,
      targetLane: 0,
      laneSwitching: false,
      laneStartTime: 0,
      laneFromX: 0,
      laneToX: 0,
      jumping: false,
      jumpStartTime: 0,
      ducking: false,
      duckStartTime: 0,
      elapsed: 0,
      comboLeapDirection: null,
    };
    lastCueRef.current = null;
    onCueChange?.(null);
  }, [camera, onCueChange]);

  useFrame((_, dt) => {
    if (paused) {
      updateCue(null, lastCueRef, onCueChange);
      return;
    }
    const s = stateRef.current;
    s.elapsed += Math.min(dt, 0.05);
    const chunks = chunksRef.current;
    const cameraZ = camera.position.z;
    // Dynamic camera floor: 0 in normal chunks, the train roof height in
    // roof-run chunks (with smooth entry/exit ramps). Used so jump/duck
    // arcs start and land on whatever surface we're currently on.
    const baseY = cameraBaseY(chunks, cameraZ);
    const eyeY = baseY + CAMERA_EYE_HEIGHT;

    // While on or approaching a roof-run chunk, lock the player to that
    // chunk's lane. In the 'gap' variant every roof chunk is lane 0, so
    // this just keeps the player centered on the narrow trains. In the
    // 'lane' variant the lane alternates per chunk, so this is what
    // drives the sideways leap between trains in different lanes.
    //
    // When the lane change happens while the player is ALREADY on the
    // train roof (baseY high) we also trigger a jump so the camera
    // visually leaps over to the next train instead of sliding flat
    // across the gap. Initial entry from the ground (baseY ~ 0) stays
    // a plain lane slide so the player just walks up to the ladder.
    const forced = forcedLaneFor(chunks, cameraZ);
    if (
      forced !== null &&
      s.targetLane !== forced &&
      !s.laneSwitching &&
      !s.jumping &&
      !s.ducking
    ) {
      s.laneFromX = LANE_X[s.targetLane.toString() as '-1' | '0' | '1'];
      s.laneToX = LANE_X[forced.toString() as '-1' | '0' | '1'];
      s.targetLane = forced;
      s.laneStartTime = s.elapsed;
      s.laneSwitching = true;
      if (baseY > 0.5) {
        s.jumping = true;
        s.jumpStartTime = s.elapsed;
        // Tag this as a combined leap so the cue stays 'jump-left' /
        // 'jump-right' even after the (shorter) lane change finishes.
        s.comboLeapDirection = s.laneToX < s.laneFromX ? 'left' : 'right';
      }
    }

    // Decide a new action only when idle.
    const idle = !s.laneSwitching && !s.jumping && !s.ducking;
    if (idle) {
      const next = distanceToNextObstacleInLane(chunks, s.targetLane, cameraZ);
      if (next && next.dist < REACT_DISTANCE) {
        const { obstacle, dist } = next;
        switch (obstacle.kind) {
          case 'barrier': {
            // Prefer jump when close enough; if too far still, try lane change
            // only if a side lane is meaningfully clearer.
            if (dist < JUMP_TRIGGER) {
              s.jumping = true;
              s.jumpStartTime = s.elapsed;
            } else if (dist < LANE_TRIGGER + 1) {
              tryLaneChangeOrFallback(s, chunks, cameraZ, () => {
                s.jumping = true;
                s.jumpStartTime = s.elapsed;
              });
            }
            break;
          }
          case 'overhead': {
            if (dist < DUCK_TRIGGER) {
              s.ducking = true;
              s.duckStartTime = s.elapsed;
            } else if (dist < LANE_TRIGGER + 1) {
              tryLaneChangeOrFallback(s, chunks, cameraZ, () => {
                s.ducking = true;
                s.duckStartTime = s.elapsed;
              });
            }
            break;
          }
          case 'trainGap': {
            // Roof-run gap between two train groups: always a jump trigger,
            // never a lane change (the player is locked to lane 0).
            if (dist < JUMP_TRIGGER) {
              s.jumping = true;
              s.jumpStartTime = s.elapsed;
            }
            break;
          }
          case 'wall':
          default: {
            // Trains/walls are hard obstacles: never jump them. Always move
            // into a lane that is free at the train's z-slot.
            forceLaneChangeForTrain(s, chunks, cameraZ, obstacle);
            break;
          }
        }
      }
    }

    // Apply lane switch
    if (s.laneSwitching) {
      const t = clamp((s.elapsed - s.laneStartTime) / LANE_CHANGE_DURATION, 0, 1);
      const eased = easeInOutCubic(t);
      camera.position.x = s.laneFromX + (s.laneToX - s.laneFromX) * eased;
      if (t >= 1) {
        s.laneSwitching = false;
        s.currentLane = s.targetLane;
        camera.position.x = s.laneToX;
      }
    }

    // Apply jump
    if (s.jumping) {
      const t = clamp((s.elapsed - s.jumpStartTime) / JUMP_DURATION, 0, 1);
      camera.position.y = eyeY + jumpOffsetY(t);
      if (t >= 1) {
        s.jumping = false;
        camera.position.y = eyeY;
        // Combined leap (if any) ends with the jump - the cue can clear.
        s.comboLeapDirection = null;
      }
    }

    // Apply duck
    if (s.ducking) {
      const t = clamp((s.elapsed - s.duckStartTime) / DUCK_DURATION, 0, 1);
      camera.position.y = eyeY + duckOffsetY(t);
      if (t >= 1) {
        s.ducking = false;
        camera.position.y = eyeY;
      }
    }

    // Idle baseline tracking: in normal chunks baseY=0 so eyeY=CAMERA_EYE_HEIGHT
    // and this is a no-op vs. the previous behaviour. In roof-run chunks it
    // keeps the POV anchored on the train roof between jumps.
    if (!s.jumping && !s.ducking) {
      camera.position.y = eyeY;
    }

    updateCue(
      currentCue(s) ?? previewCue(s, chunks, cameraZ, baseY),
      lastCueRef,
      onCueChange,
    );
  });

  return null;
}

function currentCue(s: CameraState): ActionCue {
  // While a combined jump+lane leap (roof-run 'lane' variant) is in
  // flight, keep showing the combined cue for the WHOLE jump arc instead
  // of falling back to plain 'jump' once the shorter lane change ends.
  if (s.comboLeapDirection) {
    return s.comboLeapDirection === 'left' ? 'jump-left' : 'jump-right';
  }
  if (s.jumping) return 'jump';
  if (s.ducking) return 'duck';
  if (s.laneSwitching) return s.laneToX < s.laneFromX ? 'left' : 'right';
  return null;
}

function previewCue(
  s: CameraState,
  chunks: ChunkSpec[],
  cameraZ: number,
  baseY: number,
): ActionCue {
  // Roof-run 'lane' variant has no obstacle to react to; the forced lane
  // change drives the leap. Pre-cue the player by showing the direction
  // as soon as the next roof chunk is in look-ahead range AND its lane
  // differs from the player's current target lane. When the player is
  // already on the train roof, that forced lane change will also fire a
  // jump (see useFrame), so cue 'jump-left'/'jump-right' instead.
  const roofLane = upcomingRoofLane(chunks, cameraZ, CUE_PREP_DISTANCE);
  if (roofLane !== null && roofLane !== s.targetLane) {
    const fromX = LANE_X[s.targetLane.toString() as '-1' | '0' | '1'];
    const toX = LANE_X[roofLane.toString() as '-1' | '0' | '1'];
    const isLeft = toX < fromX;
    if (baseY > 0.5) return isLeft ? 'jump-left' : 'jump-right';
    return isLeft ? 'left' : 'right';
  }

  const next = distanceToNextObstacleInLane(chunks, s.targetLane, cameraZ);
  if (!next || next.dist >= CUE_PREP_DISTANCE) return null;

  switch (next.obstacle.kind) {
    case 'barrier':
      return next.dist < JUMP_TRIGGER
        ? 'jump'
        : previewLaneChangeOrFallback(s, chunks, cameraZ, 'jump');
    case 'overhead':
      return next.dist < DUCK_TRIGGER
        ? 'duck'
        : previewLaneChangeOrFallback(s, chunks, cameraZ, 'duck');
    case 'trainGap':
      // Lane is locked to 0 in the 'gap' variant, so always preview the jump.
      return 'jump';
    case 'wall':
    default:
      return previewTrainLaneChange(s, chunks, cameraZ, next.obstacle);
  }
}

function previewLaneChangeOrFallback(
  s: CameraState,
  chunks: ChunkSpec[],
  cameraZ: number,
  fallback: Exclude<ActionCue, null>,
): ActionCue {
  const candidates = ADJACENT[s.targetLane.toString()];
  let bestLane: Lane | null = null;
  let bestClear = 0;
  for (const ln of candidates) {
    const ahead = distanceToNextObstacleInLane(chunks, ln, cameraZ);
    const clear = ahead ? ahead.dist : Infinity;
    if (clear > bestClear) {
      bestClear = clear;
      bestLane = ln;
    }
  }
  if (bestLane !== null && bestClear > REACT_DISTANCE * 0.7) {
    return LANE_X[bestLane.toString() as '-1' | '0' | '1'] < LANE_X[s.targetLane.toString() as '-1' | '0' | '1']
      ? 'left'
      : 'right';
  }
  return fallback;
}

function previewTrainLaneChange(
  s: CameraState,
  chunks: ChunkSpec[],
  cameraZ: number,
  obstacle: ObstacleSpec,
): ActionCue {
  const laneOrder: Lane[] =
    s.targetLane === 0
      ? [-1, 1]
      : [0, s.targetLane === -1 ? 1 : -1];

  let bestLane: Lane | null = null;
  let bestClear = -Infinity;
  for (const ln of laneOrder) {
    if (laneHasObstacleAtZ(chunks, ln, obstacle.z)) continue;
    const ahead = distanceToNextObstacleInLane(chunks, ln, cameraZ);
    const clear = ahead ? ahead.dist : Infinity;
    if (clear > bestClear) {
      bestClear = clear;
      bestLane = ln;
    }
  }
  if (bestLane === null) return null;
  return LANE_X[bestLane.toString() as '-1' | '0' | '1'] < LANE_X[s.targetLane.toString() as '-1' | '0' | '1']
    ? 'left'
    : 'right';
}

function updateCue(
  cue: ActionCue,
  lastCueRef: MutableRefObject<ActionCue>,
  onCueChange?: (cue: ActionCue) => void,
) {
  if (cue === lastCueRef.current) return;
  lastCueRef.current = cue;
  onCueChange?.(cue);
}

function tryLaneChangeOrFallback(
  s: CameraState,
  chunks: ChunkSpec[],
  cameraZ: number,
  fallback: () => void,
) {
  const candidates = ADJACENT[s.targetLane.toString()];
  let bestLane: Lane | null = null;
  let bestClear = 0;
  for (const ln of candidates) {
    const ahead = distanceToNextObstacleInLane(chunks, ln, cameraZ);
    const clear = ahead ? ahead.dist : Infinity;
    if (clear > bestClear) {
      bestClear = clear;
      bestLane = ln;
    }
  }
  if (bestLane !== null && bestClear > REACT_DISTANCE * 0.7) {
    s.laneFromX = LANE_X[s.targetLane.toString() as '-1' | '0' | '1'];
    s.laneToX = LANE_X[bestLane.toString() as '-1' | '0' | '1'];
    s.targetLane = bestLane;
    s.laneStartTime = s.elapsed;
    s.laneSwitching = true;
  } else {
    fallback();
  }
}

function forceLaneChangeForTrain(
  s: CameraState,
  chunks: ChunkSpec[],
  cameraZ: number,
  obstacle: ObstacleSpec,
) {
  const laneOrder: Lane[] =
    s.targetLane === 0
      ? [-1, 1]
      : [0, s.targetLane === -1 ? 1 : -1];

  let bestLane: Lane | null = null;
  let bestClear = -Infinity;

  for (const ln of laneOrder) {
    if (laneHasObstacleAtZ(chunks, ln, obstacle.z)) continue;
    const ahead = distanceToNextObstacleInLane(chunks, ln, cameraZ);
    const clear = ahead ? ahead.dist : Infinity;
    if (clear > bestClear) {
      bestClear = clear;
      bestLane = ln;
    }
  }

  // The spawner guarantees this should be found. If it isn't, do nothing
  // rather than jumping a train, which looks wrong for this app.
  if (bestLane === null) return;

  s.laneFromX = LANE_X[s.targetLane.toString() as '-1' | '0' | '1'];
  s.laneToX = LANE_X[bestLane.toString() as '-1' | '0' | '1'];
  s.targetLane = bestLane;
  s.laneStartTime = s.elapsed;
  s.laneSwitching = true;
}

function laneHasObstacleAtZ(
  chunks: ChunkSpec[],
  lane: Lane,
  z: number,
): boolean {
  for (const chunk of chunks) {
    for (const obstacle of chunk.obstacles) {
      if (obstacle.lane === lane && Math.abs(obstacle.z - z) < 0.35) {
        return true;
      }
    }
  }
  return false;
}

// Re-export so SubwayScene can reset a single helper for tests later.
export const _testables = {
  distanceToNextObstacleInLane,
  laneClearAhead,
  laneHasObstacleAtZ,
  jumpOffsetY,
  duckOffsetY,
};
