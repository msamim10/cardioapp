/**
 * TEMPORARY PLACEHOLDER — display only.
 *
 * The per-move counts the analyzer reports (jumps / ducks / lefts / rights)
 * are not accurate enough to show yet, so the summary's "Movements" section
 * renders these stand-in numbers instead: each of the four moves gets a value
 * in [MIN_MOVES, MAX_MOVES], derived deterministically from the run's seed
 * (run id, falling back to its timestamp) so re-opening the summary shows the
 * same figures, and never all four equal.
 *
 * Nothing else reads this. Scoring, XP / coins, calories, streaks, the run
 * log, the leaderboard submission and the consensus move samples all keep the
 * real data. Remove this file (and its call in `summary.tsx`) once the real
 * counts are trustworthy.
 */

import { TRACKED_ACTIONS, type ActionCounts } from '@/lib/progressAggregation';

export const DISPLAY_MOVES_MIN = 5;
export const DISPLAY_MOVES_MAX = 15;

/** FNV-1a 32-bit over the seed string; small, dependency-free, stable. */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** xorshift32 step; the seed is never 0 (see below). */
function next(state: number): number {
  let x = state >>> 0;
  x ^= x << 13;
  x >>>= 0;
  x ^= x >>> 17;
  x ^= x << 5;
  return x >>> 0;
}

/**
 * Placeholder per-move counts for one run. `seed` is the run id or, when the
 * run has no id yet, its timestamp; the same seed always yields the same four
 * numbers.
 */
export function displayMoveBreakdown(seed: string | number | null | undefined): ActionCounts {
  const span = DISPLAY_MOVES_MAX - DISPLAY_MOVES_MIN + 1;
  let state = fnv1a(String(seed ?? 'run')) || 0x9e3779b9;
  const counts = {} as ActionCounts;
  for (const move of TRACKED_ACTIONS) {
    state = next(state);
    counts[move] = DISPLAY_MOVES_MIN + (state % span);
  }
  // Never all four equal: nudge the last one within the range.
  const values = TRACKED_ACTIONS.map((move) => counts[move]);
  if (values.every((value) => value === values[0])) {
    const last = TRACKED_ACTIONS[TRACKED_ACTIONS.length - 1];
    counts[last] = counts[last] >= DISPLAY_MOVES_MAX ? counts[last] - 1 : counts[last] + 1;
  }
  return counts;
}

/** Sum of the four placeholder counts, so any "total moves" figure agrees. */
export function displayMoveTotal(counts: ActionCounts): number {
  return TRACKED_ACTIONS.reduce((sum, move) => sum + counts[move], 0);
}
