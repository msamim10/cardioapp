/**
 * Static beatmap registry. Metro needs literal `require` calls, so every
 * shipped beatmap is listed here explicitly.
 *
 * To ship a beatmap: author it on the dev "Beatmap authoring" screen
 * (Profile → dev section), export, save the JSON as
 * `src/data/beatmaps/<levelId>.json`, and add one `require` line below.
 * Levels without an entry keep free scoring (`applyRecognizedMove`).
 *
 * No fabricated beatmaps ship: the release registry is empty. The example
 * file maps to a non-existent level id and is registered under __DEV__ only so
 * the loader path is exercised in development builds.
 */

import { parseBeatmap, type Beatmap } from '@/lib/beatmaps';

const BEATMAP_SOURCES: unknown[] = [
  // require('../data/beatmaps/neon-rails.json'),
];
if (__DEV__) {
  BEATMAP_SOURCES.push(require('../data/beatmaps/example.dev.json'));
}

export const BEATMAPS: Record<string, Beatmap> = {};
for (const source of BEATMAP_SOURCES) {
  const beatmap = parseBeatmap(source);
  if (!beatmap) {
    if (__DEV__) console.warn('[beatmaps] Skipping invalid beatmap source', source);
    continue;
  }
  BEATMAPS[beatmap.levelId] = beatmap;
}

export function getBeatmap(levelId: string | undefined): Beatmap | null {
  if (!levelId) return null;
  return BEATMAPS[levelId] ?? null;
}

export function hasBeatmap(levelId: string | undefined): boolean {
  return getBeatmap(levelId) !== null;
}
