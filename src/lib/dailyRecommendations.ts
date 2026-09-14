import type { Mode } from '@/lib/gameData';
import type { OnboardingAnswers } from '@/lib/onboarding';
import { classForMover, type ClassKey } from '@/lib/progression';
import {
  EVERY_LEVEL_SCORABLE,
  dailyChallengeLevelId,
  dailyChallengePool,
  hashSeed,
  localDateKey,
} from '@shared/scoring/daily';

/** Local calendar key used to keep one recommendation rotation per day. */
export { localDateKey } from '@shared/scoring/daily';

export const DAILY_RECOMMENDATION_COUNT = 5;
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
 * featured first, followed by `DAILY_RECOMMENDATION_COUNT` unique picks.
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
// Home · "Recommended for you"
// ---------------------------------------------------------------------------

/** How many of the most recent plays are kept off the row. */
export const RECOMMENDATION_RECENT_EXCLUSIONS = 2;

/** The onboarding answers the picker reads; everything else is ignored. */
export type RecommendationAnswers = Partial<
  Pick<OnboardingAnswers, 'goal' | 'mover' | 'motivation' | 'sessionMin' | 'worlds'>
>;

export type PickDailyRecommendationsInput = {
  modes: readonly Mode[];
  /** Signed-in uid, install id, or `'local'` — makes the rotation per person. */
  seedKey: string;
  /** Local `YYYY-MM-DD` (`localDateKey`); the rotation changes once per day. */
  dateKey: string;
  answers?: RecommendationAnswers | null;
  /** Level ids most recent first; the first two are kept off the row when possible. */
  recentLevelIds?: readonly string[];
};

/** Session length (minutes) a goal implies when the user never picked one. */
function goalDurationTarget(goal: OnboardingAnswers['goal'] | undefined): number | null {
  switch (goal) {
    case 'lose':
      return 7; // longest burn on the roster
    case 'active':
      return 6;
    case 'habit':
      return 4; // short enough to show up for every day
    default:
      return null;
  }
}

/**
 * Preference weight for one map. Every map starts at 1 so nothing is ever
 * excluded by taste alone; matches add to that:
 *
 *   +1.5  discovery class equals the class the "how much do you move" answer
 *         seeds (`classForMover`) — the strongest signal we hold
 *   +1.0  duration within 1 min of the target (explicit `sessionMin`, else the
 *         goal's implied length); +0.5 when within 2 min
 *   +1.0  the map was hand-picked during onboarding (`worlds`)
 *   +0.5  motivation "compete" on a hard-class map / "chill" on a beginner one
 *
 * Range is therefore [1, 5]: a perfect match is drawn five times as often as
 * a neutral one, but a neutral map still rotates in.
 */
export function recommendationWeight(
  mode: Mode,
  allModes: readonly Mode[],
  answers: RecommendationAnswers | null | undefined
): number {
  let weight = 1;
  if (!answers) return weight;
  const modeClass = discoveryClassForMode(mode.id, allModes);
  if (answers.mover && classForMover(answers.mover) === modeClass) weight += 1.5;

  const target = answers.sessionMin ?? goalDurationTarget(answers.goal);
  const duration = mode.levels[0]?.durationMin;
  if (target !== null && target !== undefined && typeof duration === 'number') {
    const gap = Math.abs(duration - target);
    if (gap <= 1) weight += 1;
    else if (gap <= 2) weight += 0.5;
  }

  if (answers.worlds?.includes(mode.id)) weight += 1;

  if (
    (answers.motivation === 'compete' && modeClass === 'hard') ||
    (answers.motivation === 'chill' && modeClass === 'beginner')
  ) {
    weight += 0.5;
  }
  return weight;
}

/**
 * Exactly `DAILY_RECOMMENDATION_COUNT` maps for Home, rotating once per local
 * day and per person (`hashSeed(seedKey + dateKey)`). Pure and deterministic.
 *
 * 1. Drop the two most recently played levels — but only while at least five
 *    candidates remain, so a small roster still fills the row.
 * 2. Weighted draw without replacement over the remaining candidates using
 *    `recommendationWeight`, so onboarding answers bias (never gate) the row.
 * 3. Pad from whatever was set aside (least recent first) if the draw came up
 *    short; a roster with fewer than five unique maps returns them all.
 */
export function pickDailyRecommendations({
  modes: allModes,
  seedKey,
  dateKey,
  answers,
  recentLevelIds = [],
}: PickDailyRecommendationsInput): Mode[] {
  const uniqueModes = Array.from(new Map(allModes.map((mode) => [mode.id, mode])).values());
  if (uniqueModes.length <= DAILY_RECOMMENDATION_COUNT) return uniqueModes;

  const random = seededRandom(hashSeed(`${seedKey}:${dateKey}`));

  // Exclude recent plays most-recent-first while the pool stays full.
  const excluded: Mode[] = [];
  let candidates = uniqueModes;
  for (const levelId of recentLevelIds.slice(0, RECOMMENDATION_RECENT_EXCLUSIONS)) {
    const index = candidates.findIndex((mode) => mode.id === levelId);
    if (index < 0 || candidates.length - 1 < DAILY_RECOMMENDATION_COUNT) continue;
    excluded.push(candidates[index]);
    candidates = candidates.filter((_, position) => position !== index);
  }

  // Weighted draw without replacement.
  const pool = candidates.map((mode) => ({
    mode,
    weight: recommendationWeight(mode, uniqueModes, answers),
  }));
  const picked: Mode[] = [];
  while (picked.length < DAILY_RECOMMENDATION_COUNT && pool.length > 0) {
    const total = pool.reduce((sum, entry) => sum + entry.weight, 0);
    let roll = random() * total;
    let index = 0;
    for (; index < pool.length - 1; index += 1) {
      roll -= pool[index].weight;
      if (roll < 0) break;
    }
    picked.push(pool[index].mode);
    pool.splice(index, 1);
  }

  // Pad from the set-aside plays, least recent first.
  for (let index = excluded.length - 1; index >= 0 && picked.length < DAILY_RECOMMENDATION_COUNT; index -= 1) {
    picked.push(excluded[index]);
  }
  return picked;
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
