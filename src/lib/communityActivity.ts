/**
 * Placeholder community activity for UI social proof.
 *
 * Counts are simulated until backend analytics are available. Featured
 * overrides keep curated Home values intentional, while the hash fallback
 * provides a stable, modest count for any canonical level ID.
 */
const FEATURED_SIMULATED_RUNNER_COUNTS: Readonly<Record<string, number>> = {
  'neon-rails': 286,
  'prison-escape-run': 174,
  'dino-escape': 121,
};

const MIN_SIMULATED_RUNNERS = 80;
const SIMULATED_RUNNER_SPAN = 271; // Inclusive range: 80–350.

export function getSimulatedRunnerCount(levelId: string): number {
  const featuredCount = FEATURED_SIMULATED_RUNNER_COUNTS[levelId];
  if (featuredCount !== undefined) return featuredCount;

  let hash = 0;
  for (let index = 0; index < levelId.length; index += 1) {
    hash = (hash * 31 + levelId.charCodeAt(index)) >>> 0;
  }

  return MIN_SIMULATED_RUNNERS + (hash % SIMULATED_RUNNER_SPAN);
}

export function formatRunnerCount(count: number): string {
  if (count < 1000) return count.toLocaleString('en-US');

  const compactCount = count / 1000;
  return `${compactCount >= 10 ? Math.round(compactCount) : compactCount.toFixed(1)}K`;
}
