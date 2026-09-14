// @ts-nocheck -- Node replay loader imports .ts sources via strip-types + path alias.
/**
 * Replay for ghost runners (launch seeding, `shared/scoring/ghosts.ts`):
 * the generator must be deterministic, every handle must pass the real
 * username rules and be unique across all boards, scores must be internally
 * consistent (replayed through the shared combo rules) and capped so a decent
 * real player takes #1 within a few tries, and the reconcile arithmetic must
 * phase ghosts out from the bottom. No Firebase involved.
 */
import assert from 'node:assert/strict';
import { modes } from '../src/lib/gameData.ts';
import { LEVEL_REWARDS } from '../src/lib/levels.ts';
import { isHudThemeId } from '../src/lib/hudThemes.ts';
import { CANONICAL_LEVEL_IDS, checkUsernameClaim, replayJudgements } from '../shared/scoring/index.ts';
import {
  activeDailyKeys,
  DECENT_PLAYER,
  defaultCuesPerMin,
  generateDailyGhosts,
  generateLevelGhosts,
  GHOST_BADGES,
  GHOST_DAILY_TARGET,
  GHOST_HUD_THEMES,
  GHOST_LEVEL_MAX,
  GHOST_LEVEL_MIN,
  GHOST_TARGET_TOTAL,
  ghostDailyHandle,
  ghostDailyUid,
  ghostEntryFields,
  ghostGenFingerprint,
  ghostHandleCandidates,
  ghostHandlePool,
  ghostLevelHandle,
  ghostLevelUid,
  ghostProfileFields,
  ghostScoreCap,
  ghostTarget,
  isGhostUid,
  seededRandom,
  simulateRun,
  staleDailyKeys,
} from '../shared/scoring/ghosts.ts';

// ---------------------------------------------------------------------------
// Badge / theme ids used for ghost profiles must be real ones.
// ---------------------------------------------------------------------------
const realBadgeIds = new Set(
  Object.values(LEVEL_REWARDS).flatMap((reward) => (reward.badge ? [reward.badge.id] : [])),
);
for (const badge of GHOST_BADGES) {
  assert.ok(realBadgeIds.has(badge.id), `ghost badge ${badge.id} is not a real badge id`);
  assert.equal(LEVEL_REWARDS[badge.level]?.badge?.id, badge.id, `badge ${badge.id} unlock level`);
}
for (const theme of GHOST_HUD_THEMES) {
  assert.ok(isHudThemeId(theme.id), `ghost HUD theme ${theme.id} is not a real theme id`);
  if (theme.level > 1) assert.equal(LEVEL_REWARDS[theme.level]?.hudThemeId, theme.id, `theme ${theme.id} unlock level`);
}
assert.equal(modes.length, 13, 'this replay assumes the 13-level roster');

// ---------------------------------------------------------------------------
// Handle pool: valid, reserved-free, unique; slots never collide.
// ---------------------------------------------------------------------------
const pool = ghostHandlePool();
assert.ok(pool.length >= 1_000, `handle pool too small: ${pool.length}`);
assert.equal(new Set(pool).size, pool.length, 'handle pool has duplicates');
for (const handle of pool) {
  const claim = checkUsernameClaim(handle);
  assert.ok(claim.ok, `pool handle ${handle} fails username rules: ${claim.ok ? '' : claim.reason}`);
  assert.equal(claim.handle, handle, 'pool handle must already be normalized');
  assert.ok(!/^runner-/.test(handle), 'must not mimic the client fallback handle');
}

const allHandles = new Map<string, string>();
const claimHandle = (handle: string, owner: string) => {
  const previous = allHandles.get(handle);
  assert.equal(previous, undefined, `handle ${handle} used by both ${previous} and ${owner}`);
  allHandles.set(handle, owner);
};
for (const levelId of CANONICAL_LEVEL_IDS) {
  for (let n = 0; n < 32; n += 1) claimHandle(ghostLevelHandle(levelId, n), ghostLevelUid(levelId, n));
}
// 40 consecutive days of daily ghosts must not collide with each other or with levels.
for (let day = 0; day < 40; day += 1) {
  const date = new Date(Date.UTC(2026, 8, 1 + day));
  const key = date.toISOString().slice(0, 10);
  for (let n = 0; n < 16; n += 1) claimHandle(ghostDailyHandle(key, n), ghostDailyUid(key, n));
}

