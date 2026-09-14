import type { Mode } from '@/lib/gameData';
import type { ClassKey } from '@/lib/progression';
import {
  EVERY_LEVEL_SCORABLE,
  dailyChallengeLevelId,
  dailyChallengePool,
  hashSeed,
  localDateKey,
} from '@shared/scoring/daily';

/** Local calendar key used to keep one recommendation rotation per day. */
export { localDateKey } from '@shared/scoring/daily';

export const DAILY_RECOMMENDATION_COUNT = 4;
export const DAILY_DISCOVERY_COUNT = DAILY_RECOMMENDATION_COUNT + 1;
const DISCOVERY_CLASS_ORDER: readonly ClassKey[] = [
  'beginner',
  'intermediate',
  'hard',
];

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

// ---------------------------------------------------------------------------
// Daily challenge
// ---------------------------------------------------------------------------

export type DailyChallenge = {
  mode: Mode;
  /** Local `YYYY-MM-DD` the pick is valid for. */
  dateKey: string;
  /**
   * Retired: every level scores (provisionally until its chart exists), so
   * the pick always comes from the full roster and this is always false. Kept
   * on the type for the replay script.
   */
  practice: boolean;
};

/**
 * One designated video per local calendar date, identical for every user:
 * `hash(dateKey + salt) mod roster.length` over every level (canonical
 * `modes` order). Charts are not a criterion: levels without one still score
 * (provisionally), and using them would let the pick change mid-day when a
 * consensus chart lands.
 *
 * The pick itself (`dailyChallengePool` + `dailyChallengeLevelId`) lives in
 * the shared package: the `submitRun` Cloud Function runs the same code to
 * decide whether a run lands on the daily board.
 */
export function getDailyChallenge(
  allModes: readonly Mode[],
  date: Date,
  eligible: (levelId: string) => boolean = EVERY_LEVEL_SCORABLE
): DailyChallenge | null {
  const uniqueModes = Array.from(new Map(allModes.map((mode) => [mode.id, mode])).values());
  if (uniqueModes.length === 0) return null;
  const { pool, practice } = dailyChallengePool(eligible, uniqueModes.map((mode) => mode.id));
  const dateKey = localDateKey(date);
  const levelId = dailyChallengeLevelId(dateKey, pool);
  const mode = uniqueModes.find((entry) => entry.id === levelId);
  if (!mode) return null;
  return { mode, dateKey, practice };
}

/**
 * The challenge is complete once ≥1 persisted run on that level falls on the
 * challenge's local day. Derived from runs — nothing extra is persisted.
 */
export function isDailyChallengeCompleted(
  runs: readonly { levelId?: unknown; at?: unknown }[],
  challenge: DailyChallenge | null
): boolean {
  if (!challenge) return false;
  return runs.some(
    (run) =>
      run.levelId === challenge.mode.id &&
      typeof run.at === 'number' &&
      Number.isFinite(run.at) &&
      localDateKey(new Date(run.at)) === challenge.dateKey
  );
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
