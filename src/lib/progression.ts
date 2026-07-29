import type { AccentKey } from '@/theme';
import { getLevel, getMode, modes, type IconName, type Level, type Mode } from '@/lib/gameData';
import type { MoverKey } from '@/lib/onboarding';
export {
  levelFromXp,
  XP_PER_LEVEL,
  type LevelProgress,
} from '@/lib/progressAggregation';

/**
 * Class-based progression model.
 *
 * Instead of a single linear journey, the 13 worlds are grouped into three
 * selectable difficulty CLASSES — Beginner, Intermediate, Hard. Each class owns
 * a full, randomly-ordered roster of every available map (persisted so order
 * stays stable), runs slightly faster than the class below it, and tracks its
 * own calories + leaderboard rank. Everything the UI shows is derived from
 * persisted run records + the persisted rosters/cohorts (see ProgressContext).
 */

// ---------------------------------------------------------------------------
// Classes
// ---------------------------------------------------------------------------

export type ClassKey = 'beginner' | 'intermediate' | 'hard';

export type ClassMeta = {
  key: ClassKey;
  label: string;
  icon: IconName;
  accent: AccentKey;
  /** Playback speed multiplier — higher classes run faster. */
  speedFactor: number;
  /** Reward/intensity multiplier applied to coins + XP earned per run. */
  multiplier: number;
  /** Short pace label shown on cards. */
  target: string;
  /** One-line description of the class. */
  blurb: string;
  /** Compact tagline used on selectors. */
  tagline: string;
};

export const CLASS_META: Record<ClassKey, ClassMeta> = {
  beginner: {
    key: 'beginner',
    label: 'Beginner',
    icon: 'leaf',
    accent: 'lime',
    speedFactor: 1.0,
    multiplier: 1,
    target: 'Normal pace',
    blurb: 'Runs play at normal speed. Find your rhythm and just finish.',
    tagline: 'Normal speed',
  },
  intermediate: {
    key: 'intermediate',
    label: 'Intermediate',
    icon: 'flash',
    accent: 'cyan',
    speedFactor: 1.1,
    multiplier: 1.25,
    target: 'Faster pace',
    blurb: 'Runs play ~10% faster. More burn, bigger rewards.',
    tagline: '10% faster',
  },
  hard: {
    key: 'hard',
    label: 'Hard',
    icon: 'flame',
    accent: 'pink',
    speedFactor: 1.2,
    multiplier: 1.5,
    target: 'Fastest pace',
    blurb: 'Top speed, top burn. Runs play ~20% faster for the biggest gains.',
    tagline: '20% faster',
  },
};

export const CLASS_ORDER: ClassKey[] = ['beginner', 'intermediate', 'hard'];

export function isClassKey(value: unknown): value is ClassKey {
  return typeof value === 'string' && CLASS_ORDER.includes(value as ClassKey);
}

/**
 * Normalize route/search params that Expo may deliver as `string | string[]`.
 * Returns `fallback` when the value is missing or not a known class key.
 */
export function parseClassKeyParam(
  value: unknown,
  fallback: ClassKey = 'beginner'
): ClassKey {
  const raw = Array.isArray(value) ? value[0] : value;
  return isClassKey(raw) ? raw : fallback;
}

/**
 * Campaign-only classKey from route params. Missing or malformed values mean
 * casual / discovery play — do not invent an activeClass fallback here.
 */
export function parseOptionalClassKeyParam(value: unknown): ClassKey | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return isClassKey(raw) ? raw : null;
}

/**
 * Class key written onto a persisted run for campaign unlock purposes.
 *
 * Only a full finish (`finishedToEnd`) with an explicit campaign classKey
 * attributes the map. Casual discovery (no classKey) and early exits never
 * unlock the next node on a mode path.
 */
export function campaignClassKeyForCompletion(
  classKey: unknown,
  finishedToEnd: boolean
): ClassKey | undefined {
  if (!finishedToEnd) return undefined;
  return isClassKey(classKey) ? classKey : undefined;
}

