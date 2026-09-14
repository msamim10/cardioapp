// @ts-nocheck -- Node replay loader imports .ts sources via strip-types + path alias.
/**
 * Replay for Home's "Recommended for you" row: exactly five maps, the same
 * five for the same person on the same day, a different set on a different
 * day, the two most recent plays kept off the row when the roster allows,
 * and a full row even when the taste-matched pool is short.
 */
import assert from 'node:assert/strict';
import { modes, type Mode } from '../src/lib/gameData.ts';
import {
  DAILY_RECOMMENDATION_COUNT,
  discoveryClassForMode,
  getDailyDiscovery,
  pickDailyRecommendations,
  recommendationWeight,
} from '../src/lib/dailyRecommendations.ts';
import { classForMover } from '../src/lib/progression.ts';
import { localDateKey } from '../shared/scoring/index.ts';

const ids = (picked: Mode[]) => picked.map((mode) => mode.id);
const unique = (picked: Mode[]) => new Set(ids(picked)).size === picked.length;
const dayKey = (offset: number) => localDateKey(new Date(2026, 8, 1 + offset, 9));

assert.equal(DAILY_RECOMMENDATION_COUNT, 5);
assert.ok(modes.length > DAILY_RECOMMENDATION_COUNT, 'roster must be larger than the row for these checks');

const answers = { goal: 'lose', mover: 'daily', motivation: 'compete', sessionMin: null, worlds: [] } as const;

// ---------------------------------------------------------------------------
// Exactly five, no duplicates, all from the roster — for many people × days.
// ---------------------------------------------------------------------------
for (const seedKey of ['local', 'uid_a', 'uid_b', 'install_9f3']) {
  for (let day = 0; day < 120; day += 1) {
    const picked = pickDailyRecommendations({ modes, seedKey, dateKey: dayKey(day), answers });
    assert.equal(picked.length, DAILY_RECOMMENDATION_COUNT, `${seedKey} ${dayKey(day)}: exactly five`);
    assert.ok(unique(picked), `${seedKey} ${dayKey(day)}: no duplicates`);
    for (const mode of picked) assert.ok(modes.includes(mode), 'every pick is a canonical mode object');
  }
}

// ---------------------------------------------------------------------------
// Deterministic for identical inputs; independent of roster input order.
// ---------------------------------------------------------------------------
{
  const input = { modes, seedKey: 'uid_a', dateKey: '2026-09-13', answers, recentLevelIds: ['wild-city'] };
  assert.deepEqual(ids(pickDailyRecommendations(input)), ids(pickDailyRecommendations({ ...input })));
  assert.deepEqual(
    ids(pickDailyRecommendations(input)),
    ids(pickDailyRecommendations({ ...input, modes: [...modes, ...modes] })),
    'duplicate roster entries collapse to the same pick',
  );
}

// ---------------------------------------------------------------------------
// Rotation: different days and different people produce different rows.
// ---------------------------------------------------------------------------
{
  let changedDays = 0;
  for (let day = 1; day < 60; day += 1) {
    const a = ids(pickDailyRecommendations({ modes, seedKey: 'uid_a', dateKey: dayKey(day - 1), answers }));
    const b = ids(pickDailyRecommendations({ modes, seedKey: 'uid_a', dateKey: dayKey(day), answers }));
    if (a.join() !== b.join()) changedDays += 1;
  }
  assert.ok(changedDays >= 50, `row should rotate most days (changed ${changedDays}/59)`);

  const mine = ids(pickDailyRecommendations({ modes, seedKey: 'uid_a', dateKey: '2026-09-13', answers }));
  const theirs = ids(pickDailyRecommendations({ modes, seedKey: 'uid_b', dateKey: '2026-09-13', answers }));
  assert.notDeepEqual(mine, theirs, 'seed key personalises the row');
}

// ---------------------------------------------------------------------------
// Recent plays: the first two are kept off the row; the third is not special.
// ---------------------------------------------------------------------------
{
  const recent = ['dino-escape', 'neon-rails', 'wild-city'];
  for (let day = 0; day < 60; day += 1) {
    const picked = ids(pickDailyRecommendations({ modes, seedKey: 'uid_a', dateKey: dayKey(day), answers, recentLevelIds: recent }));
    assert.ok(!picked.includes('dino-escape'), `${dayKey(day)}: most recent play excluded`);
    assert.ok(!picked.includes('neon-rails'), `${dayKey(day)}: second most recent play excluded`);
    assert.equal(picked.length, DAILY_RECOMMENDATION_COUNT);
  }
  // Unknown ids are ignored rather than shrinking the row.
  const picked = pickDailyRecommendations({ modes, seedKey: 'uid_a', dateKey: '2026-09-13', recentLevelIds: ['nope', 'nada'] });
  assert.equal(picked.length, DAILY_RECOMMENDATION_COUNT);
}

