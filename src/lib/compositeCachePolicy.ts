/**
 * LRU policy for the on-device composite game assets (pure; the file I/O is
 * in `compositeAssetCache.ts`). One entry per level; the `CACHE_CAPACITY`
 * most recently used levels stay, the rest are evicted.
 */

export const CACHE_CAPACITY = 3;

export type CacheEntry = { levelId: string; lastUsedAt: number; bytes: number };

export type CacheIndex = { version: 1; entries: CacheEntry[] };

export const EMPTY_INDEX: CacheIndex = { version: 1, entries: [] };

export function parseCacheIndex(json: string | null): CacheIndex {
  if (!json) return { ...EMPTY_INDEX, entries: [] };
  try {
    const raw = JSON.parse(json) as Partial<CacheIndex>;
    if (raw.version !== 1 || !Array.isArray(raw.entries)) return { version: 1, entries: [] };
    const entries = raw.entries
      .filter(
        (e): e is CacheEntry =>
          !!e &&
          typeof e.levelId === 'string' &&
          e.levelId.length > 0 &&
          typeof e.lastUsedAt === 'number' &&
          Number.isFinite(e.lastUsedAt),
      )
      .map((e) => ({ levelId: e.levelId, lastUsedAt: e.lastUsedAt, bytes: Number.isFinite(e.bytes) ? e.bytes : 0 }));
    return { version: 1, entries: dedupe(entries) };
  } catch {
    return { version: 1, entries: [] };
  }
}

function dedupe(entries: CacheEntry[]): CacheEntry[] {
  const byId = new Map<string, CacheEntry>();
  for (const entry of entries) {
    const prev = byId.get(entry.levelId);
    if (!prev || entry.lastUsedAt > prev.lastUsedAt) byId.set(entry.levelId, entry);
  }
  return [...byId.values()];
}

/** Most recently used first. */
export function sortedEntries(index: CacheIndex): CacheEntry[] {
  return index.entries.slice().sort((a, b) => b.lastUsedAt - a.lastUsedAt);
}

/**
 * Record a use (download or read) of `levelId` and return the new index plus
 * the level ids that fell out of the `capacity` most recent.
 */
export function touchEntry(
  index: CacheIndex,
  levelId: string,
  now: number,
  bytes: number | null = null,
  capacity = CACHE_CAPACITY,
): { index: CacheIndex; evicted: string[] } {
  const existing = index.entries.find((e) => e.levelId === levelId);
  const entry: CacheEntry = {
    levelId,
    lastUsedAt: now,
    bytes: bytes ?? existing?.bytes ?? 0,
  };
  const kept = index.entries.filter((e) => e.levelId !== levelId);
  const sorted = [entry, ...kept].sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  const surviving = sorted.slice(0, Math.max(1, capacity));
  const evicted = sorted.slice(Math.max(1, capacity)).map((e) => e.levelId);
  return { index: { version: 1, entries: surviving }, evicted };
}

export function removeEntry(index: CacheIndex, levelId: string): CacheIndex {
  return { version: 1, entries: index.entries.filter((e) => e.levelId !== levelId) };
}

export function hasEntry(index: CacheIndex, levelId: string): boolean {
  return index.entries.some((e) => e.levelId === levelId);
}
