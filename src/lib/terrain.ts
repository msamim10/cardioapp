/**
 * Ground elevation profile for the City Builder run.
 *
 * The run begins at ground level inside a tunnel, climbs a straight ramp, and
 * levels off onto the elevated city. The same height function is shared by the
 * runner, camera, obstacles, coins, the guard, and the chunk visuals so
 * everything stays glued to the sloped floor.
 *
 * Coordinate note: the runner travels toward NEGATIVE z, so "further along the
 * run" means a smaller (more negative) z.
 */
import type { WorkoutSceneVariant } from './types';

/** z where the climb begins (just ahead of the spawn). */
export const RAMP_START_Z = 4;
/** z where the climb finishes and the flat city begins. */
export const RAMP_END_Z = -116;
/** Rise per meter travelled along the ramp (~6.8°). */
export const TERRAIN_SLOPE = 0.12;
/** Flat city elevation reached at the top of the ramp. */
export const CITY_LEVEL = TERRAIN_SLOPE * (RAMP_START_Z - RAMP_END_Z);
/** Tilt applied to ramp chunks so their floors form a continuous incline. */
export const RAMP_ANGLE = Math.atan(TERRAIN_SLOPE);

/** Raw ground height at a world z along the City Builder profile. */
export function groundHeightAtZ(z: number): number {
  if (z >= RAMP_START_Z) return 0;
  if (z <= RAMP_END_Z) return CITY_LEVEL;
  return TERRAIN_SLOPE * (RAMP_START_Z - z);
}

/** True while the given world z sits on the climbing ramp. */
export function isOnRamp(z: number): boolean {
  return z < RAMP_START_Z && z > RAMP_END_Z;
}

/**
 * Ground height for a scene variant. Only the City Builder scene is sloped;
 * every other variant stays flat at y = 0.
 */
export function terrainHeight(
  variant: WorkoutSceneVariant | undefined,
  z: number,
): number {
  return variant === 'city-builder' ? groundHeightAtZ(z) : 0;
}

/**
 * Pitch (radians about X) a character should adopt to stand on the slope at a
 * given z. Zero off the ramp and for non-sloped variants.
 */
export function terrainAngle(
  variant: WorkoutSceneVariant | undefined,
  z: number,
): number {
  return variant === 'city-builder' && isOnRamp(z) ? RAMP_ANGLE : 0;
}
