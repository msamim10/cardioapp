import type { AccentKey } from '@/theme';
import { getLevel, getMode, modes, type IconName, type Level, type Mode } from '@/lib/gameData';
import type { MoverKey } from '@/lib/onboarding';
import { clampLevel, MAX_LEVEL } from '@/lib/levels';
export {
  effectiveLevel,
  levelFromXp,
  MAX_LEVEL,
  progressWithinLevel,
  xpForLevel,
  type LevelProgress,
} from '@/lib/levels';

/**
 * Class-based progression model.
 *
 * Instead of a single linear journey, the 13 worlds are grouped into three
 * selectable difficulty CLASSES — Beginner, Intermediate, Hard. Each class owns
 * a full, randomly-ordered roster of every available map (persisted so order
 * stays stable), runs slightly faster than the class below it, and tracks its
 * own calories. Everything the UI shows is derived from persisted run records
 * + the persisted rosters (see ProgressContext). Per-level leaderboards are
 * real and server-verified — see `src/lib/leaderboards.ts`; nothing here is
 * simulated.
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
 * Intentional policy (not a QA override): casual entry points — Levels tab
 * discovery, Home recommendations, the daily challenge — are always open for
 * Pro. Only the class CAMPAIGN paths gate maps (sequence + skill + level, see
 * `campaignLockReason`). Those paths never consult this flag.
 */
export const CASUAL_MAPS_ALWAYS_UNLOCKED = true;

export function isGeneralMapUnlocked(): boolean {
  return CASUAL_MAPS_ALWAYS_UNLOCKED;
}

// ---------------------------------------------------------------------------
// Campaign gates: sequence + skill (accuracy) + player level
// ---------------------------------------------------------------------------

/**
 * Skill gate: the previous node's best campaign accuracy must reach this when
 * that level has a published beatmap. Levels WITHOUT a beatmap auto-pass —
 * free scoring has no accuracy to judge (today every level is in that state,
 * so the gate is inert until beatmaps ship).
 */
export const CAMPAIGN_ACCURACY_GATE = 0.7;

/**
 * Level requirement per campaign node: node k (0-based) on a class roster
 * needs effective player level ≥ `1 + floor(k × step)`.
 *
 *   node:          0  1  2  3  4  5  6  7  8  9  10 11 12
 *   beginner (1):  1  2  3  4  5  6  7  8  9  10 11 12 13
 *   intermediate:  1  3  5  7  9  11 13 15 17 19 21 23 25
 *   hard (3):      1  4  7  10 13 16 19 22 25 28 31 34 37
 *
 * Node 0 is always open. Tune `CAMPAIGN_LEVEL_STEP` to loosen/tighten.
 */
export const CAMPAIGN_LEVEL_STEP: Record<ClassKey, number> = {
  beginner: 1,
  intermediate: 2,
  hard: 3,
};

export function requiredLevelForNode(index: number, classKey: ClassKey): number {
  const safeIndex = Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0;
  return clampLevel(1 + Math.floor(safeIndex * CAMPAIGN_LEVEL_STEP[classKey]));
}

/** Inputs the campaign gates need beyond the completion set. */
export type CampaignGate = {
  classKey: ClassKey;
  /** Effective player level (curve level with the legacy floor applied). */
  playerLevel: number;
  /** Best campaign `accuracy` per level id in this class (0–1). */
  bestAccuracyInClass: ReadonlyMap<string, number>;
  /** Whether a level ships a beatmap; injected so this module stays registry-free. */
  hasBeatmap: (levelId: string) => boolean;
};

/**
 * Permissive gate used when callers only care about the completion sequence
 * (replay scripts, legacy call sites): max level, no beatmaps → only rule (a).
 */
export const OPEN_CAMPAIGN_GATE: CampaignGate = {
  classKey: 'beginner',
  playerLevel: MAX_LEVEL,
  bestAccuracyInClass: new Map(),
  hasBeatmap: () => false,
};

export type LockReason =
  | { kind: 'previous'; previousLevelId: string; previousIndex: number }
  | {
      kind: 'accuracy';
      previousLevelId: string;
      previousIndex: number;
      required: number;
      current: number;
    }
  | { kind: 'level'; required: number; current: number };

