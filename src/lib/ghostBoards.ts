/**
 * Instant boards — the client half of the ghost-runner seeding.
 *
 * The server (`functions/src/seed.ts`) fills every board to
 * `GHOST_TARGET_TOTAL` / `GHOST_DAILY_TARGET` rows with ghosts from the pure,
 * deterministic generator in `shared/scoring/ghosts.ts`. Because the
 * generator is deterministic, the client can run the SAME generator with the
 * SAME inputs and render the rows a board will contain before the Firestore
 * read returns — no spinner, no empty state, and the live result swaps in
 * without anything visibly changing (same uids, handles, scores).
 *
 * Inputs that must match the server exactly (asserted by
 * `npm run test:ghosts-client-parity`):
 *   - level roster / slot order …… `CANONICAL_LEVEL_IDS` (shared)
 *   - daily level …………………………………… `dailyChallengeLevelId(dateKey, pool)` over the
 *                                       full roster (shared)
 *   - targets ……………………………………………… `GHOST_TARGET_TOTAL`, `GHOST_DAILY_TARGET` (shared)
 *   - chart density ……………………………… `chartCuesPerMin(cues, duration)` (shared) from the
 *                                       level's published chart, else `defaultCuesPerMin`
 *   - document shape …………………………… `ghostLevelEntryDoc` / `ghostDailyEntryDoc` (shared)
 *
 * What cannot match: `at` on a level board is anchored to the reconcile's
 * clock (1–14 days back), so the client's copy can differ by up to the time
 * since the last hourly run — it only affects the "Sep 1" date label, and the
 * live row replaces it. The handle can differ when a real player owns a
 * ghost's primary handle (the server appends digits); also replaced live.
 *
 * Pure: no Firebase, no AsyncStorage, no React. `instantBoards.ts` wires it
 * to the chart mirror and the board cache.
 */

import { dailyChallengeLevelId, dailyChallengePool, EVERY_LEVEL_SCORABLE } from '@shared/scoring/daily';
import { CANONICAL_LEVEL_IDS } from '@shared/scoring/levelIds';
import {
  chartCuesPerMin,
  defaultCuesPerMin,
  generateDailyGhosts,
  generateLevelGhosts,
  GHOST_DAILY_TARGET,
  GHOST_TARGET_TOTAL,
  ghostDailyEntryDoc,
  ghostLevelEntryDoc,
  ghostTarget,
  isGhostUid,
  type GhostChartRef,
} from '@shared/scoring/ghosts';
import { sortBoardRows, toEntry, type LeaderboardEntry } from '@/lib/boardEntry';

/** What the generator needs to know about a level's published chart. */
export type BoardChart = GhostChartRef & { cuesPerMin: number };

/**
 * Chart facts from a chart-mirror entry (`ChartInfo` in beatmapRegistry.ts).
 * Mirrors `loadPublishedCharts` in functions/src/seed.ts: a chart with no
 * cues or no duration is treated as absent, like the server does.
 */
export function boardChartFrom(
  chart: { beatmap: { cues: readonly unknown[]; videoDurationSec: number }; hash: string; chartVersion: number } | null | undefined,
): BoardChart | null {
  if (!chart) return null;
  const cuesPerMin = chartCuesPerMin(chart.beatmap.cues.length, chart.beatmap.videoDurationSec);
  if (cuesPerMin <= 0 || !chart.hash) return null;
  return { cuesPerMin, chartVersion: Math.max(1, Math.floor(chart.chartVersion)), hash: chart.hash };
}

/** The level id whose board is today's daily board (same pick as the server). */
export function dailyBoardLevelId(dateKey: string): string | null {
  const { pool } = dailyChallengePool(EVERY_LEVEL_SCORABLE, CANONICAL_LEVEL_IDS);
  return dailyChallengeLevelId(dateKey, pool);
}

/** Real (non-ghost) players among a set of rows. */
export function realCountOf(rows: readonly LeaderboardEntry[]): number {
  return rows.reduce((count, row) => count + (isGhostUid(row.uid) ? 0 : 1), 0);
}

/**
 * The ghost rows the server keeps on a level board when `realCount` real
 * players are on it: the `ghostTarget(realCount)` highest-scoring ghosts of
 * the fixed set, as `LeaderboardEntry` rows.
 */
export function ghostLevelRows(
  levelId: string,
  chart: BoardChart | null,
  options: { realCount?: number; now?: number; targetTotal?: number } = {},
): LeaderboardEntry[] {
  const targetTotal = options.targetTotal ?? GHOST_TARGET_TOTAL;
  const target = ghostTarget(options.realCount ?? 0, targetTotal);
  if (target === 0) return [];
  const cuesPerMin = chart?.cuesPerMin ?? defaultCuesPerMin(levelId);
  const now = options.now ?? Date.now();
  return generateLevelGhosts(levelId, targetTotal, { cuesPerMin })
    .slice(0, target)
    .map((ghost) => toEntry(ghost.uid, ghostLevelEntryDoc(levelId, ghost, cuesPerMin, chart, now)));
}

/** Same for a daily board; `chartFor` resolves the day's level to its chart. */
export function ghostDailyRows(
  dateKey: string,
  chartFor: (levelId: string) => BoardChart | null,
  options: { realCount?: number; targetTotal?: number } = {},
): LeaderboardEntry[] {
  const levelId = dailyBoardLevelId(dateKey);
  if (!levelId) return [];
  const targetTotal = options.targetTotal ?? GHOST_DAILY_TARGET;
  const target = ghostTarget(options.realCount ?? 0, targetTotal);
  if (target === 0) return [];
  const chart = chartFor(levelId);
  const cuesPerMin = chart?.cuesPerMin ?? defaultCuesPerMin(levelId);
  return generateDailyGhosts(dateKey, levelId, targetTotal, { cuesPerMin })
    .slice(0, target)
    .map((ghost) => toEntry(ghost.uid, ghostDailyEntryDoc(dateKey, levelId, ghost, cuesPerMin, chart)));
}

/**
 * Rows to show right now: the last known server rows (which already include
 * the server's ghosts) plus any deterministic ghost the server would keep
 * that the cache does not have yet. Deduped by uid — a cached/live row always
 * wins over a locally generated one — sorted like the board, capped at `max`.
 */
export function mergeBoardRows(
  known: readonly LeaderboardEntry[] | null | undefined,
  ghosts: readonly LeaderboardEntry[],
  max: number,
): LeaderboardEntry[] {
  const byUid = new Map<string, LeaderboardEntry>();
  for (const row of ghosts) byUid.set(row.uid, row);
  for (const row of known ?? []) byUid.set(row.uid, row);
  return sortBoardRows(Array.from(byUid.values())).slice(0, Math.max(0, max));
}

/**
 * Instant runner count for a level card. The server keeps every board at
 * exactly `real + ghostTarget(real) = max(TARGET, real)` rows. Given the last
 * known number of REAL players, that is the count the board will report;
 * before anything is known the board holds the full ghost set (`TARGET`).
 */
export function estimateBoardTotal(realCount: number | null | undefined, targetTotal = GHOST_TARGET_TOTAL): number {
  const real = typeof realCount === 'number' && Number.isFinite(realCount) ? Math.max(0, Math.floor(realCount)) : 0;
  return real + ghostTarget(real, targetTotal);
}
