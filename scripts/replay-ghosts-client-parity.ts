// @ts-nocheck -- Node replay loader imports .ts sources via strip-types + path alias.
/**
 * Client ↔ server parity for the instant boards (`src/lib/ghostBoards.ts`).
 *
 * The server reconcile (`functions/src/seed.ts`) writes the ghost set the
 * shared generator produces for `(levelId | dateKey, cuesPerMin, chart)`.
 * The client renders the same set before Firestore answers. This replay
 * composes the server's documents from the same shared helpers seed.ts
 * calls and asserts the client helper yields identical rows — uids, handles,
 * scores, combos, accuracy, chart fields, order — for fixed seeds, with and
 * without a published chart, and at several real-player counts. It also pins
 * that seed.ts actually uses those shared helpers (no private copy of the
 * density formula or chart fields can drift).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CANONICAL_LEVEL_IDS,
  dailyChallengeLevelId,
  dailyChallengePool,
  dateKeyToUtcMidnight,
  localDateKey,
} from '../shared/scoring/index.ts';
import {
  chartCuesPerMin,
  dailyBoardFingerprint,
  defaultCuesPerMin,
  generateDailyGhosts,
  generateLevelGhosts,
  GHOST_DAILY_TARGET,
  GHOST_TARGET_TOTAL,
  ghostChartFields,
  ghostEntryFields,
  ghostTarget,
  isGhostUid,
  levelBoardFingerprint,
} from '../shared/scoring/ghosts.ts';
import { toEntry } from '../src/lib/boardEntry.ts';
import {
  boardChartFrom,
  dailyBoardLevelId,
  estimateBoardTotal,
  ghostDailyRows,
  ghostLevelRows,
  mergeBoardRows,
  realCountOf,
} from '../src/lib/ghostBoards.ts';
import { getDailyChallenge } from '../src/lib/dailyRecommendations.ts';
import { modes } from '../src/lib/gameData.ts';

const NOW = Date.UTC(2026, 8, 13, 15, 30);

// ---------------------------------------------------------------------------
// The server path, composed exactly as functions/src/seed.ts does it (that
// file imports firebase-admin, so its pure core is re-stated here from the
// same shared helpers it calls).
// ---------------------------------------------------------------------------
type ServerChart = { cuesPerMin: number; chartVersion: number; hash: string } | null;

function serverLevelRows(levelId: string, chart: ServerChart, realCount: number, now: number) {
  const cuesPerMin = chart?.cuesPerMin ?? defaultCuesPerMin(levelId);
  const ghosts = generateLevelGhosts(levelId, GHOST_TARGET_TOTAL, { cuesPerMin });
  const desired = ghosts.slice(0, ghostTarget(realCount, GHOST_TARGET_TOTAL));
  const fingerprint = levelBoardFingerprint(cuesPerMin, chart);
  return desired.map((ghost) =>
    toEntry(ghost.uid, {
      ...ghostEntryFields(ghost, ghost.username, now - ghost.atOffsetMs, fingerprint),
      ...ghostChartFields(chart),
    }),
  );
}

function serverDailyRows(dateKey: string, chartFor: (levelId: string) => ServerChart, realCount: number) {
  const { pool } = dailyChallengePool(() => true, CANONICAL_LEVEL_IDS);
  const levelId = dailyChallengeLevelId(dateKey, pool);
  assert.ok(levelId, 'daily level');
  const chart = chartFor(levelId);
  const cuesPerMin = chart?.cuesPerMin ?? defaultCuesPerMin(levelId);
  const ghosts = generateDailyGhosts(dateKey, levelId, GHOST_DAILY_TARGET, { cuesPerMin });
  const desired = ghosts.slice(0, ghostTarget(realCount, GHOST_DAILY_TARGET));
  const midnight = dateKeyToUtcMidnight(dateKey);
  const fingerprint = dailyBoardFingerprint(cuesPerMin, chart, levelId);
  return {
    levelId,
    rows: desired.map((ghost) =>
      toEntry(ghost.uid, {
        ...ghostEntryFields(ghost, ghost.username, midnight + ghost.atOffsetMs, fingerprint),
        ...ghostChartFields(chart),
        levelId,
        dateKey,
      }),
    ),
  };
}

// seed.ts must be built from the shared helpers, not a private copy.
{
  const seed = readFileSync(join(process.cwd(), 'functions/src/seed.ts'), 'utf8');
  for (const helper of ['chartCuesPerMin(', 'levelBoardFingerprint(', 'dailyBoardFingerprint(', 'ghostChartFields(']) {
    assert.ok(seed.includes(helper), `functions/src/seed.ts must call the shared ${helper}) helper`);
  }
  assert.ok(!/Math\.round\(\(beatmap\.cues\.length/.test(seed), 'seed.ts must not re-implement the density formula');
  assert.ok(!/beatmapHash: 'none'/.test(seed), 'seed.ts must not re-implement the provisional chart fields');
}

// ---------------------------------------------------------------------------
// Level boards, no chart: byte-identical rows for every level in the roster.
// ---------------------------------------------------------------------------
for (const levelId of CANONICAL_LEVEL_IDS) {
  const server = serverLevelRows(levelId, null, 0, NOW);
  const client = ghostLevelRows(levelId, null, { now: NOW });
  assert.equal(client.length, GHOST_TARGET_TOTAL, `${levelId}: full ghost set when nobody real is on the board`);
  assert.deepEqual(client, server, `${levelId}: client ghost rows differ from the server documents`);
  assert.ok(client.every((row) => isGhostUid(row.uid)));
  assert.ok(client.every((row) => row.provisional && row.beatmapVersion === 0), 'no chart → provisional rows');
  for (let i = 1; i < client.length; i += 1) assert.ok(client[i - 1].score >= client[i].score, 'sorted desc');
  // Deterministic across calls.
  assert.deepEqual(ghostLevelRows(levelId, null, { now: NOW }), client);
}

// A fixed seed pins the anchor ghost: the top row is generator ghost #0's score.
{
  const top = ghostLevelRows('wild-city', null, { now: NOW })[0];
  const anchor = generateLevelGhosts('wild-city')[0];
  assert.equal(top.uid, anchor.uid);
  assert.equal(top.score, anchor.score);
  assert.equal(top.username, anchor.username);
  assert.equal(top.maxCombo, anchor.maxCombo);
  assert.equal(top.accuracy, anchor.accuracy);
  assert.equal(top.at, NOW - anchor.atOffsetMs);
}

// ---------------------------------------------------------------------------
// With a published chart: the client's chart-mirror entry yields the same
// density + chart fields the server reads from `beatmaps/{levelId}`.
// ---------------------------------------------------------------------------
{
  const mirror = {
    beatmap: { cues: Array.from({ length: 120 }, (_, i) => ({ at: i * 2.5, move: 'jump' })), videoDurationSec: 300 },
    hash: 'f00dcafe',
    chartVersion: 3,
    runCount: 12,
    source: 'consensus',
  };
  const clientChart = boardChartFrom(mirror);
  assert.deepEqual(clientChart, { cuesPerMin: 24, chartVersion: 3, hash: 'f00dcafe' });
  assert.equal(chartCuesPerMin(120, 300), 24);
  const server = serverLevelRows('neon-rails', clientChart, 0, NOW);
  const client = ghostLevelRows('neon-rails', clientChart, { now: NOW });
  assert.deepEqual(client, server, 'charted level: rows differ');
  assert.ok(client.every((row) => !row.provisional && row.beatmapVersion === 3), 'chart → verified rows');
  // Density changes the ghost set (the server rewrites; the client follows).
  assert.notDeepEqual(client.map((r) => r.score), ghostLevelRows('neon-rails', null, { now: NOW }).map((r) => r.score));
  // Degenerate mirror entries are treated as "no chart", like loadPublishedCharts.
  assert.equal(boardChartFrom({ ...mirror, beatmap: { cues: [], videoDurationSec: 300 } }), null);
  assert.equal(boardChartFrom({ ...mirror, beatmap: { cues: mirror.beatmap.cues, videoDurationSec: 0 } }), null);
  assert.equal(boardChartFrom({ ...mirror, hash: '' }), null);
  assert.equal(boardChartFrom(null), null);
}

// ---------------------------------------------------------------------------
// Phase-out: with N real players the client keeps the same top ghosts.
// ---------------------------------------------------------------------------
for (const real of [0, 1, 5, 23, 24, 40]) {
  const server = serverLevelRows('dino-escape', null, real, NOW);
  const client = ghostLevelRows('dino-escape', null, { realCount: real, now: NOW });
  assert.equal(client.length, ghostTarget(real, GHOST_TARGET_TOTAL));
  assert.deepEqual(client, server, `realCount ${real}`);
}

// ---------------------------------------------------------------------------
// Daily boards: same day → same level, same ghosts, `at` on that UTC date.
// ---------------------------------------------------------------------------
{
  const chartFor = (levelId: string): ServerChart =>
    levelId === 'pixel-kingdom' ? { cuesPerMin: 26, chartVersion: 2, hash: 'abc123' } : null;
  for (let day = 0; day < 40; day += 1) {
    const date = new Date(Date.UTC(2026, 8, 1 + day));
    const dateKey = date.toISOString().slice(0, 10);
    const server = serverDailyRows(dateKey, chartFor, 0);
    assert.equal(dailyBoardLevelId(dateKey), server.levelId, `${dateKey}: daily level differs`);
    const client = ghostDailyRows(dateKey, chartFor);
    assert.equal(client.length, GHOST_DAILY_TARGET);
    assert.deepEqual(client, server.rows, `${dateKey}: daily rows differ`);
    const midnight = dateKeyToUtcMidnight(dateKey);
    assert.ok(client.every((row) => row.at >= midnight + 8 * 3_600_000 && row.at <= midnight + 16 * 3_600_000));
  }
  // Partially filled daily board.
  assert.deepEqual(ghostDailyRows('2026-09-13', chartFor, { realCount: 4 }), serverDailyRows('2026-09-13', chartFor, 4).rows);
  assert.equal(ghostDailyRows('2026-09-13', chartFor, { realCount: 10 }).length, 0);
  assert.equal(ghostDailyRows('not-a-date', chartFor).length, GHOST_DAILY_TARGET, 'unknown key still hashes to a level');
}

// The Home "Today's challenge" card and the daily board agree on the level.
{
  for (let day = 0; day < 40; day += 1) {
    const date = new Date(2026, 8, 1 + day, 12);
    const challenge = getDailyChallenge(modes, date);
    assert.ok(challenge);
    assert.equal(dailyBoardLevelId(localDateKey(date)), challenge.mode.id, `${localDateKey(date)}: Home card vs board level`);
  }
}

// ---------------------------------------------------------------------------
// Merge: server/cached rows win by uid, real rows join, order + cap hold.
// ---------------------------------------------------------------------------
{
  const ghosts = ghostLevelRows('wild-city', null, { now: NOW });
  const real = toEntry('real_1', {
    uid: 'real_1', score: ghosts[3].score + 1, accuracy: 0.8, maxCombo: 30, at: NOW - 1000,
    recorded: true, runId: 'r1', username: 'me', photoURL: null, classKey: null, level: 4, playbackRate: 1,
    provisional: true, beatmapVersion: 0,
  });
  // The server renamed ghost #2's handle (a real player owned the primary).
  const renamed = { ...ghosts[2], username: `${ghosts[2].username}_123` };
  const merged = mergeBoardRows([real, renamed], ghosts, 50);
  assert.equal(merged.length, ghosts.length + 1);
  assert.equal(merged.find((r) => r.uid === renamed.uid)?.username, renamed.username, 'server row wins');
  assert.equal(merged.indexOf(merged.find((r) => r.uid === 'real_1')!), 3, 'real row ranks by score');
  assert.equal(new Set(merged.map((r) => r.uid)).size, merged.length, 'deduped by uid');
  for (let i = 1; i < merged.length; i += 1) assert.ok(merged[i - 1].score >= merged[i].score);
  assert.equal(mergeBoardRows(null, ghosts, 3).length, 3, 'capped');
  assert.equal(mergeBoardRows([], [], 50).length, 0);
  assert.equal(realCountOf(merged), 1);
  assert.equal(realCountOf(ghosts), 0);

  // Cached rows already holding real players shrink the ghost set the same
  // way the server does (phase-out from the bottom).
  const cached = [real, { ...real, uid: 'real_2', score: 10 }];
  const instant = mergeBoardRows(cached, ghostLevelRows('wild-city', null, { realCount: realCountOf(cached), now: NOW }), 50);
  assert.equal(instant.length, GHOST_TARGET_TOTAL, 'board stays exactly TARGET rows');
  assert.equal(instant.filter((r) => !isGhostUid(r.uid)).length, 2);
}

// Runner counts: the seeded board's size given the real players known.
assert.equal(estimateBoardTotal(null), GHOST_TARGET_TOTAL);
assert.equal(estimateBoardTotal(0), GHOST_TARGET_TOTAL);
assert.equal(estimateBoardTotal(5), GHOST_TARGET_TOTAL);
assert.equal(estimateBoardTotal(24), 24);
assert.equal(estimateBoardTotal(31), 31);
assert.equal(estimateBoardTotal(3, GHOST_DAILY_TARGET), GHOST_DAILY_TARGET);

console.log(
  `ghosts client parity OK: ${CANONICAL_LEVEL_IDS.length} level boards × ${GHOST_TARGET_TOTAL} ghosts, 40 daily boards × ${GHOST_DAILY_TARGET}, chart + phase-out + merge + counts`,
);