// Fallback candidates: valid, unique, and never another ghost's primary.
for (const levelId of CANONICAL_LEVEL_IDS) {
  const primary = ghostLevelHandle(levelId, 0);
  const candidates = ghostHandleCandidates(primary, `seed:${levelId}`);
  assert.equal(candidates[0], primary);
  assert.ok(candidates.length >= 3, 'need fallbacks');
  assert.equal(new Set(candidates).size, candidates.length);
  for (const candidate of candidates.slice(1)) {
    assert.ok(checkUsernameClaim(candidate).ok, `fallback ${candidate} invalid`);
    assert.ok(!allHandles.has(candidate), `fallback ${candidate} collides with a primary`);
  }
}

// ---------------------------------------------------------------------------
// Score model: consistent with the shared grading, capped, plausible.
// ---------------------------------------------------------------------------
{
  // simulateRun reproduces replayJudgements semantics (perfect-only run = full combo curve).
  const perfect = simulateRun(seededRandom('x'), 20, { hitProbability: 1, perfectShare: 1, spuriousRate: 0 });
  const expected = replayJudgements(
    Array.from({ length: 20 }, (_, i) => ({ i, l: 0, g: 'p', d: 0, t: i })),
  );
  assert.equal(perfect.score, expected.score);
  assert.equal(perfect.maxCombo, 20);
  assert.equal(perfect.accuracy, 1);
}

const uidSeen = new Set<string>();
for (const levelId of CANONICAL_LEVEL_IDS) {
  const cuesPerMin = defaultCuesPerMin(levelId);
  assert.ok(cuesPerMin >= 20 && cuesPerMin <= 30, 'default density 20–30/min');
  const cap = ghostScoreCap(levelId, cuesPerMin);
  assert.ok(cap > 1_000, `cap implausibly low for ${levelId}: ${cap}`);

  const ghosts = generateLevelGhosts(levelId);
  assert.equal(ghosts.length, GHOST_TARGET_TOTAL);
  // Deterministic.
  assert.deepEqual(generateLevelGhosts(levelId), ghosts, `generator not deterministic for ${levelId}`);
  // Sorted by score DESC so `.slice(0, target)` keeps the strongest.
  for (let i = 1; i < ghosts.length; i += 1) assert.ok(ghosts[i - 1].score >= ghosts[i].score, 'sorted desc');

  for (const [n, ghost] of ghosts.entries()) {
    assert.ok(isGhostUid(ghost.uid));
    assert.ok(!uidSeen.has(ghost.uid), `duplicate uid ${ghost.uid}`);
    uidSeen.add(ghost.uid);
    assert.equal(ghost.handleCandidates[0], ghost.username);
    assert.ok(checkUsernameClaim(ghost.username).ok);
    assert.ok(ghost.score <= cap, `${ghost.uid} ${ghost.score} exceeds cap ${cap}`);
    assert.ok(ghost.score > 0);
    assert.ok(ghost.accuracy >= 0.55 && ghost.accuracy <= 0.9, `${ghost.uid} accuracy ${ghost.accuracy}`);
    assert.ok(Number.isInteger(ghost.maxCombo) && ghost.maxCombo >= 1);
    // A combo of k perfects alone is worth at most 170 × k; the score must cover the combo.
    assert.ok(ghost.score >= ghost.maxCombo * 50, 'maxCombo inconsistent with score');
    assert.ok([0.85, 1, 1.2].includes(ghost.playbackRate));
    assert.ok([300, 600].includes(ghost.targetSeconds));
    assert.ok(ghost.elapsedSeconds >= ghost.targetSeconds && ghost.elapsedSeconds <= ghost.targetSeconds + 5);
    assert.ok(ghost.level >= GHOST_LEVEL_MIN && ghost.level <= GHOST_LEVEL_MAX);
    assert.deepEqual(
      ghost.badges,
      GHOST_BADGES.filter((b) => b.level <= ghost.level).map((b) => b.id),
      'badges must match the profile level',
    );
    assert.ok(GHOST_HUD_THEMES.some((t) => t.id === ghost.hudTheme && t.level <= ghost.level), 'theme unlocked');
    const days = ghost.atOffsetMs / 86_400_000;
    assert.ok(days >= 1 && days <= 14, `at offset ${days} days`);
    assert.ok(n < GHOST_TARGET_TOTAL);
  }
  // Not all bunched at the cap: the spread should be meaningful.
  assert.ok(ghosts[0].score - ghosts[ghosts.length - 1].score > cap * 0.2, `scores too bunched on ${levelId}`);

  // A decent real player beats the top ghost within a few 5-minute tries.
  const rng = seededRandom(`real:${levelId}`);
  let wins = 0;
  for (let i = 0; i < 300; i += 1) {
    if (simulateRun(rng, Math.round(cuesPerMin * 5), DECENT_PLAYER).score > ghosts[0].score) wins += 1;
  }
  const winRate = wins / 300;
  assert.ok(winRate >= 0.25 && winRate <= 0.5, `decent player beats top ghost ${Math.round(winRate * 100)}% on ${levelId}`);
}

