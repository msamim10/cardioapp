export const TRACKED_ACTIONS = ['Jump', 'Duck', 'Left', 'Right'] as const;
export type TrackedAction = (typeof TRACKED_ACTIONS)[number];
export type ActionCounts = Record<TrackedAction, number>;

export type ProgressRun = {
  at?: unknown;
  calories?: unknown;
  durationMin?: unknown;
  actionCounts?: unknown;
  xp?: unknown;
};

/** One deterministic level every 500 persisted XP. */
export const XP_PER_LEVEL = 500;
export type LevelProgress = {
  level: number;
  intoLevel: number;
  span: number;
  toNext: number;
  progress: number;
};

export function levelFromXp(xp: number): LevelProgress {
  const safe = finiteNonNegative(xp);
  const level = Math.floor(safe / XP_PER_LEVEL) + 1;
  const intoLevel = safe % XP_PER_LEVEL;
  return {
    level,
    intoLevel,
    span: XP_PER_LEVEL,
    toNext: XP_PER_LEVEL - intoLevel,
    progress: intoLevel / XP_PER_LEVEL,
  };
}

export type WeeklyActivity = {
  weekStart: number;
  dailyCalories: number[];
  currentCalories: number;
  comparisonCalories: number;
  changePercent: number | null;
  comparisonLabel: 'vs previous week' | 'vs same time last week';
};

export function emptyActionCounts(): ActionCounts {
  return { Jump: 0, Duck: 0, Left: 0, Right: 0 };
}

function finiteNonNegative(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function normalizeActionCounts(value: unknown): ActionCounts {
  if (!value || typeof value !== 'object') return emptyActionCounts();
  const source = value as Partial<Record<TrackedAction, unknown>>;
  return {
    Jump: Math.floor(finiteNonNegative(source.Jump)),
    Duck: Math.floor(finiteNonNegative(source.Duck)),
    Left: Math.floor(finiteNonNegative(source.Left)),
    Right: Math.floor(finiteNonNegative(source.Right)),
  };
}

export function countActions(value: unknown): number {
  return Object.values(normalizeActionCounts(value)).reduce((sum, count) => sum + count, 0);
}

export function aggregateLifetime(runs: readonly ProgressRun[]) {
  return runs.reduce<{
    calories: number;
    minutes: number;
    obstacles: number;
    runs: number;
    xp: number;
  }>(
    (totals, run) => ({
      calories: totals.calories + finiteNonNegative(run.calories),
      minutes: totals.minutes + finiteNonNegative(run.durationMin),
      obstacles: totals.obstacles + countActions(run.actionCounts),
      runs: totals.runs + 1,
      xp: totals.xp + finiteNonNegative(run.xp),
    }),
    { calories: 0, minutes: 0, obstacles: 0, runs: 0, xp: 0 },
  );
}

/** Monday 00:00 in the device's local calendar. */
export function calendarWeekStart(now: number): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date.getTime();
}

/**
 * Builds current-week bars and a fair comparison. During a partial week the
 * prior baseline is clipped to the same elapsed point, avoiding a misleading
 * comparison of (for example) Monday against all seven days of last week.
 */
export function aggregateWeeklyActivity(
  runs: readonly ProgressRun[],
  now = Date.now(),
): WeeklyActivity {
  const weekStart = calendarWeekStart(now);
  const nextWeekStart = new Date(weekStart);
  nextWeekStart.setDate(nextWeekStart.getDate() + 7);
  const previousWeekStart = new Date(weekStart);
  previousWeekStart.setDate(previousWeekStart.getDate() - 7);
  const elapsedInWeek = Math.max(0, Math.min(now - weekStart, nextWeekStart.getTime() - weekStart));
  const comparisonEndDate = new Date(now);
  comparisonEndDate.setDate(comparisonEndDate.getDate() - 7);
  const comparisonEnd = comparisonEndDate.getTime();
  const dailyCalories = Array.from({ length: 7 }, () => 0);
  let comparisonCalories = 0;

  for (const run of runs) {
    const at = finiteNonNegative(run.at);
    const calories = finiteNonNegative(run.calories);
    if (at >= weekStart && at <= now && at < nextWeekStart.getTime()) {
      let dayIndex = -1;
      for (let index = 0; index < 7; index += 1) {
        const dayStart = new Date(weekStart);
        dayStart.setDate(dayStart.getDate() + index);
        const followingDay = new Date(dayStart);
        followingDay.setDate(followingDay.getDate() + 1);
        if (at >= dayStart.getTime() && at < followingDay.getTime()) {
          dayIndex = index;
          break;
        }
      }
      if (dayIndex >= 0 && dayIndex < 7) dailyCalories[dayIndex] += calories;
    } else if (at >= previousWeekStart.getTime() && at <= comparisonEnd) {
      comparisonCalories += calories;
    }
  }

  const currentCalories = dailyCalories.reduce((sum, calories) => sum + calories, 0);
  const changePercent =
    comparisonCalories > 0
      ? Math.round(((currentCalories - comparisonCalories) / comparisonCalories) * 100)
      : null;
  const isCompleteWeek = elapsedInWeek >= nextWeekStart.getTime() - weekStart - 1;

  return {
    weekStart,
    dailyCalories,
    currentCalories,
    comparisonCalories,
    changePercent,
    comparisonLabel: isCompleteWeek ? 'vs previous week' : 'vs same time last week',
  };
}
