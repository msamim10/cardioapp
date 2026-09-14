/**
 * Community activity for UI social proof.
 *
 * The count shown on a mode card is the number of players with a score on
 * that level's leaderboard (`count()` over `leaderboards/{id}/entries`). It
 * renders instantly: first the last count seen (24 h board cache), else what
 * the seeded board must hold right now (`instantRunnerCount`), and the live
 * `count()` replaces it when it arrives. Signed-out users and levels the
 * server has no board for still get the instant value — the server keeps
 * every board at `max(GHOST_TARGET_TOTAL, real)` rows, so it is what the
 * count would return.
 */

import { useEffect, useMemo, useState } from 'react';
import { rememberCount, useBoardCacheVersion } from './boardCache';
import { instantRunnerCount } from './instantBoards';
import { fetchEntryCount } from './leaderboards';

export function formatRunnerCount(count: number): string {
  if (count < 1000) return count.toLocaleString('en-US');

  const compactCount = count / 1000;
  return `${compactCount >= 10 ? Math.round(compactCount) : compactCount.toFixed(1)}K`;
}

export type RunnerCounts = Readonly<Record<string, number>>;

/**
 * Leaderboard player counts for a set of levels. Every level has a value from
 * the first render (instant estimate); `enabled` gates the live refresh. A
 * live count of zero is kept only when the estimate was also zero (seeding
 * off), so cards never flash "0 runners" on a transient failure.
 */
export function useRunnerCounts(levelIds: readonly string[], enabled: boolean): RunnerCounts {
  const key = levelIds.join('|');
  const cacheVersion = useBoardCacheVersion();
  const instant = useMemo<RunnerCounts>(() => {
    const next: Record<string, number> = {};
    for (const id of key ? key.split('|') : []) {
      const estimate = instantRunnerCount(id);
      if (estimate > 0) next[id] = estimate;
    }
    return next;
    // cacheVersion: recompute once hydration or a fresh count lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheVersion, key]);
  const [live, setLive] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!enabled || !key) return undefined;
    let cancelled = false;
    (async () => {
      const results = await Promise.all(
        key.split('|').map(async (id) => [id, await fetchEntryCount(id)] as const),
      );
      if (cancelled) return;
      const next: Record<string, number> = {};
      for (const [id, count] of results) {
        if (count === null || count <= 0) continue;
        next[id] = count;
        rememberCount(id, count);
      }
      setLive(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, key]);

  return useMemo(() => ({ ...instant, ...live }), [instant, live]);
}