// ---------------------------------------------------------------------------
// Small rosters: exclusion yields when it would leave < 5; ≤ 5 returns all.
// ---------------------------------------------------------------------------
{
  const six = modes.slice(0, 6);
  const picked = pickDailyRecommendations({ modes: six, seedKey: 'uid_a', dateKey: '2026-09-13', recentLevelIds: [six[0].id, six[1].id] });
  assert.equal(picked.length, DAILY_RECOMMENDATION_COUNT);
  assert.ok(unique(picked));
  assert.ok(!ids(picked).includes(six[0].id), 'one exclusion still fits a six-map roster');
  assert.ok(ids(picked).includes(six[1].id), 'the second exclusion yields so the row stays full');

  const five = modes.slice(0, 5);
  assert.deepEqual(
    ids(pickDailyRecommendations({ modes: five, seedKey: 'x', dateKey: '2026-09-13', recentLevelIds: [five[0].id] })),
    ids(five),
    'exactly five unique maps → all of them, exclusions ignored',
  );
  const three = modes.slice(0, 3);
  assert.deepEqual(ids(pickDailyRecommendations({ modes: three, seedKey: 'x', dateKey: '2026-09-13' })), ids(three));
  assert.deepEqual(pickDailyRecommendations({ modes: [], seedKey: 'x', dateKey: '2026-09-13' }), []);
}

// ---------------------------------------------------------------------------
// Bias: matched maps are drawn more often, never exclusively; padding fills
// the row when only a couple of maps match the answers.
// ---------------------------------------------------------------------------
{
  // Pick answers that match as few maps as possible (a rare duration + class).
  const durations = modes.map((mode) => mode.levels[0].durationMin);
  const rarest = [...new Set(durations)].sort(
    (a, b) => durations.filter((d) => d === a).length - durations.filter((d) => d === b).length,
  )[0];
  const narrow = { goal: null, mover: null, motivation: null, sessionMin: rarest, worlds: [] };
  const matched = modes.filter((mode) => recommendationWeight(mode, modes, narrow) > 1);
  assert.ok(matched.length > 0 && matched.length < DAILY_RECOMMENDATION_COUNT, 'fixture: biased pool is short');

  const hits = new Map<string, number>();
  const DAYS = 400;
  for (let day = 0; day < DAYS; day += 1) {
    const picked = pickDailyRecommendations({ modes, seedKey: 'uid_a', dateKey: dayKey(day), answers: narrow });
    assert.equal(picked.length, DAILY_RECOMMENDATION_COUNT, 'row padded to five from the roster');
    assert.ok(unique(picked));
    for (const id of ids(picked)) hits.set(id, (hits.get(id) ?? 0) + 1);
  }
  const mean = (list: Mode[]) => list.reduce((sum, mode) => sum + (hits.get(mode.id) ?? 0), 0) / list.length;
  const unmatched = modes.filter((mode) => !matched.includes(mode));
  assert.ok(mean(matched) > mean(unmatched) * 1.3, `matched maps show up more often (${mean(matched)} vs ${mean(unmatched)})`);
  assert.ok(unmatched.every((mode) => (hits.get(mode.id) ?? 0) > 0), 'no map is locked out by taste alone');
}

// Weight table: neutral = 1, class match +1.5, near duration +1, world +1, motivation +0.5.
{
  const mode = modes[0];
  const modeClass = discoveryClassForMode(mode.id, modes);
  const mover = (['couch', 'weekend', 'daily'] as const).find((m) => classForMover(m) === modeClass)!;
  assert.equal(recommendationWeight(mode, modes, null), 1);
  assert.equal(recommendationWeight(mode, modes, {}), 1);
  assert.equal(recommendationWeight(mode, modes, { mover }), 2.5);
  assert.equal(recommendationWeight(mode, modes, { sessionMin: mode.levels[0].durationMin }), 2);
  assert.equal(recommendationWeight(mode, modes, { sessionMin: mode.levels[0].durationMin + 2 }), 1.5);
  assert.equal(recommendationWeight(mode, modes, { sessionMin: mode.levels[0].durationMin + 3 }), 1);
  assert.equal(recommendationWeight(mode, modes, { worlds: [mode.id] }), 2);
  assert.equal(
    recommendationWeight(mode, modes, { motivation: modeClass === 'hard' ? 'compete' : modeClass === 'beginner' ? 'chill' : 'streaks' }),
    modeClass === 'intermediate' ? 1 : 1.5,
  );
}

// The Levels-screen rotation still works alongside the new count.
assert.ok(getDailyDiscovery(modes, new Date(2026, 8, 13)).featured);
assert.equal(getDailyDiscovery(modes, new Date(2026, 8, 13)).recommendations.length, DAILY_RECOMMENDATION_COUNT);

console.log('recommendations replay OK');
