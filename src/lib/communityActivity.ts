/**
 * Community activity for UI social proof — real numbers only.
 *
 * The count shown on a mode card is the number of players with a score on
 * that level's leaderboard (`count()` over `leaderboards/{id}/entries`).
 * Levels with no board yet, signed-out users, and offline devices get no
 * count rather than a fabricated one.
 */

import { useEffect, useState } from 'react';
import { fetchEntryCount } from './leaderboards';

export function formatRunnerCount(count: number): string {
  if (count < 1000) return count.toLocaleString('en-US');

  const compactCount = count / 1000;
  return `${compactCount >= 10 ? Math.round(compactCount) : compactCount.toFixed(1)}K`;
}

export type RunnerCounts = Readonly<Record<string, number>>;

/**
 * Leaderboard player counts for a set of levels. Resolves lazily; a level is
 * absent from the map until its count is known and omitted when zero, so
 * cards never show "0 runners".
 */
export function useRunnerCounts(levelIds: readonly string[], enabled: boolean): RunnerCounts {
  const [counts, setCounts] = useState<RunnerCounts>({});
  const key = levelIds.join('|');

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
        if (count !== null && count > 0) next[id] = count;
      }
      setCounts(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, key]);

  return counts;
}
