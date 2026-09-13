/**
 * Player levels 1–50 on a cumulative XP curve, plus the static reward table
 * (badges + HUD themes) that levels unlock.
 *
 *   T(L) = round(300 × (L − 1)^1.5)      cumulative XP required to BE level L
 *
 *   L1 = 0, L2 = 300, L3 = 849, L5 = 2,400, L10 = 8,100, L25 = 35,273,
 *   L50 = 102,900. Level 50 is the cap: XP keeps accumulating but the level
 *   and the progress bar stay pinned.
 *
 * XP itself is unchanged — it is still the sum of persisted `RunRecord.xp`
 * (see `rewardForRunPerformance`). Only the mapping from XP to level moved
 * off the old flat 500-per-level line.
 *
 * Grandfathering: the flat curve was more generous past ~1,500 XP, so an
 * existing user could have dropped a level at the switch. ProgressContext
 * computes `legacyLevelFor(xp)` ONCE on the first launch after the upgrade
 * and persists it as `legacyLevelFloor`; the displayed level is
 * `max(curveLevel, legacyLevelFloor)` from then on. Unlocked rewards derive
 * from that effective level, so nobody visibly loses a level or a reward.
 *
 * Nothing here imports app modules, so the replay script can load it in Node.
 */

export const MAX_LEVEL = 50;
export const MIN_LEVEL = 1;
export const LEVEL_CURVE_BASE_XP = 300;
export const LEVEL_CURVE_EXPONENT = 1.5;
/** The pre-curve flat model (one level every 500 XP), kept for grandfathering only. */
export const LEGACY_XP_PER_LEVEL = 500;

function finiteNonNegative(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
}

/** Clamp any numeric input into the 1–50 level range (garbage → 1). */
export function clampLevel(level: unknown): number {
  if (typeof level !== 'number' || !Number.isFinite(level)) return MIN_LEVEL;
  return Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, Math.floor(level)));
}

/** Cumulative XP threshold to be level `L` (L is clamped to 1–50). */
export function xpForLevel(level: number): number {
  const safe = clampLevel(level);
  return Math.round(LEVEL_CURVE_BASE_XP * Math.pow(safe - 1, LEVEL_CURVE_EXPONENT));
}

/** Highest level whose threshold is ≤ `xp`, capped at 50. */
export function levelFromXp(xp: number): number {
  const safe = finiteNonNegative(xp);
  // Invert T(L) analytically, then correct for rounding at the boundary.
  let level = Math.floor(Math.pow(safe / LEVEL_CURVE_BASE_XP, 1 / LEVEL_CURVE_EXPONENT)) + 1;
  level = clampLevel(level);
  while (level < MAX_LEVEL && xpForLevel(level + 1) <= safe) level += 1;
  while (level > MIN_LEVEL && xpForLevel(level) > safe) level -= 1;
  return level;
}

/** What the flat 500-per-level model displayed for this XP (capped at 50). */
export function legacyLevelFor(xp: number): number {
  return clampLevel(Math.floor(finiteNonNegative(xp) / LEGACY_XP_PER_LEVEL) + 1);
}

/** `max(curveLevel, floor)` — the level the user actually sees. */
export function effectiveLevel(xp: number, legacyLevelFloor = MIN_LEVEL): number {
  return Math.max(levelFromXp(xp), clampLevel(legacyLevelFloor));
}

export type LevelProgress = {
  /** Effective level, 1–50. */
  level: number;
  /** XP earned inside the current level (0 when a legacy floor is holding the level up). */
  current: number;
  /** XP span of the current level (0 at the cap). */
  needed: number;
  /** current / needed, 0–1 (1 at the cap). */
  fraction: number;
  /** XP still required for the next level (0 at the cap). */
  toNext: number;
  isMax: boolean;
};

/**
 * Progress inside the effective level. With a legacy floor above the curve
 * level the bar sits at 0 and `toNext` counts up to the floor's next threshold,
 * so the user sees "N XP to level floor+1" rather than a phantom regression.
 */
export function progressWithinLevel(xp: number, legacyLevelFloor = MIN_LEVEL): LevelProgress {
  const safe = finiteNonNegative(xp);
  const level = effectiveLevel(safe, legacyLevelFloor);
  if (level >= MAX_LEVEL) {
    return { level, current: 0, needed: 0, fraction: 1, toNext: 0, isMax: true };
  }
  const start = xpForLevel(level);
  const end = xpForLevel(level + 1);
  const needed = end - start;
  const current = Math.min(needed, Math.max(0, safe - start));
  return {
    level,
    current,
    needed,
    fraction: needed > 0 ? current / needed : 1,
    toNext: Math.max(0, end - safe),
    isMax: false,
  };
}

