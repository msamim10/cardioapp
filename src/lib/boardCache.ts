/**
 * Last-fetched leaderboard snapshots, persisted so a board opens with real
 * rows instantly on the next launch and refreshes in the background.
 *
 * One AsyncStorage blob (`@cardiosurf/boards/v1`) holding every board keyed
 * by `level:<id>` / `daily:<dateKey>` / `friends:<id>:<uid>` plus the last
 * `count()` per level. Hydrated once at launch (`hydrateBoardCache`, called
 * from `_layout.tsx`); reads are synchronous from the in-memory mirror so a
 * screen's initial render can use them; writes persist debounced.
 *
 * Entries older than `BOARD_CACHE_TTL_MS` (24 h) are ignored on read and
 * pruned on write. The cache is only ever a starting point: live Firestore
 * data replaces it as soon as it arrives.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { sortBoardRows, toEntry, type LeaderboardEntry } from './boardEntry';

export const BOARD_CACHE_KEY = '@cardiosurf/boards/v1';
export const BOARD_CACHE_TTL_MS = 24 * 3_600_000;
/** Rows kept per board (the page size of the full board screen). */
export const BOARD_CACHE_MAX_ROWS = 50;

export type CachedMe = { entry: LeaderboardEntry; rank: number };

export type CachedBoard = {
  fetchedAt: number;
  rows: LeaderboardEntry[];
  me: CachedMe | null;
};

type CachedCount = { fetchedAt: number; count: number };

type CacheFile = {
  boards: Record<string, CachedBoard>;
  counts: Record<string, CachedCount>;
};

export const levelBoardKey = (levelId: string): string => `level:${levelId}`;
export const dailyBoardKey = (dateKey: string): string => `daily:${dateKey}`;
export const friendsBoardKey = (levelId: string, uid: string): string => `friends:${levelId}:${uid}`;

const boards = new Map<string, CachedBoard>();
const counts = new Map<string, CachedCount>();
let hydrated: Promise<void> | null = null;
let version = 0;
const listeners = new Set<() => void>();
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function notify(): void {
  version += 1;
  listeners.forEach((listener) => listener());
}

function fresh(fetchedAt: number, now: number): boolean {
  return Number.isFinite(fetchedAt) && now - fetchedAt >= 0 && now - fetchedAt <= BOARD_CACHE_TTL_MS;
}

function parseBoard(value: unknown): CachedBoard | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<CachedBoard>;
  if (typeof raw.fetchedAt !== 'number' || !Array.isArray(raw.rows)) return null;
  const rows = (raw.rows as unknown[])
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object')
    .map((row) => toEntry(typeof row.uid === 'string' ? row.uid : '', row))
    .filter((row) => row.uid.length > 0)
    .slice(0, BOARD_CACHE_MAX_ROWS);
  const me =
    raw.me && typeof raw.me === 'object' && raw.me.entry && typeof raw.me.entry === 'object'
      ? {
          entry: toEntry(String((raw.me.entry as { uid?: unknown }).uid ?? ''), raw.me.entry as Record<string, unknown>),
          rank: typeof raw.me.rank === 'number' && raw.me.rank > 0 ? Math.floor(raw.me.rank) : 0,
        }
      : null;
  return { fetchedAt: raw.fetchedAt, rows, me: me && me.entry.uid ? me : null };
}

/** Load the persisted cache once. Safe to call repeatedly. */
export function hydrateBoardCache(): Promise<void> {
  if (hydrated) return hydrated;
  hydrated = (async () => {
    try {
      const raw = await AsyncStorage.getItem(BOARD_CACHE_KEY);
      if (!raw) return;
      const file = JSON.parse(raw) as Partial<CacheFile>;
      const now = Date.now();
      for (const [key, value] of Object.entries(file.boards ?? {})) {
        const board = parseBoard(value);
        // A board fetched live during this session must not be shadowed.
        if (!board || !fresh(board.fetchedAt, now)) continue;
        const current = boards.get(key);
        if (current && current.fetchedAt >= board.fetchedAt) continue;
        boards.set(key, board);
      }
      for (const [levelId, value] of Object.entries(file.counts ?? {})) {
        if (!value || typeof value !== 'object') continue;
        const { fetchedAt, count } = value as Partial<CachedCount>;
        if (typeof fetchedAt !== 'number' || typeof count !== 'number' || !fresh(fetchedAt, now)) continue;
        const current = counts.get(levelId);
        if (current && current.fetchedAt >= fetchedAt) continue;
        counts.set(levelId, { fetchedAt, count: Math.max(0, Math.floor(count)) });
      }
      notify();
    } catch {
      // Corrupt cache: start empty; the next write replaces it.
    }
  })();
  return hydrated;
}

function schedulePersist(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void persist();
  }, 400);
}

async function persist(): Promise<void> {
  const now = Date.now();
  const file: CacheFile = { boards: {}, counts: {} };
  for (const [key, board] of boards) if (fresh(board.fetchedAt, now)) file.boards[key] = board;
  for (const [levelId, count] of counts) if (fresh(count.fetchedAt, now)) file.counts[levelId] = count;
  try {
    await AsyncStorage.setItem(BOARD_CACHE_KEY, JSON.stringify(file));
  } catch {
    // Cache only.
  }
}

/** Synchronous read of a board fetched within the TTL, or null. */
export function peekBoard(key: string, now = Date.now()): CachedBoard | null {
  const board = boards.get(key);
  return board && fresh(board.fetchedAt, now) ? board : null;
}

/**
 * Store the result of a live read. A `partial` read (the Home preview's top
 * 3) is layered over the cached rows instead of replacing them, so a full
 * page cached earlier is not truncated to three rows.
 */
export function rememberBoard(
  key: string,
  rows: readonly LeaderboardEntry[],
  me: CachedMe | null,
  options: { partial?: boolean; now?: number } = {},
): void {
  const now = options.now ?? Date.now();
  let next: LeaderboardEntry[] = rows.slice(0, BOARD_CACHE_MAX_ROWS);
  if (options.partial) {
    const previous = boards.get(key);
    if (previous && fresh(previous.fetchedAt, now)) {
      const byUid = new Map(previous.rows.map((row) => [row.uid, row] as const));
      for (const row of rows) byUid.set(row.uid, row);
      next = sortBoardRows(Array.from(byUid.values())).slice(0, BOARD_CACHE_MAX_ROWS);
    }
  }
  boards.set(key, { fetchedAt: now, rows: next, me });
  notify();
  schedulePersist();
}

/** Synchronous read of the last `count()` for a level, or null. */
export function peekCount(levelId: string, now = Date.now()): number | null {
  const entry = counts.get(levelId);
  return entry && fresh(entry.fetchedAt, now) ? entry.count : null;
}

export function rememberCount(levelId: string, count: number, now = Date.now()): void {
  counts.set(levelId, { fetchedAt: now, count: Math.max(0, Math.floor(count)) });
  notify();
  schedulePersist();
}

export function subscribeBoardCache(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Re-render when the cache changes (hydration landing, a live read stored). */
export function useBoardCacheVersion(): number {
  const [current, setCurrent] = useState(version);
  useEffect(() => subscribeBoardCache(() => setCurrent(version)), []);
  return current;
}

/** Test / sign-out hook: forget everything in memory (does not touch storage). */
export function resetBoardCacheForTests(): void {
  boards.clear();
  counts.clear();
  hydrated = null;
  notify();
}