/**
 * Why a campaign node is locked, or null when it is open. Completed nodes are
 * always replayable. Otherwise node k opens when ALL hold:
 *
 *   (a) k === 0, or node k−1 is completed in this class;
 *   (b) node k−1's best accuracy ≥ 0.70 if it has a beatmap (auto-pass otherwise);
 *   (c) effective player level ≥ requiredLevelForNode(k, classKey).
 *
 * Reasons are reported in that order so the card shows the nearest blocker.
 */
export function campaignLockReason(
  roster: readonly string[],
  index: number,
  completedInClass: ReadonlySet<string>,
  gate: CampaignGate = OPEN_CAMPAIGN_GATE
): LockReason | null {
  if (index < 0 || index >= roster.length) return { kind: 'level', required: MAX_LEVEL + 1, current: 0 };
  const levelId = roster[index];
  if (completedInClass.has(levelId)) return null;

  if (index > 0) {
    const previousLevelId = roster[index - 1];
    if (!completedInClass.has(previousLevelId)) {
      return { kind: 'previous', previousLevelId, previousIndex: index - 1 };
    }
    if (gate.hasBeatmap(previousLevelId)) {
      const best = gate.bestAccuracyInClass.get(previousLevelId) ?? 0;
      if (best < CAMPAIGN_ACCURACY_GATE) {
        return {
          kind: 'accuracy',
          previousLevelId,
          previousIndex: index - 1,
          required: CAMPAIGN_ACCURACY_GATE,
          current: best,
        };
      }
    }
  }

  const required = requiredLevelForNode(index, gate.classKey);
  const current = clampLevel(gate.playerLevel);
  if (current < required) return { kind: 'level', required, current };
  return null;
}

/**
 * Campaign-only unlock rule. Completed steps stay replayable; otherwise the
 * first step is open and each later step requires the immediately prior step
 * plus the skill and level gates in `campaignLockReason`.
 */
export function isModeCampaignStepUnlocked(
  roster: readonly string[],
  index: number,
  completedInClass: ReadonlySet<string>,
  gate: CampaignGate = OPEN_CAMPAIGN_GATE
): boolean {
  if (index < 0 || index >= roster.length) return false;
  return campaignLockReason(roster, index, completedInClass, gate) === null;
}

/**
 * Best campaign accuracy per level for a class, from persisted runs. Only
 * runs carrying that `classKey` count (same attribution rule as completions).
 */
export function bestAccuracyByLevelForClass(
  runs: readonly { levelId?: unknown; classKey?: unknown; accuracy?: unknown }[],
  classKey: ClassKey
): Map<string, number> {
  const best = new Map<string, number>();
  for (const run of runs) {
    if (run.classKey !== classKey || typeof run.levelId !== 'string' || !run.levelId) continue;
    const accuracy =
      typeof run.accuracy === 'number' && Number.isFinite(run.accuracy)
        ? Math.min(1, Math.max(0, run.accuracy))
        : 0;
    if (accuracy > (best.get(run.levelId) ?? -1)) best.set(run.levelId, accuracy);
  }
  return best;
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
  /** Why the node is locked (null unless `state === 'locked'`). */
  lockReason: LockReason | null;
  /** Player level this node requires, for the card copy. */
  requiredLevel: number;
};

/**
 * Resolve a class roster to concrete map entries with per-map lock state. Maps
 * unlock sequentially when the immediately prior campaign step is complete
 * and the skill/level gates pass (`campaignLockReason`).
 */
export function resolveClassMaps(
  roster: string[],
  completedInClass: Set<string>,
  gate: CampaignGate = OPEN_CAMPAIGN_GATE
): ClassMapEntry[] {
  const entries: ClassMapEntry[] = [];
  const uniqueRoster = Array.from(new Set(roster)).filter(
    (levelId) => getMode(levelId) && getLevel(levelId)
  );
  let sawNext = false;
  uniqueRoster.forEach((levelId, index) => {
    const mode = getMode(levelId)!;
    const level = getLevel(levelId)!;
    const completed = completedInClass.has(levelId);
    const lockReason = campaignLockReason(uniqueRoster, index, completedInClass, gate);
    const unlocked = lockReason === null;
    let state: MapState;
    if (completed) state = 'completed';
    else if (unlocked && !sawNext) {
      state = 'next';
      sawNext = true;
    } else if (unlocked) state = 'unlocked';
    else state = 'locked';
    entries.push({
      index,
      levelId,
      mode,
      level,
      state,
      lockReason: state === 'locked' ? lockReason : null,
      requiredLevel: requiredLevelForNode(index, gate.classKey),
    });
  });
  return entries;
}