// ---------------------------------------------------------------------------
// Level rewards
// ---------------------------------------------------------------------------

export type LevelBadge = {
  id: string;
  title: string;
  detail: string;
  /** Ionicons glyph name (typed loosely so this module stays import-free). */
  icon: string;
};

export type LevelReward = {
  badge?: LevelBadge;
  /** Id of a palette in `hudThemes.ts`. */
  hudThemeId?: string;
};

/**
 * Static reward table. Badges at 2, 5, 10, 15, 20, 30, 40, 50; HUD themes at
 * 3, 8, 12, 18, 25, 35, 45. Rewards are DERIVED from the effective level
 * every render — never persisted — so they survive resets of the reward table
 * and grandfathered levels keep what they show.
 */
export const LEVEL_REWARDS: Readonly<Record<number, LevelReward>> = {
  2: {
    badge: { id: 'first-stride', title: 'First Stride', detail: 'Level 2 reached.', icon: 'footsteps' },
  },
  3: { hudThemeId: 'glacier' },
  5: {
    badge: { id: 'cadence', title: 'Cadence', detail: 'Level 5. The rhythm is yours.', icon: 'pulse' },
  },
  8: { hudThemeId: 'ember' },
  10: {
    badge: { id: 'trailblazer', title: 'Trailblazer', detail: 'Level 10. Double digits.', icon: 'trail-sign' },
  },
  12: { hudThemeId: 'ultraviolet' },
  15: {
    badge: { id: 'summit', title: 'Summit', detail: 'Level 15 climbed.', icon: 'triangle' },
  },
  18: { hudThemeId: 'rose' },
  20: {
    badge: { id: 'velocity', title: 'Velocity', detail: 'Level 20. Built for speed.', icon: 'speedometer' },
  },
  25: { hudThemeId: 'gold' },
  30: {
    badge: { id: 'endurance', title: 'Endurance', detail: 'Level 30. Distance is a habit.', icon: 'infinite' },
  },
  35: { hudThemeId: 'mint' },
  40: {
    badge: { id: 'vanguard', title: 'Vanguard', detail: 'Level 40. Out in front.', icon: 'flag' },
  },
  45: { hudThemeId: 'carbon' },
  50: {
    badge: { id: 'legend', title: 'Legend', detail: 'Level 50. The cap, cleared.', icon: 'trophy' },
  },
};

/** Ascending list of levels that carry a reward. */
export const REWARD_LEVELS: readonly number[] = Object.keys(LEVEL_REWARDS)
  .map(Number)
  .sort((a, b) => a - b);

export function rewardForLevel(level: number): LevelReward | null {
  return LEVEL_REWARDS[clampLevel(level)] ?? null;
}

/** Rewards granted strictly after `fromLevel` up to and including `toLevel`. */
export function rewardsBetween(fromLevel: number, toLevel: number): { level: number; reward: LevelReward }[] {
  const from = clampLevel(fromLevel);
  const to = clampLevel(toLevel);
  if (to <= from) return [];
  return REWARD_LEVELS.filter((level) => level > from && level <= to).map((level) => ({
    level,
    reward: LEVEL_REWARDS[level],
  }));
}

/** Every level badge, with whether the given effective level has unlocked it. */
export function levelBadges(level: number): { level: number; badge: LevelBadge; unlocked: boolean }[] {
  const safe = clampLevel(level);
  return REWARD_LEVELS.flatMap((rewardLevel) => {
    const badge = LEVEL_REWARDS[rewardLevel].badge;
    return badge ? [{ level: rewardLevel, badge, unlocked: safe >= rewardLevel }] : [];
  });
}

/** Level at which a HUD theme unlocks; 1 for themes not in the table (the default). */
export function unlockLevelForHudTheme(hudThemeId: string): number {
  for (const level of REWARD_LEVELS) {
    if (LEVEL_REWARDS[level].hudThemeId === hudThemeId) return level;
  }
  return MIN_LEVEL;
}

export function isHudThemeUnlocked(hudThemeId: string, level: number): boolean {
  return clampLevel(level) >= unlockLevelForHudTheme(hudThemeId);
}

/** The next level (above `level`) that carries a reward, or null past the last one. */
export function nextRewardLevel(level: number): number | null {
  const safe = clampLevel(level);
  return REWARD_LEVELS.find((rewardLevel) => rewardLevel > safe) ?? null;
}
