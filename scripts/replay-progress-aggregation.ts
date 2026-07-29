import assert from 'node:assert/strict';
// @ts-expect-error -- Node type-stripping requires the source extension.
import { aggregateLifetime, aggregateWeeklyActivity, calendarWeekStart, countActions, levelFromXp, normalizeActionCounts } from '../src/lib/progressAggregation.ts';

const local = (year: number, month: number, day: number, hour = 12) =>
  new Date(year, month - 1, day, hour).getTime();

// Wednesday: compare Monday-through-Wednesday with the same elapsed prior span.
const now = local(2026, 7, 22, 18);
const runs = [
  { at: local(2026, 7, 20), calories: 100 },
  { at: local(2026, 7, 22), calories: 50 },
  { at: local(2026, 7, 13), calories: 80 },
  { at: local(2026, 7, 15), calories: 20 },
  // This prior Thursday is outside Wednesday's fair partial-week baseline.
  { at: local(2026, 7, 16), calories: 900 },
];
const week = aggregateWeeklyActivity(runs, now);
assert.equal(week.weekStart, local(2026, 7, 20, 0));
assert.deepEqual(week.dailyCalories, [100, 0, 50, 0, 0, 0, 0]);
assert.equal(week.currentCalories, 150);
assert.equal(week.comparisonCalories, 100);
assert.equal(week.changePercent, 50);
assert.equal(week.comparisonLabel, 'vs same time last week');

// A zero prior baseline is represented by null, never Infinity or NaN.
const zeroBaseline = aggregateWeeklyActivity(
  [{ at: local(2026, 7, 21), calories: 40 }],
  now,
);
assert.equal(zeroBaseline.comparisonCalories, 0);
assert.equal(zeroBaseline.changePercent, null);

// Decreases retain their negative sign.
const decrease = aggregateWeeklyActivity(
  [
    { at: local(2026, 7, 20), calories: 50 },
    { at: local(2026, 7, 13), calories: 100 },
  ],
  now,
);
assert.equal(decrease.changePercent, -50);

// Sunday belongs to the ending week; Monday starts the next local week.
assert.equal(calendarWeekStart(local(2026, 7, 26, 23)), local(2026, 7, 20, 0));
assert.equal(calendarWeekStart(local(2026, 7, 27, 0)), local(2026, 7, 27, 0));

// Legacy records preserve available totals and contribute zero obstacles.
const lifetime = aggregateLifetime([
  { durationMin: 10, calories: 90, xp: 400 },
  {
    durationMin: 5.5,
    calories: 44,
    xp: 200,
    actionCounts: { Jump: 2, Duck: 1, Left: 3, Right: 4 },
  },
]);
assert.deepEqual(lifetime, {
  calories: 134,
  minutes: 15.5,
  obstacles: 10,
  runs: 2,
  xp: 600,
});
assert.deepEqual(normalizeActionCounts({ Jump: 2, Duck: -2, Left: NaN, Right: 1.9 }), {
  Jump: 2,
  Duck: 0,
  Left: 0,
  Right: 1,
});
assert.equal(countActions({ Jump: 1, Duck: 2, Left: 3, Right: 4 }), 10);

assert.deepEqual(levelFromXp(0), {
  level: 1,
  intoLevel: 0,
  span: 500,
  toNext: 500,
  progress: 0,
});
assert.deepEqual(levelFromXp(600), {
  level: 2,
  intoLevel: 100,
  span: 500,
  toNext: 400,
  progress: 0.2,
});
assert.equal(levelFromXp(-10).level, 1);

console.log(
  'Progress replay passed: week windows, zero baseline, decrease, boundaries, legacy totals, levels, action counts',
);