/** Seed an initial class from the onboarding "mover" self-assessment. */
export function classForMover(mover: MoverKey | null): ClassKey {
  switch (mover) {
    case 'daily':
      return 'hard';
    case 'weekend':
      return 'intermediate';
    case 'couch':
    case 'comeback':
    default:
      return 'beginner';
  }
}

// ---------------------------------------------------------------------------
// Class rosters (full map pool, shuffled order)
// ---------------------------------------------------------------------------

export const ALL_MAP_IDS: string[] = modes.map((m) => m.id);
/** Every class campaign includes the full map pool. */
export const MAPS_PER_CLASS = ALL_MAP_IDS.length;
export const MIN_MAPS_PER_CLASS = MAPS_PER_CLASS;
export const MAX_MAPS_PER_CLASS = MAPS_PER_CLASS;

/**
 * Path nodes before this index show clear titles even while locked. From this
 * index onward, locked titles are blurred for FOMO. When the roster is only
 * five maps long, blur starts one earlier so the effect still appears.
 */
export const CLEAR_CAMPAIGN_TITLES = 5;

export type RunMove = 'jump' | 'duck' | 'left' | 'right';

/** The movement vocabulary used by the pre-run recap. */
export const RUN_MOVE_META: Record<
  RunMove,
  { label: string; icon: IconName }
> = {
  jump: { label: 'Jump', icon: 'arrow-up' },
  duck: { label: 'Duck', icon: 'arrow-down' },
  left: { label: 'Left', icon: 'arrow-back' },
  right: { label: 'Right', icon: 'arrow-forward' },
};

const ALL_DIRECTIONAL_MOVES: readonly RunMove[] = ['jump', 'duck', 'left', 'right'];

/**
 * Required move metadata is keyed by stable level id. Current video runs use
 * the same four directional moves; individual entries can diverge as content
 * gets map-specific choreography.
 */
export const REQUIRED_MOVES_BY_LEVEL: Record<string, readonly RunMove[]> =
  Object.fromEntries(ALL_MAP_IDS.map((levelId) => [levelId, ALL_DIRECTIONAL_MOVES]));

export function getRequiredMoves(levelId: string): readonly RunMove[] {
  return REQUIRED_MOVES_BY_LEVEL[levelId] ?? ALL_DIRECTIONAL_MOVES;
}

function shuffleMapIds(ids: readonly string[]): string[] {
  const pool = [...ids];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}

/** Full shuffled roster of every available map (called at assignment). */
export function rollClassRoster(): string[] {
  return shuffleMapIds(ALL_MAP_IDS);
}

/**
 * Expand a (possibly short/legacy) roster to include every map. Existing order
 * and progress-relevant prefixes are preserved; missing maps are appended in
 * canonical gameData order.
 */
export function expandClassRoster(roster: readonly string[]): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const levelId of roster) {
    if (seen.has(levelId)) continue;
    if (!getMode(levelId) || !getLevel(levelId)) continue;
    seen.add(levelId);
    kept.push(levelId);
  }
  for (const levelId of ALL_MAP_IDS) {
    if (seen.has(levelId)) continue;
    seen.add(levelId);
    kept.push(levelId);
  }
  return kept;
}

/** Ensure every class has a full roster; generates fresh shuffled ones if missing. */
export function ensureFullRosters(
  rosters: Partial<Record<ClassKey, string[]>> | null | undefined
): Record<ClassKey, string[]> {
  if (!rosters) return rollAllRosters();
  return {
    beginner: expandClassRoster(rosters.beginner ?? []),
    intermediate: expandClassRoster(rosters.intermediate ?? []),
    hard: expandClassRoster(rosters.hard ?? []),
  };
}

