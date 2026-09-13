/**
 * Canonical level ids in the same order as `modes` in `src/lib/gameData.ts`.
 *
 * The server has no access to `gameData.ts` (it imports Expo types), so the
 * order is mirrored here. `npm run test:daily-key` asserts the two lists are
 * identical — add new levels to BOTH.
 */
export const CANONICAL_LEVEL_IDS: readonly string[] = [
  'wild-city',
  'pixel-kingdom',
  'neon-beat-hunters',
  'dino-escape',
  'wild-city-rush',
  'red-light-rush',
  'critter-chase',
  'red-light-rush-2',
  'metro-zombie-escape',
  'drumline-dash',
  'block-world-dash',
  'neon-rails',
  'prison-escape-run',
];

export function isCanonicalLevelId(value: unknown): value is string {
  return typeof value === 'string' && CANONICAL_LEVEL_IDS.includes(value);
}
