/**
 * Subway-Surfers-style "train roof run" segment.
 *
 * The endless runner periodically replaces a stretch of ground obstacles with
 * a section where the player climbs a ladder onto a row of train roofs, runs
 * across them, leaps between them, and finally descends a second ladder back
 * to ground level. Two flavours alternate:
 *
 *   - 'gap'  variant: all chunks in the section sit in lane 0; the player
 *     jumps the visible gap between train groups via a `trainGap` obstacle.
 *   - 'lane' variant: each chunk's trains are anchored to a different lane
 *     (alternating left / center / right). The player must leap sideways
 *     between trains at every chunk boundary instead of jumping forward.
 *     No `trainGap` obstacle is spawned; the forced lane change in
 *     AutoRunner triggers the leap.
 *
 * This module holds:
 *   - constants for layout, scaling, and camera transitions
 *   - {@link roofRunForStartZ}: schedules where roof-run sections appear,
 *     including which variant and per-chunk lane
 *   - {@link trainGapObstacleSpec}: factory for the single `trainGap`
 *     obstacle placed in each `run` chunk of the 'gap' variant
 *   - {@link cameraBaseY}: dynamic camera floor (ground or roof height)
 *   - {@link forcedLaneFor}: which lane the camera must be in given its z
 *     while on/near a roof-run chunk (so the player never runs off the side
 *     of a narrow train, and so lane-variant sections drive sideways leaps)
 *
 * NONE of this affects normal chunks - all branches return ground-level
 * defaults / null when no roof-run role is present.
 */
import { CAMERA_EYE_HEIGHT, CHUNK_LENGTH } from './constants';
import type {
  ChunkSpec,
  Lane,
  ObstacleSpec,
  RoofRunRole,
  RoofRunVariant,
} from './types';

// --- Train scale, computed so the train.glb (natural bbox 0.081 x 0.021 x
// 0.032) ends up at the dimensions the spec calls for after fitWidth + scale
// + the [0, π/2, 0] Y rotation: width 1.55m (one lane), height ~1.53m, length
// ~6.45m. These values live ONLY here / in <TrainRoofRun>. Do not reuse for
// other train usages (the wall obstacle keeps its own scale).
export const TRAIN_FIT_WIDTH = 4.4;
export const ROOF_TRAIN_SCALE: [number, number, number] = [1.47, 1.34, 0.89];
export const TRAIN_LENGTH = 6.45;
export const TRAIN_WIDTH = 1.55;
export const TRAIN_HEIGHT = 1.53;

// Heights the player / camera / coins sit at while on the train roofs.
export const TRAIN_ROOF_BASE_Y = TRAIN_HEIGHT;
export const TRAIN_ROOF_CAMERA_Y = TRAIN_ROOF_BASE_Y + CAMERA_EYE_HEIGHT;
export const TRAIN_ROOF_COIN_Y = TRAIN_ROOF_BASE_Y + 0.9;

// Chunk layout (24m chunks). Three trains end-to-end = 19.35m; the remaining
// 4.65m of each chunk is used for the visible jump gap between groups.
export const TRAINS_PER_GROUP = 3;
export const ROOF_GAP_OFFSET = 4.65;

/**
 * Per-role z offsets (from chunk.startZ) of each train's CENTER. Negative
 * because chunks extend in the -z direction.
 *
 * entry / run share the same layout (3 trains starting after the front gap).
 * exit attaches the trains to the chunk's near edge so the previous run
 * chunk's last train and the exit's first train touch without a gap; the
 * leftover space at the back of the chunk holds the descent ladder.
 */
export const ROOF_TRAIN_OFFSETS: Record<RoofRunRole, [number, number, number]> = {
  entry: [-7.875, -14.325, -20.775],
  run: [-7.875, -14.325, -20.775],
  exit: [-3.225, -9.675, -16.125],
};

// Ladders are placed in the player's lane (x=0). Entry ladder leans against
// the first train's near edge; exit ladder leans against the last train's
// far edge. They're rendered by the procedural <Ladder /> component, which
// builds the ladder upright (rails along +Y) with the BASE at local
// origin, so an X rotation rotates the top around the base.
//
// Net lean angle (from vertical) we want for the propped-up ladder. ~42°
// makes a 2.05m ladder reach the train roof (1.53m) while the base sits
// ~1.37m out on the ground.
const LADDER_LEAN_FROM_VERTICAL = 0.73;
// Horizontal reach of the leaning ladder: sin(0.73) * 2.05 ≈ 1.37m.
const LADDER_HORIZONTAL_REACH = 1.37;