/** Roll a fresh, independent full roster for every class. */
export function rollAllRosters(): Record<ClassKey, string[]> {
  return {
    beginner: rollClassRoster(),
    intermediate: rollClassRoster(),
    hard: rollClassRoster(),
  };
}

export type MapState = 'completed' | 'next' | 'unlocked' | 'locked';

/** First index whose locked title should be blurred on the campaign path. */
export function campaignTitleBlurFromIndex(rosterLength: number): number {
  if (rosterLength <= 0) return 0;
  if (rosterLength <= CLEAR_CAMPAIGN_TITLES) return Math.max(0, rosterLength - 1);
  return CLEAR_CAMPAIGN_TITLES;
}

/**
 * Blur map titles for locked distant nodes only. Completed / current / unlocked
 * nodes always show the real name once reached.
 */
export function shouldBlurCampaignTitle(
  index: number,
  state: MapState,
  rosterLength: number
): boolean {
  return state === 'locked' && index >= campaignTitleBlurFromIndex(rosterLength);
}

/** BlurView intensity at the shallowest blurred node (nearer = lightly frosted). */
export const CAMPAIGN_COVER_BLUR_BASE = 28;
/** Added blur per node of depth beyond the first blurred node. */
export const CAMPAIGN_COVER_BLUR_STEP = 14;
/** Ceiling so the deepest covers stay fully obscured but not pure white. */
export const CAMPAIGN_COVER_BLUR_MAX = 96;

/**
 * Graduated cover-blur intensity (0 = crisp, up to CAMPAIGN_COVER_BLUR_MAX) for a
 * campaign node. Only locked nodes in the blur window are obscured, and they get
 * progressively blurrier the deeper they sit on the path so distant maps read as
 * unknowable. Completed / current / unlocked nodes always return 0 (crisp).
 */
export function campaignCoverBlurIntensity(
  index: number,
  state: MapState,
  rosterLength: number
): number {
  if (!shouldBlurCampaignTitle(index, state, rosterLength)) return 0;
  const depth = Math.max(0, index - campaignTitleBlurFromIndex(rosterLength));
  return Math.min(
    CAMPAIGN_COVER_BLUR_MAX,
    CAMPAIGN_COVER_BLUR_BASE + depth * CAMPAIGN_COVER_BLUR_STEP
  );
}

/**
 * Temporary QA override for casual map entry points only. Mode campaigns do
 * not consult this flag and always enforce their sequence.
 */
export const UNLOCK_ALL_GENERAL_MAPS_FOR_TESTING = true;

export function isGeneralMapUnlocked(): boolean {
  return UNLOCK_ALL_GENERAL_MAPS_FOR_TESTING;
}

/**
 * Campaign-only unlock rule. Completed steps stay replayable; otherwise the
 * first step is open and each later step requires the immediately prior step.
 */
export function isModeCampaignStepUnlocked(
  roster: readonly string[],
  index: number,
  completedInClass: ReadonlySet<string>
): boolean {
  if (index < 0 || index >= roster.length) return false;
  return completedInClass.has(roster[index]) || index === 0 || completedInClass.has(roster[index - 1]);
}

/**
 * Derive unique campaign completions from persisted runs. Only runs that
 * carry a matching campaign `classKey` count — that field is written solely
 * for finished-to-end mode plays. Casual discovery, early exits, legacy
 * records without classKey, and malformed values unlock nothing.
 */
export function completedLevelIdsForClass(
  runs: readonly { levelId?: unknown; classKey?: unknown }[],
  classKey: ClassKey
): Set<string> {
  return new Set(
    runs.flatMap((run) =>
      run.classKey === classKey && typeof run.levelId === 'string' && run.levelId
        ? [run.levelId]
        : []
    )
  );
}

export type ClassMapEntry = {
  index: number;
  levelId: string;
  mode: Mode;
  level: Level;
  state: MapState;
};

/**
 * Resolve a class roster to concrete map entries with per-map lock state. Maps
 * unlock sequentially when the immediately prior campaign step is complete.
 */
