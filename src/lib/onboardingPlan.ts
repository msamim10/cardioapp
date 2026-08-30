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
 * 2. No physiological outcome claims. The figures are session volume and the
 *    reward multiplier the chosen tier already applies — arithmetic on the
 *    user's own stated commitment, not promised results.
 * 3. Every gauge states the denominator it fills against, and that denominator
 *    is a real ceiling (days in a week, the largest weekly option the app
 *    offers, the highest tier multiplier) rather than a number picked to make
 *    the arc look good.
 */

import type { IconName } from '@/lib/gameData';
import type {
  GoalKey,
  MotivationKey,
  OnboardingAnswers,
} from '@/lib/onboarding';
import { weeklyGoalOptions } from '@/lib/onboarding';
import {
  CLASS_META,
  CLASS_ORDER,
  classForMover,
  type ClassKey,
} from '@/lib/progression';

/** Matches the option flagged `recommended` in `weeklyGoalOptions`. */
const DEFAULT_SESSIONS_PER_WEEK = 4;

const DAYS_PER_WEEK = 7;
const WEEKS_PER_MONTH = 4;

/** Largest weekly commitment the goal picker offers, so ring two has a real ceiling. */
const MAX_SESSIONS_PER_WEEK = Math.max(...weeklyGoalOptions.map((option) => option.runs));

/** Highest reward multiplier any tier applies, so ring three has a real ceiling. */
const MAX_CLASS_MULTIPLIER = Math.max(
  ...CLASS_ORDER.map((key) => CLASS_META[key].multiplier),
);

/** Short, goal-derived framing. Deliberately no supporting sentence. */
const GOAL_EYEBROW: Record<GoalKey, string> = {
  lose: 'BUILT FOR CALORIE BURN',
  habit: 'BUILT FOR CONSISTENCY',
  active: 'BUILT FOR CONDITIONING',
  fun: 'BUILT TO NOT FEEL LIKE TRAINING',
};

const GOAL_HEADLINE: Record<GoalKey, string> = {
  lose: 'Your burn program',
  habit: 'Your consistency program',
  active: 'Your conditioning program',
  fun: 'Your no-grind program',
};

const MOTIVATION_CHIP: Record<MotivationKey, { label: string; icon: IconName }> = {
  compete: { label: 'Leaderboards on', icon: 'podium' },
  streaks: { label: 'Streak tracking on', icon: 'flame' },
  rewards: { label: 'Progression on', icon: 'diamond' },
  chill: { label: 'Pressure off', icon: 'leaf' },
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

export type PlanChip = {
  key: string;
  label: string;
  icon: IconName;
  fromAnswer: boolean;
};

export type OnboardingPlan = {
  eyebrow: string;
  headline: string;
  handle: string | null;
  classKey: ClassKey;
  sessionsPerWeek: number;
  firstMonthSessions: number;
  rings: PlanRing[];
  chips: PlanChip[];
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
  ];

  const motivation = answers.motivation
    ? MOTIVATION_CHIP[answers.motivation]
    : MOTIVATION_CHIP.streaks;

  const chips: PlanChip[] = [
    {
      key: 'motivation',
      label: motivation.label,
      icon: motivation.icon,
      fromAnswer: answers.motivation !== null,
    },
    {
      key: 'reminders',
      label: answers.reminders ? 'Reminders on' : 'Reminders off',
      icon: answers.reminders ? 'notifications' : 'notifications-off',
      fromAnswer: true,
    },
  ];

  return {
    eyebrow: answers.goal ? GOAL_EYEBROW[answers.goal] : 'YOUR STARTING SETUP',
    headline: answers.goal ? GOAL_HEADLINE[answers.goal] : 'Your program',
    handle: username,
    classKey,
    sessionsPerWeek,
    firstMonthSessions,
    rings,
    chips,
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
 * be three default gauges presented as personalisation, which undercuts the
 * offer that follows it, so the caller falls through to the paywall instead.
 */
export function shouldShowPlan(plan: OnboardingPlan): boolean {
  return plan.answeredCount > 0;
}
