/**
 * What a board shows the instant it opens, before Firestore answers:
 * the cached last result (`boardCache.ts`) merged with the deterministic
 * ghost set the server keeps on that board (`ghostBoards.ts`). Live data then
 * replaces it (`rememberBoard`) and the next open starts from that.
 *
 * Chart density comes from the chart mirror (`beatmapRegistry.ts`), which
 * mirrors the same `beatmaps/{levelId}` documents the reconcile reads, so the
 * generator gets the same inputs on both sides.
 */

import { getChart } from './beatmapRegistry';
import {
  dailyBoardKey,
  friendsBoardKey,
  levelBoardKey,
  peekBoard,
  peekCount,
  type CachedMe,
} from './boardCache';
import type { LeaderboardEntry } from './boardEntry';
import {
  boardChartFrom,
  estimateBoardTotal,
  ghostDailyRows,
  ghostLevelRows,
  mergeBoardRows,
  realCountOf,
  type BoardChart,
} from './ghostBoards';

export type InstantBoard = { rows: LeaderboardEntry[]; me: CachedMe | null };

function chartFor(levelId: string): BoardChart | null {
  return boardChartFrom(getChart(levelId));
}

/** Level (Global) board: cached rows + the ghosts the server would keep beside them. */
export function instantLevelBoard(levelId: string, max: number): InstantBoard {
  const cached = peekBoard(levelBoardKey(levelId));
  const ghosts = ghostLevelRows(levelId, chartFor(levelId), { realCount: realCountOf(cached?.rows ?? []) });
  return { rows: mergeBoardRows(cached?.rows, ghosts, max), me: cached?.me ?? null };
}

/** Daily board for a date key (Home preview and the Today tab). */
export function instantDailyBoard(dateKey: string, max: number): InstantBoard {
  const cached = peekBoard(dailyBoardKey(dateKey));
  const ghosts = ghostDailyRows(dateKey, chartFor, { realCount: realCountOf(cached?.rows ?? []) });
  return { rows: mergeBoardRows(cached?.rows, ghosts, max), me: cached?.me ?? null };
}

/** Friends board: cache only (no ghosts are ever followed by default). */
export function instantFriendsBoard(levelId: string, uid: string | null): InstantBoard | null {
  if (!uid) return null;
  const cached = peekBoard(friendsBoardKey(levelId, uid));
  return cached ? { rows: cached.rows, me: cached.me } : null;
}

/**
 * Runner count to show on a card before `count()` answers: the last count
 * seen, else what the board must hold given the real players the cached
 * board shows (the full ghost set when nothing is cached).
 */
export function instantRunnerCount(levelId: string): number {
  const cached = peekCount(levelId);
  if (cached !== null && cached > 0) return cached;
  return estimateBoardTotal(realCountOf(peekBoard(levelBoardKey(levelId))?.rows ?? []));
}