// Entry ladder: top rests on the first train's NEAR edge, base sits
// LADDER_HORIZONTAL_REACH toward +Z (in front of the train, toward the
// approaching player). The first entry train's near edge (chunk-local) is
// trainOffsets.entry[0] + TRAIN_LENGTH/2 = -7.875 + 3.225 = -4.65.
export const LADDER_ENTRY_OFFSET = -4.65 + LADDER_HORIZONTAL_REACH; // ≈ -3.28
// Top tilts toward -Z (into the train ahead of it). Negative X rotation
// rotates +Y toward -Z.
export const LADDER_ENTRY_X_TILT = -LADDER_LEAN_FROM_VERTICAL; // ≈ -0.73

// Exit ladder: top rests on the last train's FAR edge, base sits
// LADDER_HORIZONTAL_REACH toward -Z (past the train, where the player will
// land). The last exit train's far edge (chunk-local) is
// trainOffsets.exit[2] - TRAIN_LENGTH/2 = -16.125 - 3.225 = -19.35.
export const LADDER_EXIT_OFFSET = -19.35 - LADDER_HORIZONTAL_REACH; // ≈ -20.72
// Top tilts toward +Z (back into the train behind it).
export const LADDER_EXIT_X_TILT = LADDER_LEAN_FROM_VERTICAL; // ≈ 0.73

// Camera climb/descent envelopes (local z within the chunk). The camera
// interpolates between ground level (0) and TRAIN_ROOF_BASE_Y across these
// ranges so the POV smoothly rises/falls instead of teleporting.
export const ENTRY_CLIMB_NEAR_OFFSET = -1.5;
export const ENTRY_CLIMB_FAR_OFFSET = -4.5;
export const EXIT_DESCENT_NEAR_OFFSET = -19.0;
export const EXIT_DESCENT_FAR_OFFSET = -22.0;

// The single trainGap obstacle in each `run` chunk lives at the middle of
// the front gap zone, in the center lane.
export const TRAIN_GAP_OBSTACLE_OFFSET = -2.325;

// Section cadence. A roof-run section spans SECTION_LENGTH consecutive chunks
// (1 entry + 5 run + 1 exit) and re-appears every PERIOD chunks. START_OFFSET
// lets the first section happen a bit into the run so the player has a few
// chunks of normal gameplay first.
export const ROOF_RUN_PERIOD = 14;
export const ROOF_RUN_START_OFFSET = 7;
export const ROOF_RUN_SECTION_LENGTH = 7;

/**
 * Per-run-chunk lanes for the 'lane' variant. Index 0..4 maps to the 5 run
 * chunks (offset 1..5 within a section). All neighbouring entries differ by
 * exactly 1 lane so every transition is a single left/right leap (entry and
 * exit are always lane 0). Pattern: 0 -> 1 -> 0 -> -1 -> 0 -> 1 -> 0.
 */
export const LANE_VARIANT_RUN_LANES: readonly Lane[] = [1, 0, -1, 0, 1];

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Maps a chunk's startZ back to the integer chunk index it was created with. */
function chunkIndexFromStartZ(startZ: number): number {
  return Math.round((4 - startZ) / CHUNK_LENGTH);
}

/**
 * Returns the roof-run role / variant / lane for the chunk starting at
 * `startZ`, or undefined when that chunk should behave normally.
 *
 * Variants alternate per section: the 1st, 3rd, ... section uses 'gap', the
 * 2nd, 4th, ... uses 'lane'. Entry and exit chunks always sit in lane 0 for
 * both variants. For 'lane' variant 'run' chunks the lane comes from
 * {@link LANE_VARIANT_RUN_LANES}.
 */
export function roofRunForStartZ(
  startZ: number,
): { role: RoofRunRole; variant: RoofRunVariant; lane: Lane } | undefined {
  const chunkIndex = chunkIndexFromStartZ(startZ);
  if (chunkIndex < ROOF_RUN_START_OFFSET) return undefined;
  const sectionPos = chunkIndex - ROOF_RUN_START_OFFSET;
  const offset =
    ((sectionPos % ROOF_RUN_PERIOD) + ROOF_RUN_PERIOD) % ROOF_RUN_PERIOD;
  if (offset >= ROOF_RUN_SECTION_LENGTH) return undefined;
  const cycleIndex = Math.floor(sectionPos / ROOF_RUN_PERIOD);
  const variant: RoofRunVariant = cycleIndex % 2 === 0 ? 'gap' : 'lane';
  const role: RoofRunRole =
    offset === 0
      ? 'entry'
      : offset === ROOF_RUN_SECTION_LENGTH - 1
        ? 'exit'
        : 'run';

  let lane: Lane = 0;
  if (variant === 'lane' && role === 'run') {
    const runIdx = offset - 1; // 0..4
    lane = LANE_VARIANT_RUN_LANES[runIdx] ?? 0;
  }

  return { role, variant, lane };
}