export function resolveClassMaps(roster: string[], completedInClass: Set<string>): ClassMapEntry[] {
  const entries: ClassMapEntry[] = [];
  const uniqueRoster = Array.from(new Set(roster)).filter(
    (levelId) => getMode(levelId) && getLevel(levelId)
  );
  let sawNext = false;
  uniqueRoster.forEach((levelId, index) => {
    const mode = getMode(levelId)!;
    const level = getLevel(levelId)!;
    const completed = completedInClass.has(levelId);
    const unlocked = isModeCampaignStepUnlocked(uniqueRoster, index, completedInClass);
    let state: MapState;
    if (completed) state = 'completed';
    else if (unlocked && !sawNext) {
      state = 'next';
      sawNext = true;
    } else if (unlocked) state = 'unlocked';
    else state = 'locked';
    entries.push({ index, levelId, mode, level, state });
  });
  return entries;
}

/**
 * First not-yet-completed map in the class campaign. Returns null when the
 * roster is empty or every step is complete (no silent replay fallback).
 */
export function nextMapInClass(roster: string[], completedInClass: Set<string>): string | null {
  const maps = resolveClassMaps(roster, completedInClass);
  return maps.find((m) => m.state === 'next')?.levelId ?? null;
}

// ---------------------------------------------------------------------------
// Rewards, calories + leveling
// ---------------------------------------------------------------------------

const COINS_PER_MIN = 20;
const XP_PER_MIN = 40;

/** Default assumed body-weight for the MET-based calorie estimate (no weight in onboarding). */
export const DEFAULT_WEIGHT_KG = 70;
/** Base MET for vigorous runner-game play, scaled by class speed. */
const BASE_MET = 8;

export function rewardForRun(durationMin: number, classKey: ClassKey): { coins: number; xp: number } {
  const mult = CLASS_META[classKey].multiplier;
  return {
    coins: Math.round(durationMin * COINS_PER_MIN * mult),
    xp: Math.round(durationMin * XP_PER_MIN * mult),
  };
}

/**
 * MET-based calorie estimate: kcal = MET × weightKg × hours, where MET scales
 * with the class speed so faster classes burn more.
 */
export function caloriesForRun(durationMin: number, classKey: ClassKey): number {
  const met = BASE_MET * CLASS_META[classKey].speedFactor;
  return Math.round(met * DEFAULT_WEIGHT_KG * (durationMin / 60));
}

// ---------------------------------------------------------------------------
// Streaks (day-based)
// ---------------------------------------------------------------------------

