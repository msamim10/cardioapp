/**
 * Derives the pre-paywall plan readout from the answers onboarding actually
 * collected. Kept pure and separate from the screen so the mapping from answer
 * to displayed figure is auditable in one place.
 *
 * Three rules constrain everything here:
 *
 * 1. Every figure must trace to a stored answer. The screen's whole mechanism is
 *    the user recognising their own input, so filler would be worse than
 *    nothing. `answeredCount` reports how much is real, and `shouldShowPlan`
 *    suppresses the screen when there is nothing to reflect.
 * 2. No physiological outcome claims. The figures are session volume, the
 *    reward multiplier the chosen tier already applies, and the coins that
 *    multiplier pays out across the stated week — arithmetic on the user's own
 *    stated commitment, not promised results.
 * 3. Every gauge states the denominator it fills against, and that denominator
 *    is a real ceiling (days in a week, the largest weekly option the app
 *    offers, the highest tier multiplier, and what those two together would
 *    pay) rather than a number picked to make the arc look good.
 */

import { modes } from '@/lib/gameData';
import type { GoalKey, OnboardingAnswers } from '@/lib/onboarding';
import { weeklyGoalOptions } from '@/lib/onboarding';
import {
  CLASS_META,
  CLASS_ORDER,
  classForMover,
  rewardForRun,
  type ClassKey,
} from '@/lib/progression';

/** Matches the option flagged `recommended` in `weeklyGoalOptions`. */
const DEFAULT_SESSIONS_PER_WEEK = 4;

const DAYS_PER_WEEK = 7;
const WEEKS_PER_MONTH = 4;

/** Largest weekly commitment the goal picker offers, so ring two has a real ceiling. */
const MAX_SESSIONS_PER_WEEK = Math.max(...weeklyGoalOptions.map((option) => option.runs));

/** Highest-paying tier, so rings three and four fill against real ceilings. */
const TOP_CLASS: ClassKey = CLASS_ORDER.reduce((top, key) =>
  CLASS_META[key].multiplier > CLASS_META[top].multiplier ? key : top,
);

const MAX_CLASS_MULTIPLIER = CLASS_META[TOP_CLASS].multiplier;

/**
 * Median length of the maps actually shipped in the catalogue. Ring four is a
 * per-run reward scaled by the user's own weekly count and tier, so the run it
 * scales has to be a real one rather than a round number chosen for the figure.
 */
const RUN_MINUTES = modes
  .flatMap((mode) => mode.levels.map((level) => level.durationMin))
  .sort((a, b) => a - b);
const TYPICAL_RUN_MIN = RUN_MINUTES[Math.floor(RUN_MINUTES.length / 2)] ?? 5;

/** What the top tier at the largest weekly commitment would earn. */
const MAX_WEEKLY_COINS =
  MAX_SESSIONS_PER_WEEK * rewardForRun(TYPICAL_RUN_MIN, TOP_CLASS).coins;

const GOAL_HEADLINE: Record<GoalKey, string> = {
  lose: 'Your burn program',
  habit: 'Your consistency program',
  active: 'Your conditioning program',
  fun: 'Your no-grind program',
};

export type PlanRing = {
  key: string;
  /** Large figure at the centre of the gauge. */
  value: string;
  /** Integer to count up to on mount; null renders `value` without counting. */
  countTo: number | null;
  /** Suffix appended to the counted figure, e.g. a multiplier sign. */
  suffix: string;
  label: string;
  /** The ceiling the arc fills against, stated to the user. */
  denominator: string;
  /** Arc fill, 0..1. */
  fraction: number;
  /** False when the figure is a sensible default rather than a stored answer. */
  fromAnswer: boolean;
};

export type OnboardingPlan = {
  headline: string;
  handle: string | null;
  classKey: ClassKey;
  sessionsPerWeek: number;
  firstMonthSessions: number;
  weeklyCoins: number;
  rings: PlanRing[];
  /** How many of the four personalisation answers were actually stored. */
  answeredCount: number;
};

const clampFraction = (value: number) => Math.max(0, Math.min(1, value));

export function buildOnboardingPlan(
  answers: OnboardingAnswers,
  username: string | null,
): OnboardingPlan {
  const classKey = classForMover(answers.mover);
  const classMeta = CLASS_META[classKey];
  const sessionsPerWeek = answers.daysPerWeek ?? DEFAULT_SESSIONS_PER_WEEK;
  const firstMonthSessions = sessionsPerWeek * WEEKS_PER_MONTH;
  const maxFirstMonthSessions = MAX_SESSIONS_PER_WEEK * WEEKS_PER_MONTH;
  const hasWeeklyGoal = answers.daysPerWeek !== null;
  const weeklyCoins = sessionsPerWeek * rewardForRun(TYPICAL_RUN_MIN, classKey).coins;

  const rings: PlanRing[] = [
    {
      key: 'weekly',
      value: String(sessionsPerWeek),
      countTo: sessionsPerWeek,
      suffix: '',
      label: 'Sessions / week',
      denominator: `of ${DAYS_PER_WEEK} days`,
      fraction: clampFraction(sessionsPerWeek / DAYS_PER_WEEK),
      fromAnswer: hasWeeklyGoal,
    },
    {
      key: 'month',
      value: String(firstMonthSessions),
      countTo: firstMonthSessions,
      suffix: '',
      label: 'First month',
      denominator: `of ${maxFirstMonthSessions} max`,
      fraction: clampFraction(firstMonthSessions / maxFirstMonthSessions),
      fromAnswer: hasWeeklyGoal,
    },
    {
      key: 'tier',
      value: `${classMeta.multiplier}×`,
      countTo: null,
      suffix: '×',
      label: 'Reward rate',
      denominator: classMeta.label,
      fraction: clampFraction(classMeta.multiplier / MAX_CLASS_MULTIPLIER),
      fromAnswer: answers.mover !== null,
    },
    {
      key: 'coins',
      value: String(weeklyCoins),
      countTo: weeklyCoins,
      suffix: '',
      label: 'Coins / week',
      denominator: `of ${MAX_WEEKLY_COINS} max`,
      fraction: clampFraction(weeklyCoins / MAX_WEEKLY_COINS),
      fromAnswer: hasWeeklyGoal && answers.mover !== null,
    },
  ];

  return {
    headline: answers.goal ? GOAL_HEADLINE[answers.goal] : 'Your program',
    handle: username,
    classKey,
    sessionsPerWeek,
    firstMonthSessions,
    weeklyCoins,
    rings,
    answeredCount: [
      answers.goal,
      answers.mover,
      answers.motivation,
      answers.daysPerWeek,
    ].filter((answer) => answer !== null).length,
  };
}

/**
 * Whether the plan beat is worth showing. With nothing stored the screen would
 * be four default gauges presented as personalisation, which undercuts the
 * offer that follows it, so the caller falls through to the paywall instead.
 */
export function shouldShowPlan(plan: OnboardingPlan): boolean {
  return plan.answeredCount > 0;
}
