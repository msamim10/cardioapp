// @ts-nocheck -- Node replay loader imports .ts sources via strip-types + path alias.
/**
 * Replay for the TEMPORARY display-only move breakdown shown on the summary:
 * every value in [5, 15], deterministic per seed, never all four equal.
 */
import assert from 'node:assert/strict';
import {
  DISPLAY_MOVES_MAX,
  DISPLAY_MOVES_MIN,
  displayMoveBreakdown,
  displayMoveTotal,
} from '../src/lib/displayMoveBreakdown.ts';
import { TRACKED_ACTIONS } from '../src/lib/progressAggregation.ts';

assert.equal(DISPLAY_MOVES_MIN, 5);
assert.equal(DISPLAY_MOVES_MAX, 15);

const seeds: (string | number | null | undefined)[] = [
  'run-1',
  'run-2',
  '9f1c2b7e-3d4a-4c5e-8f6a-1b2c3d4e5f60',
  1_757_800_000_000,
  0,
  '',
  null,
  undefined,
  ...Array.from({ length: 500 }, (_, i) => `seed-${i}`),
];

for (const seed of seeds) {
  const first = displayMoveBreakdown(seed);
  const again = displayMoveBreakdown(seed);
  assert.deepEqual(first, again, `deterministic for seed ${String(seed)}`);
  assert.deepEqual(Object.keys(first).sort(), [...TRACKED_ACTIONS].sort(), 'exactly the four moves');
  for (const move of TRACKED_ACTIONS) {
    const value = first[move];
    assert.ok(Number.isInteger(value), `${move} is an integer`);
    assert.ok(value >= DISPLAY_MOVES_MIN && value <= DISPLAY_MOVES_MAX, `${move}=${value} in range`);
  }
  const values = TRACKED_ACTIONS.map((move) => first[move]);
  assert.ok(new Set(values).size > 1, `varied across the four for seed ${String(seed)}`);
  assert.equal(displayMoveTotal(first), values.reduce((a, b) => a + b, 0), 'total is the sum');
}

// Different seeds do not all collapse onto the same four numbers.
const distinct = new Set(seeds.map((seed) => JSON.stringify(displayMoveBreakdown(seed))));
assert.ok(distinct.size > seeds.length / 4, 'seeds spread across many breakdowns');

console.log('Display move breakdown replay passed: range 5–15, deterministic per seed, varied across moves, total is the sum');
