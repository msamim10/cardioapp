export type Lane = -1 | 0 | 1;

export type WorkoutSceneVariant = 'city-builder' | 'current';

export type ObstacleKind = 'barrier' | 'overhead' | 'wall' | 'trainGap';

export type ActionCue =
  | 'jump'
  | 'duck'
  | 'left'
  | 'right'
  /**
   * Combined leap-to-the-side cue used by the train roof-run 'lane'
   * variant, where the player is already on a train and the upcoming
   * forced lane change will fire a jump and a lane shift simultaneously.
   */
  | 'jump-left'
  | 'jump-right'
  | null;

export type RoofRunRole = 'entry' | 'run' | 'exit';

/**
 * Roof-run section flavour.
 *   - 'gap'  : original forward-jump variant. All chunks in the section sit
 *              in lane 0 and the player jumps the visible gap between train
 *              groups via a `trainGap` obstacle.
 *   - 'lane' : sideways-jump variant. Each chunk's train group is anchored
 *              to a specific lane (alternating left / center / right) so the
 *              player must leap to a DIFFERENT lane's train at every chunk
 *              boundary. No `trainGap` obstacles are spawned in this
 *              variant - the forced lane change drives the jump.
 */
export type RoofRunVariant = 'gap' | 'lane';

export type ObstacleSpec = {
  id: string;
  kind: ObstacleKind;
  lane: Lane;
  z: number;
};

export type ChunkSpec = {
  id: string;
  seed: number;
  startZ: number;
  length: number;
  obstacles: ObstacleSpec[];
  roofRun?: { role: RoofRunRole; variant: RoofRunVariant; lane: Lane };
};

/**
 * Mutable per-frame pose data the auto-runner writes and the visible
 * character reads to animate itself (no React state - 60fps friendly).
 */
export type RunnerPose = {
  /** Accumulating run-cycle phase in radians. */
  runPhase: number;
  /** 0..1 progress through the jump arc, 0 when grounded. */
  jumpT: number;
  /** 0..1 progress through the duck/roll, 0 when upright. */
  duckT: number;
  /** -1..1 lateral lean during lane changes (negative = leaning left). */
  lean: number;
};

export type GoalVibe = 'sweat' | 'streak' | 'zone' | 'compete';
export type FitnessLevel = 'beginner' | 'intermediate' | 'advanced' | 'elite';

export type Session = {
  id: string;
  startedAt: number;
  durationSec: number;
  estimatedCalories: number;
  coins?: number;
};

export type UserProfile = {
  weightKg: number;
  name?: string;
  vibe?: GoalVibe;
  level?: FitnessLevel;
  goalMinutes?: number;
  hasSeenOnboarding?: boolean;
  totalCoins?: number;
};