/**
 * First not-yet-completed map in the class campaign. Returns null when the
 * roster is empty, every step is complete, or the next step is gated (the
 * summary then shows the lock reason via `nextLockedMapInClass`).
 */
export function nextMapInClass(
  roster: string[],
  completedInClass: Set<string>,
  gate: CampaignGate = OPEN_CAMPAIGN_GATE
): string | null {
  const maps = resolveClassMaps(roster, completedInClass, gate);
  return maps.find((m) => m.state === 'next')?.levelId ?? null;
}

/**
 * The first incomplete node when it is LOCKED by a skill/level gate, so the
 * summary can say why there is no "Next level" CTA. Null when the next node is
 * open, the campaign is finished, or the blocker is simply "previous incomplete".
 */
export function nextLockedMapInClass(
  maps: readonly ClassMapEntry[]
): { levelId: string; index: number; reason: LockReason } | null {
  const first = maps.find((m) => m.state !== 'completed');
  if (!first || first.state !== 'locked' || !first.lockReason) return null;
  if (first.lockReason.kind === 'previous') return null;
  return { levelId: first.levelId, index: first.index, reason: first.lockReason };
}

/** Human copy for a lock reason ("Reach level 6 · now 4"). `nameOf` maps level ids to titles. */
export function lockReasonCopy(reason: LockReason, nameOf: (levelId: string) => string): string {
  switch (reason.kind) {
    case 'previous':
      return `Complete Level ${reason.previousIndex + 1}`;
    case 'accuracy':
      return `Score ${Math.round(reason.required * 100)}% accuracy on ${nameOf(reason.previousLevelId)} · best ${Math.round(reason.current * 100)}%`;
    case 'level':
      return `Reach level ${reason.required} · now ${reason.current}`;
  }
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

export type RunReward = { coins: number; xp: number };

/** Base reward: duration × class multiplier. The performance floor is 30% of this. */
export function rewardForRun(durationMin: number, classKey: ClassKey): RunReward {
  const mult = CLASS_META[classKey].multiplier;
  return {
    coins: Math.round(durationMin * COINS_PER_MIN * mult),
    xp: Math.round(durationMin * XP_PER_MIN * mult),
  };
}

/** Floor of the accuracy/activity factor: standing still still earns 30% of base. */
export const REWARD_ACCURACY_FLOOR = 0.3;
/** Combo bonus caps at +25% (reached at a max combo of 25). */
export const REWARD_COMBO_CAP = 0.25;
/**
 * Free-scoring reference activity: 30 recognized moves per minute (one every
 * two seconds, roughly the cadence a cued map asks for) earns the full
 * activity factor. Above that is not rewarded further.
 */
export const REWARD_REFERENCE_MOVES_PER_MIN = 30;

/** Completing the day's designated challenge video pays +25% XP on that run (XP only). */
export const DAILY_CHALLENGE_XP_BONUS = 0.25;

export type RewardBreakdown = {
  base: RunReward;
  /** 0.3–1.0: accuracy (beatmap) or activity (free scoring) factor. */
  accuracyFactor: number;
  /** 1.0–1.25 from the run's max combo. */
  comboFactor: number;
  /** 1.0, or 1.25 when this run completed the daily challenge. Applies to XP only. */
  xpBonusFactor: number;
  total: RunReward;
};

const clamp01 = (value: number) =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

/**
 * Performance-scaled reward.
 *
 *   coins = round(base.coins × accuracyFactor × comboFactor)
 *   xp    = round(base.xp    × accuracyFactor × comboFactor × xpBonusFactor)
 *   base            = rewardForRun(durationMin, classKey)
 *   accuracyFactor  = 0.3 + 0.7 × accuracy                        (beatmap)
 *                   = 0.3 + 0.7 × clamp(movesPerMin / 30, 0, 1)   (no beatmap)
 *   comboFactor     = 1 + min(0.25, maxCombo / 100)
 *   xpBonusFactor   = 1 + 0.25 when `dailyChallenge`, else 1
 *
 * Calories are NOT affected: they stay a duration × intensity (MET) estimate
 * in `caloriesForRun`, because effort burned does not depend on hitting cues.
 */
export function rewardForRunPerformance(input: {
  durationMin: number;
  classKey: ClassKey;
  /** (perfect + 0.5·good) / cues, 0–1. Ignored without a beatmap. */
  accuracy: number;
  maxCombo: number;
  hasBeatmap: boolean;
  /** Recognized moves per minute; the activity proxy without a beatmap. */
  movesPerMin: number;
  /** True when this run is the first completion of today's daily challenge. */
  dailyChallenge?: boolean;
}): RewardBreakdown {
  const base = rewardForRun(input.durationMin, input.classKey);
  const performance = input.hasBeatmap
    ? clamp01(input.accuracy)
    : clamp01(input.movesPerMin / REWARD_REFERENCE_MOVES_PER_MIN);
  const accuracyFactor = REWARD_ACCURACY_FLOOR + (1 - REWARD_ACCURACY_FLOOR) * performance;
  const maxCombo = Number.isFinite(input.maxCombo) ? Math.max(0, input.maxCombo) : 0;
  const comboFactor = 1 + Math.min(REWARD_COMBO_CAP, maxCombo / 100);
  const xpBonusFactor = input.dailyChallenge === true ? 1 + DAILY_CHALLENGE_XP_BONUS : 1;
  const scale = accuracyFactor * comboFactor;
  return {
    base,
    accuracyFactor,
    comboFactor,
    xpBonusFactor,
    total: {
      coins: Math.round(base.coins * scale),
      xp: Math.round(base.xp * scale * xpBonusFactor),
    },
  };
}

/**
 * MET-based calorie estimate: kcal = MET × weightKg × hours, where MET scales
 * with the class speed so faster classes burn more. `effort` is the per-run
 * intensity multiplier (Light / Active / Intense playback), default neutral.
 */
export function caloriesForRun(durationMin: number, classKey: ClassKey, effort = 1): number {
  const factor = Number.isFinite(effort) && effort > 0 ? effort : 1;
  const met = BASE_MET * CLASS_META[classKey].speedFactor * factor;
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

/** Day key shifted by `delta` calendar days (local). */
function shiftDayKey(key: string, delta: number): string {
  const d = new Date(`${key}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return dayKey(d.getTime());
}

/** Monday-local week key ("2026-07-13") that a day key belongs to. */
export function weekKeyOf(key: string): string {
  return dayKey(startOfWeek(new Date(`${key}T00:00:00`).getTime()));
}

export type StreakInfo = {
  /** Active days in the current chain (frozen days are bridged, not counted). */
  current: number;
  longest: number;
  /** A run exists on the local calendar day of `now`. */
  ranToday: boolean;
  /** The current week's (Monday-local) single freeze has been spent bridging a gap. */
  freezeUsedThisWeek: boolean;
  /** `!freezeUsedThisWeek` — one freeze per Monday-local week. */
  freezeAvailable: boolean;
  /**
   * The newest link of the current chain crossed a frozen day, i.e. the most
   * recent run "used" a freeze to keep the streak alive (summary copy).
   */
  lastLinkFrozen: boolean;
  /**
   * The most recent active day is two days ago and yesterday's gap CAN be
   * frozen: the streak is alive only because a freeze will cover yesterday if
   * the user runs today.
   */
  freezePending: boolean;
};

const EMPTY_STREAK: StreakInfo = {
  current: 0,
  longest: 0,
  ranToday: false,
  freezeUsedThisWeek: false,
  freezeAvailable: true,
  lastLinkFrozen: false,
  freezePending: false,
};

/**
 * Day streaks with ONE freeze per Monday-local week, computed purely from run
 * history (no persisted counter).
 *
 * Walk unique active day keys newest → oldest. Consecutive days chain. A
 * single missed day between two active days is bridged when the freeze for
 * the WEEK OF THE MISSED DAY has not already been spent on this walk; the
 * frozen day does not add to the count. Two missed days in a row, or a second
 * single gap in the same week, break the chain. Day boundaries are local time.
 *
 * The current streak is alive when the latest active day is today, yesterday,
 * or the day before yesterday with yesterday freezable (`freezePending`).
 */
export function computeStreaksWithFreeze(timestamps: number[], now = Date.now()): StreakInfo {
  if (timestamps.length === 0) return EMPTY_STREAK;

  const uniqueDays = Array.from(new Set(timestamps.map(dayKey))).sort((a, b) =>
    a < b ? 1 : a > b ? -1 : 0
  );
  const today = dayKey(now);
  const thisWeek = weekKeyOf(today);
  const usedFreezeWeeks = new Set<string>();

  // One backward pass over all active days; chains are separated by breaks.
  const chains: { length: number; lastLinkFrozen: boolean }[] = [];
  let length = 1;
  let firstLinkFrozen = false;
  for (let i = 1; i < uniqueDays.length; i++) {
    const newer = uniqueDays[i - 1];
    const older = uniqueDays[i];
    const gap = daysBetween(newer, older);
    if (gap === 1) {
      length += 1;
      continue;
    }
    if (gap === 2) {
      const missedWeek = weekKeyOf(shiftDayKey(newer, -1));
      if (!usedFreezeWeeks.has(missedWeek)) {
        usedFreezeWeeks.add(missedWeek);
        if (length === 1 && chains.length === 0) firstLinkFrozen = true;
        length += 1;
        continue;
      }
    }
    chains.push({ length, lastLinkFrozen: chains.length === 0 && firstLinkFrozen });
    length = 1;
  }
  chains.push({ length, lastLinkFrozen: chains.length === 0 && firstLinkFrozen });

  const longest = chains.reduce((max, chain) => Math.max(max, chain.length), 0);

  const gapToLatest = daysBetween(today, uniqueDays[0]);
  const ranToday = gapToLatest === 0;
  let current = 0;
  let freezePending = false;
  if (gapToLatest === 0 || gapToLatest === 1) {
    current = chains[0].length;
  } else if (gapToLatest === 2) {
    // Yesterday was missed; the streak survives only if its week's freeze is free.
    const yesterdayWeek = weekKeyOf(shiftDayKey(today, -1));
    if (!usedFreezeWeeks.has(yesterdayWeek)) {
      current = chains[0].length;
      freezePending = true;
    }
  }

  // One freeze per calendar week, whether or not the chain it bridged survived.
  const freezeUsedThisWeek = usedFreezeWeeks.has(thisWeek);
  return {
    current,
    longest,
    ranToday,
    freezeUsedThisWeek,
    freezeAvailable: !freezeUsedThisWeek,
    lastLinkFrozen: current > 0 && chains[0].lastLinkFrozen,
    freezePending,
  };
}

/**
 * Current + longest day-streaks from run timestamps (freeze-aware; see
 * `computeStreaksWithFreeze`). The current streak stays alive as long as the
 * most recent active day is today or yesterday — or the day before with a
 * freeze available for yesterday.
 */
export function computeStreaks(timestamps: number[], now = Date.now()): { current: number; longest: number } {
  const { current, longest } = computeStreaksWithFreeze(timestamps, now);
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
// Aggregated per-class view model (consumed by the screens)
// ---------------------------------------------------------------------------

export type ClassData = {
  key: ClassKey;
  meta: ClassMeta;
  roster: string[];
  maps: ClassMapEntry[];
  /** Next incomplete map in this class campaign, or null when finished / gated. */
  nextLevelId: string | null;
  /** The first incomplete map when a skill/level gate holds it shut. */
  nextLocked: { levelId: string; index: number; reason: LockReason } | null;
  completedCount: number;
  total: number;
  allComplete: boolean;
  calories: number;
  runs: number;
};

export function buildClassData(
  key: ClassKey,
  roster: string[],
  runs: readonly { levelId?: unknown; calories?: unknown; classKey?: unknown; accuracy?: unknown }[],
  /**
   * Skill/level gate inputs. Omitted → max level and no beatmaps, i.e. only the
   * completion sequence gates (replay scripts). ProgressContext always passes it.
   */
  gateInput: { playerLevel: number; hasBeatmap: (levelId: string) => boolean } = {
    playerLevel: MAX_LEVEL,
    hasBeatmap: () => false,
  }
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
  const gate: CampaignGate = {
    classKey: key,
    playerLevel: gateInput.playerLevel,
    bestAccuracyInClass: bestAccuracyByLevelForClass(runs, key),
    hasBeatmap: gateInput.hasBeatmap,
  };
  const maps = resolveClassMaps(roster, completedInClass, gate);
  const calories = runsInClass.reduce((sum, r) => sum + r.calories, 0);
  const completedCount = maps.filter((m) => m.state === 'completed').length;
  return {
    key,
    meta: CLASS_META[key],
    roster: maps.map((map) => map.levelId),
    maps,
    nextLevelId: maps.find((m) => m.state === 'next')?.levelId ?? null,
    nextLocked: nextLockedMapInClass(maps),
    completedCount,
    total: maps.length,
    allComplete: maps.length > 0 && completedCount >= maps.length,
    calories,
    runs: runsInClass.length,
  };
}