/** Build the single trainGap obstacle that goes into a run chunk. */
export function trainGapObstacleSpec(
  startZ: number,
  seed: number,
): ObstacleSpec {
  return {
    id: `${seed}-trainGap`,
    kind: 'trainGap',
    lane: 0,
    z: startZ + TRAIN_GAP_OBSTACLE_OFFSET,
  };
}

function cameraBaseYForChunk(chunk: ChunkSpec, cameraZ: number): number {
  const role = chunk.roofRun?.role;
  if (!role) return 0;
  if (role === 'run') return TRAIN_ROOF_BASE_Y;
  // localZ: 0 at the chunk's near edge, -CHUNK_LENGTH at the far edge.
  const localZ = cameraZ - chunk.startZ;
  if (role === 'entry') {
    if (localZ >= ENTRY_CLIMB_NEAR_OFFSET) return 0;
    if (localZ <= ENTRY_CLIMB_FAR_OFFSET) return TRAIN_ROOF_BASE_Y;
    const t = clamp01(
      (ENTRY_CLIMB_NEAR_OFFSET - localZ) /
        (ENTRY_CLIMB_NEAR_OFFSET - ENTRY_CLIMB_FAR_OFFSET),
    );
    return easeInOutCubic(t) * TRAIN_ROOF_BASE_Y;
  }
  // exit
  if (localZ >= EXIT_DESCENT_NEAR_OFFSET) return TRAIN_ROOF_BASE_Y;
  if (localZ <= EXIT_DESCENT_FAR_OFFSET) return 0;
  const t = clamp01(
    (EXIT_DESCENT_NEAR_OFFSET - localZ) /
      (EXIT_DESCENT_NEAR_OFFSET - EXIT_DESCENT_FAR_OFFSET),
  );
  return (1 - easeInOutCubic(t)) * TRAIN_ROOF_BASE_Y;
}

/**
 * Current camera floor (in world Y units). Returns 0 in normal chunks and
 * the train roof height (with smooth ramps) inside roof-run chunks.
 */
export function cameraBaseY(chunks: ChunkSpec[], cameraZ: number): number {
  for (const chunk of chunks) {
    if (
      cameraZ <= chunk.startZ &&
      cameraZ >= chunk.startZ - chunk.length
    ) {
      return cameraBaseYForChunk(chunk, cameraZ);
    }
  }
  return 0;
}

/**
 * The lane the camera must be in given its current z, or null when no
 * roof-run chunk is in range. While inside a roof chunk, returns that
 * chunk's `lane`. While within `lookAhead` meters of a roof chunk, returns
 * the upcoming chunk's lane so the leap can start in time to land ON the
 * next train (rather than the gap in front of it).
 *
 * `lookAhead` defaults to 3m so that for the 'lane' variant the combined
 * jump+lane-change triggered by AutoRunner ends right on top of the next
 * chunk's first train (which starts ~4.65m past the chunk boundary in
 * 'run' chunks).
 */
export function forcedLaneFor(
  chunks: ChunkSpec[],
  cameraZ: number,
  lookAhead = 3,
): Lane | null {
  for (const chunk of chunks) {
    if (!chunk.roofRun) continue;
    const farZ = chunk.startZ - chunk.length;
    if (cameraZ <= chunk.startZ && cameraZ >= farZ) return chunk.roofRun.lane;
    if (cameraZ > chunk.startZ && cameraZ - chunk.startZ < lookAhead) {
      return chunk.roofRun.lane;
    }
  }
  return null;
}

/**
 * The lane the closest upcoming roof chunk will require (within `lookAhead`),
 * even when that chunk is still further ahead than `forcedLaneFor` cares
 * about. Used by AutoRunner to PRE-cue the player ('left' / 'right') before
 * the actual forced lane change kicks in.
 */
export function upcomingRoofLane(
  chunks: ChunkSpec[],
  cameraZ: number,
  lookAhead: number,
): Lane | null {
  let bestDist = Infinity;
  let bestLane: Lane | null = null;
  for (const chunk of chunks) {
    if (!chunk.roofRun) continue;
    const dist = cameraZ - chunk.startZ;
    if (dist > 0 && dist < lookAhead && dist < bestDist) {
      bestDist = dist;
      bestLane = chunk.roofRun.lane;
    }
  }
  return bestLane;
}
