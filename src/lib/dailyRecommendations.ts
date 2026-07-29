import type { Mode } from '@/lib/gameData';
import type { ClassKey } from '@/lib/progression';

export const DAILY_RECOMMENDATION_COUNT = 4;
export const DAILY_DISCOVERY_COUNT = DAILY_RECOMMENDATION_COUNT + 1;
const DISCOVERY_CLASS_ORDER: readonly ClassKey[] = [
  'beginner',
  'intermediate',
  'hard',
];

/** Local calendar key used to keep one recommendation rotation per day. */
export function localDateKey(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export type DailyDiscovery = {
  featured: Mode;
  recommendations: Mode[];
};

/**
 * One local-date-seeded shuffle drives the full daily discovery rotation:
 * featured first, followed by four unique recommendations.
 */
export function getDailyDiscovery(allModes: readonly Mode[], date: Date): DailyDiscovery {
  const uniqueModes = Array.from(new Map(allModes.map((mode) => [mode.id, mode])).values());
  if (uniqueModes.length < DAILY_DISCOVERY_COUNT) {
    throw new Error(`Daily discovery requires at least ${DAILY_DISCOVERY_COUNT} unique maps`);
  }

  const shuffled = [...uniqueModes];
  const random = seededRandom(hashSeed(localDateKey(date)));

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return {
    featured: shuffled[0],
    recommendations: shuffled.slice(1, DAILY_DISCOVERY_COUNT),
  };
}

/**
 * Stable discovery difficulty for calorie estimates / UI badges only.
 * Must never be passed as a campaign `classKey` — casual plays omit that.
 */
export function discoveryClassForMode(modeId: string, allModes: readonly Mode[]): ClassKey {
  const canonicalIndex = allModes.findIndex((mode) => mode.id === modeId);
  return DISCOVERY_CLASS_ORDER[
    Math.max(0, canonicalIndex) % DISCOVERY_CLASS_ORDER.length
  ];
}
