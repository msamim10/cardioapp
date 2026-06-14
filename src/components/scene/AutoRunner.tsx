import { useFrame } from '@react-three/fiber/native';
import { MutableRefObject, useEffect, useRef } from 'react';
import type * as THREE from 'three';
import {
  CAMERA_FORWARD_SPEED,
  DUCK_DURATION,
  JUMP_DURATION,
  LANE_CHANGE_DURATION,
  LANE_X,
  REACT_DISTANCE,
  RUNNER_JUMP_PEAK,
} from '@/lib/constants';
import { cameraBaseY, forcedLaneFor, upcomingRoofLane } from '@/lib/roofRun';
import { terrainAngle, terrainHeight } from '@/lib/terrain';
import type {
  ActionCue,
  ChunkSpec,
  Lane,
  ObstacleSpec,
  RunnerPose,
  WorkoutSceneVariant,
} from '@/lib/types';

type Props = {
  runnerRef: MutableRefObject<THREE.Group | null>;
  poseRef: MutableRefObject<RunnerPose>;
  chunksRef: MutableRefObject<ChunkSpec[]>;
  paused?: boolean;
  variant?: WorkoutSceneVariant;
  onCueChange?: (cue: ActionCue) => void;
};

type RunnerState = {
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

/** Parabolic jump arc for the runner's FEET, peaking at RUNNER_JUMP_PEAK. */
function jumpOffsetY(t: number): number {
  return 4 * RUNNER_JUMP_PEAK * t * (1 - t);
}

/** Distance ahead (positive) of the runner until the next obstacle in `lane`. */
function distanceToNextObstacleInLane(
  chunks: ChunkSpec[],
  lane: Lane,
  runnerZ: number,
): { obstacle: ObstacleSpec; dist: number } | null {
  let best: ObstacleSpec | null = null;
  let bestDist = Infinity;
  for (let c = 0; c < chunks.length; c++) {
    const obs = chunks[c].obstacles;
    for (let i = 0; i < obs.length; i++) {
      const o = obs[i];
      if (o.lane !== lane) continue;
      const dist = runnerZ - o.z; // ob is ahead if more negative => dist > 0
      if (dist > 0 && dist < bestDist) {
        bestDist = dist;
        best = o;
      }
    }
  }
  return best ? { obstacle: best, dist: bestDist } : null;
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

// Run-cycle stride frequency: radians of run phase per meter travelled.
const STRIDE_PHASE_PER_METER = 1.45;

/**
 * AutoRunner weaves the visible runner between 3 lanes, jumps over
 * barriers, and rolls under overhead beams - all without user input.
 * It drives the runner GROUP's transform (x = lane, y = floor + jump arc,
 * z is advanced by ForwardRunner) and writes animation intent into
 * poseRef for the RunnerCharacter to act out.
 */
export function AutoRunner({ runnerRef, poseRef, chunksRef, paused, variant, onCueChange }: Props) {
  const lastCueRef = useRef<ActionCue>(null);
  const stateRef = useRef<RunnerState>({
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
    const runner = runnerRef.current;
    if (runner) {
      runner.position.set(0, terrainHeight(variant, runner.position.z), runner.position.z);
    }
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
    poseRef.current = { runPhase: 0, jumpT: 0, duckT: 0, lean: 0 };
    lastCueRef.current = null;
    onCueChange?.(null);
  }, [runnerRef, poseRef, onCueChange, variant]);

  useFrame((_, dt) => {
    if (paused) {
      updateCue(null, lastCueRef, onCueChange);
      return;
    }
    const runner = runnerRef.current;
    if (!runner) return;
    const s = stateRef.current;
    const pose = poseRef.current;
    const clampedDt = Math.min(dt, 0.05);
    s.elapsed += clampedDt;
    const chunks = chunksRef.current;
    const runnerZ = runner.position.z;

    // Advance the run cycle with distance covered.
    pose.runPhase += CAMERA_FORWARD_SPEED * clampedDt * STRIDE_PHASE_PER_METER;

    // Dynamic floor: the sloped City Builder terrain plus the train roof
    // height in roof-run chunks (with smooth entry/exit ramps).
    const baseY = cameraBaseY(chunks, runnerZ) + terrainHeight(variant, runnerZ);

    // While on or approaching a roof-run chunk, lock the runner to that
    // chunk's lane. In the 'gap' variant every roof chunk is lane 0, so
    // this just keeps the runner centered on the narrow trains. In the
    // 'lane' variant the lane alternates per chunk, driving the sideways
    // leap between trains in different lanes.
    const forced = forcedLaneFor(chunks, runnerZ);
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
        s.comboLeapDirection = s.laneToX < s.laneFromX ? 'left' : 'right';
      }
    }

    // Decide a new action only when idle.
    const idle = !s.laneSwitching && !s.jumping && !s.ducking;
    if (idle) {
      const next = distanceToNextObstacleInLane(chunks, s.targetLane, runnerZ);
      if (next && next.dist < REACT_DISTANCE) {
        const { obstacle, dist } = next;
        switch (obstacle.kind) {
          case 'barrier': {
            if (dist < JUMP_TRIGGER) {
              s.jumping = true;
              s.jumpStartTime = s.elapsed;
            } else if (dist < LANE_TRIGGER + 1) {
              tryLaneChangeOrFallback(s, chunks, runnerZ, () => {
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
              tryLaneChangeOrFallback(s, chunks, runnerZ, () => {
                s.ducking = true;
                s.duckStartTime = s.elapsed;
              });
            }
            break;
          }
          case 'trainGap': {
            // Roof-run gap between two train groups: always a jump trigger,
            // never a lane change (the runner is locked to lane 0).
            if (dist < JUMP_TRIGGER) {
              s.jumping = true;
              s.jumpStartTime = s.elapsed;
            }
            break;
          }
          case 'wall':
          default: {
            // Trains are hard obstacles: never jump them. Always move into
            // a lane that is free at the train's z-slot.
            forceLaneChangeForTrain(s, chunks, runnerZ, obstacle);
            break;
          }
        }
      }
    }

    // Apply lane switch + lean.
    let lean = 0;
    if (s.laneSwitching) {
      const t = clamp((s.elapsed - s.laneStartTime) / LANE_CHANGE_DURATION, 0, 1);
      const eased = easeInOutCubic(t);
      runner.position.x = s.laneFromX + (s.laneToX - s.laneFromX) * eased;
      const direction = s.laneToX < s.laneFromX ? -1 : 1;
      lean = direction * Math.sin(Math.PI * t);
      if (t >= 1) {
        s.laneSwitching = false;
        s.currentLane = s.targetLane;
        runner.position.x = s.laneToX;
        lean = 0;
      }
    }
    pose.lean = lean;

    // Apply jump arc to the runner's feet.
    if (s.jumping) {
      const t = clamp((s.elapsed - s.jumpStartTime) / JUMP_DURATION, 0, 1);
      runner.position.y = baseY + jumpOffsetY(t);
      pose.jumpT = t;
      if (t >= 1) {
        s.jumping = false;
        runner.position.y = baseY;
        pose.jumpT = 0;
        s.comboLeapDirection = null;
      }
    } else {
      pose.jumpT = 0;
    }

    // Apply duck (the somersault is purely visual; feet stay grounded).
    if (s.ducking) {
      const t = clamp((s.elapsed - s.duckStartTime) / DUCK_DURATION, 0, 1);
      pose.duckT = t;
      if (t >= 1) {
        s.ducking = false;
        pose.duckT = 0;
      }
    } else {
      pose.duckT = 0;
    }

    // Idle baseline: keep the feet glued to the current floor (ground or
    // train roof ramps).
    if (!s.jumping) {
      runner.position.y = baseY;
    }

    // Pitch the runner to stand on the climbing ramp.
    runner.rotation.x = terrainAngle(variant, runnerZ);

    updateCue(
      currentCue(s) ?? previewCue(s, chunks, runnerZ, baseY),
      lastCueRef,
      onCueChange,
    );
  });

  return null;
}

function currentCue(s: RunnerState): ActionCue {
  if (s.comboLeapDirection) {
    return s.comboLeapDirection === 'left' ? 'jump-left' : 'jump-right';
  }
  if (s.jumping) return 'jump';
  if (s.ducking) return 'duck';
  if (s.laneSwitching) return s.laneToX < s.laneFromX ? 'left' : 'right';
  return null;
}

function previewCue(
  s: RunnerState,
  chunks: ChunkSpec[],
  runnerZ: number,
  baseY: number,
): ActionCue {
  // Roof-run 'lane' variant has no obstacle to react to; the forced lane
  // change drives the leap. Pre-cue the player by showing the direction
  // as soon as the next roof chunk is in look-ahead range AND its lane
  // differs from the runner's current target lane.
  const roofLane = upcomingRoofLane(chunks, runnerZ, CUE_PREP_DISTANCE);
  if (roofLane !== null && roofLane !== s.targetLane) {
    const fromX = LANE_X[s.targetLane.toString() as '-1' | '0' | '1'];
    const toX = LANE_X[roofLane.toString() as '-1' | '0' | '1'];
    const isLeft = toX < fromX;
    if (baseY > 0.5) return isLeft ? 'jump-left' : 'jump-right';
    return isLeft ? 'left' : 'right';
  }

  const next = distanceToNextObstacleInLane(chunks, s.targetLane, runnerZ);
  if (!next || next.dist >= CUE_PREP_DISTANCE) return null;

  switch (next.obstacle.kind) {
    case 'barrier':
      return next.dist < JUMP_TRIGGER
        ? 'jump'
        : previewLaneChangeOrFallback(s, chunks, runnerZ, 'jump');
    case 'overhead':
      return next.dist < DUCK_TRIGGER
        ? 'duck'
        : previewLaneChangeOrFallback(s, chunks, runnerZ, 'duck');
    case 'trainGap':
      return 'jump';
    case 'wall':
    default:
      return previewTrainLaneChange(s, chunks, runnerZ, next.obstacle);
  }
}

function previewLaneChangeOrFallback(
  s: RunnerState,
  chunks: ChunkSpec[],
  runnerZ: number,
  fallback: Exclude<ActionCue, null>,
): ActionCue {
  const candidates = ADJACENT[s.targetLane.toString()];
  let bestLane: Lane | null = null;
  let bestClear = 0;
  for (const ln of candidates) {
    const ahead = distanceToNextObstacleInLane(chunks, ln, runnerZ);
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
  s: RunnerState,
  chunks: ChunkSpec[],
  runnerZ: number,
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
    const ahead = distanceToNextObstacleInLane(chunks, ln, runnerZ);
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
  s: RunnerState,
  chunks: ChunkSpec[],
  runnerZ: number,
  fallback: () => void,
) {
  const candidates = ADJACENT[s.targetLane.toString()];
  let bestLane: Lane | null = null;
  let bestClear = 0;
  for (const ln of candidates) {
    const ahead = distanceToNextObstacleInLane(chunks, ln, runnerZ);
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
  s: RunnerState,
  chunks: ChunkSpec[],
  runnerZ: number,
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
    const ahead = distanceToNextObstacleInLane(chunks, ln, runnerZ);
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