// Reading the real chart density changes the fingerprint (forces a rewrite) but stays capped.
{
  const dense = generateLevelGhosts('neon-rails', GHOST_TARGET_TOTAL, { cuesPerMin: 40 });
  const cap = ghostScoreCap('neon-rails', 40);
  assert.ok(dense.every((g) => g.score <= cap));
  assert.notEqual(ghostGenFingerprint(40), ghostGenFingerprint(defaultCuesPerMin('neon-rails')));
}

// ---------------------------------------------------------------------------
// Daily ghosts.
// ---------------------------------------------------------------------------
{
  const daily = generateDailyGhosts('2026-09-13', 'dino-escape');
  assert.equal(daily.length, GHOST_DAILY_TARGET);
  assert.deepEqual(generateDailyGhosts('2026-09-13', 'dino-escape'), daily);
  for (const ghost of daily) {
    assert.ok(ghost.uid.startsWith('ghost_d_2026-09-13_'));
    assert.ok(!uidSeen.has(ghost.uid));
    const hours = ghost.atOffsetMs / 3_600_000;
    assert.ok(hours >= 8 && hours <= 16, 'daily `at` sits mid-day UTC');
    assert.ok(ghost.score <= ghostScoreCap('dino-escape', defaultCuesPerMin('dino-escape')));
  }
  const other = generateDailyGhosts('2026-09-14', 'dino-escape');
  assert.notDeepEqual(other.map((g) => g.score), daily.map((g) => g.score), 'days differ');
}

// Which days to seed / sweep, around the UTC day boundary.
{
  const H = 3_600_000;
  const midnight = Date.UTC(2026, 8, 13);
  assert.deepEqual(activeDailyKeys(midnight + 1 * H), ['2026-09-12', '2026-09-13', '2026-09-14']);
  assert.deepEqual(activeDailyKeys(midnight + 12 * H), ['2026-09-12', '2026-09-13', '2026-09-14'], 'UTC−12 still on the 12th');
  assert.deepEqual(activeDailyKeys(midnight + 13 * H), ['2026-09-13', '2026-09-14']);
  assert.deepEqual(staleDailyKeys(midnight + 5 * H), ['2026-09-11', '2026-09-10']);
}

// ---------------------------------------------------------------------------
// Reconcile arithmetic and document shape.
// ---------------------------------------------------------------------------
assert.equal(ghostTarget(0, 24), 24);
assert.equal(ghostTarget(5, 24), 19);
assert.equal(ghostTarget(24, 24), 0);
assert.equal(ghostTarget(999, 24), 0);
assert.equal(ghostTarget(3, 0), 0, 'TARGET_TOTAL = 0 turns seeding off');
assert.equal(ghostTarget(-1, 10), 10);

{
  const ghosts = generateLevelGhosts('wild-city');
  const now = Date.UTC(2026, 8, 13, 12);
  const fingerprint = ghostGenFingerprint(defaultCuesPerMin('wild-city'));
  const entry = ghostEntryFields(ghosts[0], ghosts[0].username, now - ghosts[0].atOffsetMs, fingerprint);
  // Same keys as `entryDoc` in functions/src/index.ts, plus the ghost marker.
  assert.deepEqual(
    Object.keys(entry).sort(),
    [
      'accuracy', 'at', 'classKey', 'elapsedSeconds', 'ghost', 'ghostGen', 'level', 'maxCombo', 'photoURL',
      'playbackRate', 'recorded', 'runId', 'score', 'uid', 'username',
    ],
  );
  assert.equal(entry.ghost, true);
  assert.equal(entry.photoURL, null);
  assert.ok((entry.at as number) < now);
  const profile = ghostProfileFields(ghosts[0], ghosts[0].username);
  assert.deepEqual(Object.keys(profile).sort(), ['badges', 'ghost', 'hudTheme', 'level', 'photoURL', 'username']);
  // Phase-out keeps the strongest ghosts: target 20 of 24 drops the 4 lowest.
  const kept = new Set(ghosts.slice(0, ghostTarget(4, GHOST_TARGET_TOTAL)).map((g) => g.uid));
  const dropped = ghosts.filter((g) => !kept.has(g.uid));
  assert.equal(dropped.length, 4);
  assert.ok(dropped.every((g) => g.score <= Math.min(...ghosts.filter((k) => kept.has(k.uid)).map((k) => k.score))));
}

console.log('ghosts replay OK');
