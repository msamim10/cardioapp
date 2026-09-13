// @ts-nocheck -- Node replay loader imports .ts sources via strip-types + path alias.
/**
 * Replay for FEATURE 2 (leaderboards): the shared daily-challenge pick must
 * match what the client shows, for any date and any set of published
 * beatmaps, and the server's date-key plausibility window must accept every
 * legitimate local date around the world while refusing keys days away.
 */
import assert from 'node:assert/strict';
import { modes } from '../src/lib/gameData.ts';
import { getDailyChallenge } from '../src/lib/dailyRecommendations.ts';
import {
  CANONICAL_LEVEL_IDS,
  dailyChallengeLevelId,
  dailyChallengePool,
  dailyEntryExpiresAt,
  dateKeyPlausibleAt,
  dateKeyToUtcMidnight,
  isDateKey,
  localDateKey,
} from '../shared/scoring/index.ts';
import { parseChallengeLink, challengeWebUrl, challengeSchemeUrl } from '../src/lib/challengeLinks.ts';

// The canonical id list the server uses must be the client's mode order.
assert.deepEqual(
  [...CANONICAL_LEVEL_IDS],
  modes.map((mode) => mode.id),
  'shared CANONICAL_LEVEL_IDS must mirror gameData modes (same ids, same order)',
);

// ---------------------------------------------------------------------------
// Client pick === server pick for 400 consecutive days × several registries.
// ---------------------------------------------------------------------------
const registries: ((id: string) => boolean)[] = [
  () => false, // nothing published → practice pool = every level
  (id) => id === CANONICAL_LEVEL_IDS[0],
  (id) => CANONICAL_LEVEL_IDS.indexOf(id) % 2 === 0,
  () => true,
];
for (const hasBeatmap of registries) {
  const { pool, practice } = dailyChallengePool(hasBeatmap);
  for (let day = 0; day < 400; day += 1) {
    const date = new Date(2026, 0, 1 + day, 9);
    const key = localDateKey(date);
    const client = getDailyChallenge(modes, date, hasBeatmap);
    const server = dailyChallengeLevelId(key, pool);
    assert.ok(client, `client pick exists for ${key}`);
    assert.equal(client.mode.id, server, `pick differs on ${key}`);
    assert.equal(client.practice, practice);
    assert.equal(client.dateKey, key);
  }
}
// Deterministic and independent of pool order input duplicates.
assert.equal(
  dailyChallengeLevelId('2026-09-13', [...CANONICAL_LEVEL_IDS]),
  dailyChallengeLevelId('2026-09-13', dailyChallengePool(() => false, [...CANONICAL_LEVEL_IDS, ...CANONICAL_LEVEL_IDS]).pool),
);
assert.equal(dailyChallengeLevelId('2026-09-13', []), null);

// ---------------------------------------------------------------------------
// Date keys.
// ---------------------------------------------------------------------------
assert.equal(isDateKey('2026-09-13'), true);
assert.equal(isDateKey('2026-02-30'), false);
assert.equal(isDateKey('2026-9-13'), false);
assert.equal(isDateKey(20260913), false);
assert.equal(dateKeyToUtcMidnight('2026-09-13'), Date.UTC(2026, 8, 13));

{
  const key = '2026-09-13';
  const midnight = Date.UTC(2026, 8, 13);
  const H = 3_600_000;
  // Kiritimati (UTC+14) starts the 13th at 12 UTC on the 12th …
  assert.equal(dateKeyPlausibleAt(key, midnight - 14 * H), true, 'UTC+14 midnight');
  // … and Baker Island (UTC−12) ends it at 12 UTC on the 14th; plus 2 h submit slack.
  assert.equal(dateKeyPlausibleAt(key, midnight + 36 * H), true, 'UTC−12 end of day');
  assert.equal(dateKeyPlausibleAt(key, midnight + 38 * H), true, 'submit slack');
  // A New York run at 23:30 local on the 13th submits at 03:30 UTC on the 14th.
  assert.equal(dateKeyPlausibleAt(key, midnight + 27.5 * H), true, 'late-evening Americas run');
  assert.equal(dateKeyPlausibleAt(key, midnight - 15 * H), false, 'too early');
  assert.equal(dateKeyPlausibleAt(key, midnight + 39 * H), false, 'too late');
  assert.equal(dateKeyPlausibleAt('2026-09-11', midnight + 12 * H), false, 'two days ago');
  assert.equal(dateKeyPlausibleAt('nope', midnight), false);
  // TTL: swept after the whole world has left that date (+24 h grace).
  assert.equal(dailyEntryExpiresAt(key), midnight + 60 * H);
}

// ---------------------------------------------------------------------------
// Beat-my-score links: both shapes parse to the same target.
// ---------------------------------------------------------------------------
{
  const web = challengeWebUrl('neon-rails', 'run_abc-123');
  const scheme = challengeSchemeUrl('neon-rails', 'run_abc-123');
  assert.equal(web, 'https://cardiosurf.com/l/neon-rails?c=run_abc-123');
  assert.equal(scheme, 'cardiosurf://level/neon-rails?challenge=run_abc-123');
  assert.deepEqual(parseChallengeLink(web), { levelId: 'neon-rails', challengeId: 'run_abc-123' });
  assert.deepEqual(parseChallengeLink(scheme), { levelId: 'neon-rails', challengeId: 'run_abc-123' });
  assert.deepEqual(parseChallengeLink('https://www.cardiosurf.com/l/dino-escape'), { levelId: 'dino-escape', challengeId: null });
  assert.deepEqual(parseChallengeLink('cardiosurf://level/dino-escape/'), { levelId: 'dino-escape', challengeId: null });
  // Bad challenge ids are dropped, not fatal; unrelated URLs are ignored.
  assert.deepEqual(parseChallengeLink('cardiosurf://level/neon-rails?challenge=<script>'), { levelId: 'neon-rails', challengeId: null });
  assert.equal(parseChallengeLink('cardiosurf://paywall'), null);
  assert.equal(parseChallengeLink('https://evil.example/l/neon-rails?c=x'), null);
  assert.equal(parseChallengeLink('https://cardiosurf.com/l/Bad%20Id'), null);
  assert.equal(parseChallengeLink(null), null);
  assert.equal(parseChallengeLink(''), null);
}

console.log('daily-key replay OK');