/** Local calendar day key, e.g. "2026-07-15". */
export function dayKey(ts: number): string {
  const d = new Date(ts);
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function daysBetween(aKey: string, bKey: string): number {
  const a = new Date(`${aKey}T00:00:00`).getTime();
  const b = new Date(`${bKey}T00:00:00`).getTime();
  return Math.round((a - b) / 86_400_000);
}

/**
 * Current + longest day-streaks from run timestamps. The current streak stays
 * alive as long as the most recent active day is today or yesterday, so it only
 * breaks after a full missed day.
 */
export function computeStreaks(timestamps: number[]): { current: number; longest: number } {
  if (timestamps.length === 0) return { current: 0, longest: 0 };

  const uniqueDays = Array.from(new Set(timestamps.map(dayKey))).sort((a, b) =>
    a < b ? 1 : a > b ? -1 : 0
  );

  let longest = 1;
  let run = 1;
  for (let i = 1; i < uniqueDays.length; i++) {
    if (daysBetween(uniqueDays[i - 1], uniqueDays[i]) === 1) {
      run += 1;
      longest = Math.max(longest, run);
    } else {
      run = 1;
    }
  }

  const today = dayKey(Date.now());
  const gapToLatest = daysBetween(today, uniqueDays[0]);
  let current = 0;
  if (gapToLatest === 0 || gapToLatest === 1) {
    current = 1;
    for (let i = 1; i < uniqueDays.length; i++) {
      if (daysBetween(uniqueDays[i - 1], uniqueDays[i]) === 1) current += 1;
      else break;
    }
  }

  return { current, longest };
}

/** Timestamp of the most recent Monday 00:00 local (start of the current week). */
export function startOfWeek(now = Date.now()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const dow = d.getDay(); // 0 = Sun
  const diff = (dow + 6) % 7; // days since Monday
  d.setDate(d.getDate() - diff);
  return d.getTime();
}

// ---------------------------------------------------------------------------
// Simulated leaderboard  // simulated until backend
// ---------------------------------------------------------------------------

/**
 * There is no backend yet, so "where you rank vs other people" is a locally
 * generated mock cohort. Each class gets a stable set of fake runners (persisted
 * in ProgressContext), and the real user is slotted in by their real class
 * calories — so their rank climbs believably as they train. Swapping in a real
 * backend later just means replacing generateCohort + the persisted cohort with
 * fetched data; rankAmong/classLeaderboard stay the same.
 */

const USERNAME_POOL = [
  'PixelDasher', 'NovaSprint', 'ByteRunner', 'TurboFox', 'EchoStride', 'GlitchWolf',
  'NeonPacer', 'AshRider', 'ZephyrJog', 'VoltHopper', 'LunaDash', 'CobraStep',
  'RiftRunner', 'HazeStrider', 'OrbitLegs', 'FlareTrack', 'DriftKid', 'PulseRacer',
  'IronCadence', 'MintVelocity', 'SkyBolt', 'QuartzRush', 'EmberQuick', 'JadeSprinter',
  'BlazePivot', 'FrostTempo', 'VectorLeap', 'SableSwift',
];

export type CohortMember = { id: string; name: string; calories: number };

export const MIN_LIVE_COMPETITION_DELAY_MS = 20_000;
export const MAX_LIVE_COMPETITION_DELAY_MS = 30_000;
export const MAX_SIMULATED_COHORT_SIZE = 50;

/** Pick a fresh delay for every simulated live update. */
export function nextLiveCompetitionDelay(random: () => number = Math.random): number {
  const span = MAX_LIVE_COMPETITION_DELAY_MS - MIN_LIVE_COMPETITION_DELAY_MS + 1;
  const offset = Math.min(span - 1, Math.max(0, Math.floor(random() * span)));
  return MIN_LIVE_COMPETITION_DELAY_MS + offset;
}

/** Generate a stable, plausible mock cohort for a class (persist the result). */
export function generateCohort(classKey: ClassKey, size = 20): CohortMember[] {
  const meta = CLASS_META[classKey];
  const cohortSize = Math.min(size, MAX_SIMULATED_COHORT_SIZE);
  const pool = [...USERNAME_POOL];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const members: CohortMember[] = [];
  for (let i = 0; i < cohortSize; i++) {
    const name = pool[i % pool.length] + (i >= pool.length ? `${Math.floor(i / pool.length) + 1}` : '');
    // Spread of accumulated calories; scaled up for faster (higher) classes.
    const base = 150 + Math.random() * 2400;
    members.push({
      id: `sim-${classKey}-${i + 1}`,
      name,
      calories: Math.round(base * meta.speedFactor),
    });
  }
  return members.sort((a, b) => b.calories - a.calories);
}

/**
 * Add ids to cohorts persisted before simulated entrants existed and repair any
 * duplicate ids/handles deterministically without changing calorie scores.
 */
export function normalizeSimulatedCohort(
  classKey: ClassKey,
  cohort: CohortMember[]
): CohortMember[] {
  const usedIds = new Set<string>();
  const usedNames = new Set<string>();
  let nextId = 1;

  return cohort.slice(0, MAX_SIMULATED_COHORT_SIZE).map((member, index) => {
    let id = typeof member.id === 'string' && member.id.trim() ? member.id : '';
    if (!id || usedIds.has(id)) {
      while (usedIds.has(`sim-${classKey}-${nextId}`)) nextId += 1;
      id = `sim-${classKey}-${nextId}`;
      nextId += 1;
    }
    usedIds.add(id);

    const baseName =
      typeof member.name === 'string' && member.name.trim() ? member.name.trim() : `Runner${index + 1}`;
    let name = baseName;
    let suffix = 2;
    while (usedNames.has(name)) {
      name = `${baseName}${suffix}`;
      suffix += 1;
    }
    usedNames.add(name);

    return { id, name, calories: Math.max(0, Math.round(member.calories || 0)) };
  });
}

const LIVE_GAIN_RANGE: Record<ClassKey, { min: number; max: number }> = {
  beginner: { min: 1, max: 3 },
  intermediate: { min: 2, max: 4 },
  hard: { min: 2, max: 5 },
};
const LIVE_ACTIVITY_CHANCE = 0.35;
const ONE_RUNNER_JOIN_CHANCE = 0.25;
const TWO_RUNNER_JOIN_CHANCE = 0.05;

function randomIndex(length: number, random: () => number): number {
  return Math.min(length - 1, Math.floor(random() * length));
}

function nextSimulatedId(classKey: ClassKey, members: CohortMember[]): string {
  const used = new Set(members.map((member) => member.id));
  let sequence = 1;
  while (used.has(`sim-${classKey}-${sequence}`)) sequence += 1;
  return `sim-${classKey}-${sequence}`;
}

function nextSimulatedHandle(members: CohortMember[], random: () => number): string {
  const used = new Set(members.map((member) => member.name));
  const base = USERNAME_POOL[randomIndex(USERNAME_POOL.length, random)];
  let name = base;
  let suffix = 2;
  while (used.has(name)) {
    name = `${base}${suffix}`;
    suffix += 1;
  }
  return name;
}

function entrantCalories(
  classKey: ClassKey,
  members: CohortMember[],
  userCalories: number,
  random: () => number
): number {
  const sortedScores = members.map((member) => member.calories).sort((a, b) => a - b);
  const median = sortedScores[Math.floor(sortedScores.length / 2)] ?? 150 * CLASS_META[classKey].speedFactor;
  const nearbyWindow = Math.max(8, Math.round(median * 0.08));
  const offset = 1 + Math.floor(random() * nearbyWindow);
  const entersAboveUser = random() < 0.45;
  return entersAboveUser ? userCalories + offset : Math.max(0, userCalories - offset);
}

/**
 * Advance a subset of the locally simulated competitors by one small activity
 * tick and occasionally add entrants. This is simulated until a backend
 * provides real-time runner updates. The injected RNG keeps focused checks
 * deterministic. The real user's calories are only an entrant-position
 * reference and are never mutated here.
 */
export function advanceSimulatedCohort(
  classKey: ClassKey,
  cohort: CohortMember[],
  userCalories: number,
  random: () => number = Math.random
): CohortMember[] {
  const { min, max } = LIVE_GAIN_RANGE[classKey];
  let advanced = 0;
  const next = normalizeSimulatedCohort(classKey, cohort).map((member) => {
    if (random() >= LIVE_ACTIVITY_CHANCE) return member;
    const gain = min + Math.floor(random() * (max - min + 1));
    advanced += 1;
    return { ...member, calories: member.calories + gain };
  });

  // A live tick always represents at least one competitor activity event.
  if (advanced === 0 && next.length > 0) {
    const index = randomIndex(next.length, random);
    const gain = min + Math.floor(random() * (max - min + 1));
    next[index] = { ...next[index], calories: next[index].calories + gain };
  }

  const joinRoll = random();
  const requestedJoins =
    joinRoll < TWO_RUNNER_JOIN_CHANCE
      ? 2
      : joinRoll < TWO_RUNNER_JOIN_CHANCE + ONE_RUNNER_JOIN_CHANCE
        ? 1
        : 0;
  const joinCount = Math.min(requestedJoins, MAX_SIMULATED_COHORT_SIZE - next.length);
  for (let i = 0; i < joinCount; i++) {
    const id = nextSimulatedId(classKey, next);
    const name = nextSimulatedHandle(next, random);
    const calories = entrantCalories(classKey, next, userCalories, random);
    next.push({ id, name, calories });
  }

  return next.sort((a, b) => b.calories - a.calories || a.id.localeCompare(b.id));
}

export type ClassRank = { rank: number; total: number; percentile: number };

export function rankAmong(cohort: CohortMember[], userCalories: number): ClassRank {
  const total = cohort.length + 1;
  const ahead = cohort.filter((m) => m.calories > userCalories).length;
  const rank = ahead + 1;
  const percentile = Math.max(1, Math.round((1 - (rank - 1) / total) * 100));
  return { rank, total, percentile };
}

export type LeaderRow = { rank: number; name: string; calories: number; isUser: boolean };

/**
 * Combined leaderboard (cohort + real user), returning the full ordered rows
 * so screens can derive top and user-centered windows from one ranking model.
 */
export function classLeaderboard(
  cohort: CohortMember[],
  userCalories: number,
  userName: string
): { rank: number; total: number; rows: LeaderRow[] } {
  const combined = [
    ...cohort.map((m) => ({ name: m.name, calories: m.calories, isUser: false })),
    { name: userName, calories: userCalories, isUser: true },
  ].sort(
    (a, b) =>
      b.calories - a.calories ||
      Number(b.isUser) - Number(a.isUser) ||
      a.name.localeCompare(b.name)
  );

  const rows: LeaderRow[] = combined.map((e, i) => ({ rank: i + 1, ...e }));
  const total = rows.length;
  const userIdx = rows.findIndex((r) => r.isUser);
  return {
    rank: rows[userIdx].rank,
    total,
    rows,
  };
}

// ---------------------------------------------------------------------------
// Aggregated per-class view model (consumed by the screens)
// ---------------------------------------------------------------------------

export type ClassData = {
  key: ClassKey;
  meta: ClassMeta;
  roster: string[];
  maps: ClassMapEntry[];
  /** Next incomplete map in this class campaign, or null when finished. */
  nextLevelId: string | null;
  completedCount: number;
  total: number;
  allComplete: boolean;
  calories: number;
  runs: number;
  rank: number;
  rankTotal: number;
  percentile: number;
  leaderboard: LeaderRow[];
};

export function buildClassData(
  key: ClassKey,
  roster: string[],
  cohort: CohortMember[],
  runs: readonly { levelId?: unknown; calories?: unknown; classKey?: unknown }[],
  userName: string
): ClassData {
  const runsInClass = runs
    .filter(
      (run) =>
        run.classKey === key &&
        typeof run.levelId === 'string' &&
        typeof run.calories === 'number' &&
        Number.isFinite(run.calories)
    )
    .map((run) => ({ levelId: run.levelId as string, calories: run.calories as number }));
  const completedInClass = completedLevelIdsForClass(runs, key);
  const maps = resolveClassMaps(roster, completedInClass);
  const calories = runsInClass.reduce((sum, r) => sum + r.calories, 0);
  const lb = classLeaderboard(cohort, calories, userName);
  const completedCount = maps.filter((m) => m.state === 'completed').length;
  return {
    key,
    meta: CLASS_META[key],
    roster: maps.map((map) => map.levelId),
    maps,
    nextLevelId: nextMapInClass(roster, completedInClass),
    completedCount,
    total: maps.length,
    allComplete: maps.length > 0 && completedCount >= maps.length,
    calories,
    runs: runsInClass.length,
    rank: lb.rank,
    rankTotal: lb.total,
    percentile: rankAmong(cohort, calories).percentile,
    leaderboard: lb.rows,
  };
}
