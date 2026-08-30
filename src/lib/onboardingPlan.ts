/**
 * Derives the pre-paywall plan summary from the answers onboarding actually
 * collected. Kept pure and separate from the screen so the mapping from answer
 * to claim is auditable in one place.
 *
 * Two rules constrain everything here:
 *
 * 1. Every line must trace to a stored answer. The screen's whole mechanism is
 *    the user recognising their own input, so filler would be worse than
 *    nothing. `answeredCount` reports how much is real, and `shouldShowPlan`
 *    suppresses the screen when there is nothing to reflect.
 * 2. No physiological outcome claims. The only number derived here is session
 *    volume, which is arithmetic on the user's own stated commitment rather
 *    than a promised result, so it needs no substantiation.
 */

import type { IconName } from '@/lib/gameData';
import type { GoalKey, MotivationKey, MoverKey, OnboardingAnswers } from '@/lib/onboarding';
import { CLASS_META, classForMover, type ClassKey } from '@/lib/progression';

/** Matches the option flagged `recommended` in `weeklyGoalOptions`. */
const DEFAULT_SESSIONS_PER_WEEK = 4;

const WEEKS_PER_MONTH = 4;

type GoalCopy = {
  eyebrow: string;
  headline: string;
  /** What the program optimises for, phrased as structure rather than outcome. */
  emphasis: string;
};

const GOAL_COPY: Record<GoalKey, GoalCopy> = {
  lose: {
    eyebrow: 'BUILT FOR CALORIE BURN',
    headline: 'Your burn program',
    emphasis: 'Longer sessions at a working pace, so every run is a real calorie session.',
  },
  habit: {
    eyebrow: 'BUILT FOR CONSISTENCY',
    headline: 'Your consistency program',
    emphasis: 'A fixed weekly rhythm with streak tracking, so showing up is the win.',
  },
  active: {
    eyebrow: 'BUILT FOR CONDITIONING',
    headline: 'Your conditioning program',
    emphasis: 'Steady weekly volume that holds your cardio base without burning you out.',
  },
  fun: {
    eyebrow: 'BUILT TO NOT FEEL LIKE TRAINING',
    headline: 'Your no-grind program',
    emphasis: 'New worlds on rotation, so the session ends before the boredom starts.',
  },
};

const FALLBACK_GOAL_COPY: GoalCopy = {
  eyebrow: 'YOUR STARTING SETUP',
  headline: 'Your program',
  emphasis: 'A steady weekly rhythm you can tune once you have a few sessions logged.',
};

const MOVER_COPY: Record<MoverKey, string> = {
  couch: 'Starting from zero',
  weekend: 'Training on and off',
  daily: 'Already training',
  comeback: 'Getting back in',
};

const MOTIVATION_COPY: Record<MotivationKey, { label: string; detail: string; icon: IconName }> = {
  compete: {
    label: 'Leaderboards on',
    detail: 'Weekly rankings against other players',
    icon: 'podium',
  },
  streaks: {
    label: 'Streak tracking on',
    detail: 'Daily chain, protected by reminders',
    icon: 'flame',
  },
  rewards: {
    label: 'Progression on',
    detail: 'Coins, unlocks and badges as you go',
    icon: 'diamond',
  },
  chill: {
    label: 'Pressure off',
    detail: 'No streak nags, no rankings pushed at you',
    icon: 'leaf',
  },
};

export type PlanRow = {
  key: string;
  label: string;
  detail: string;
  icon: IconName;
  /** False when the row is a sensible default rather than a stored answer. */
  fromAnswer: boolean;
};

export type OnboardingPlan = {
  eyebrow: string;
  headline: string;
  emphasis: string;
  handle: string | null;
  classKey: ClassKey;
  sessionsPerWeek: number;
  firstMonthSessions: number;
  rows: PlanRow[];
  /** How many of the four personalisation answers were actually stored. */
  answeredCount: number;
};

export function buildOnboardingPlan(
  answers: OnboardingAnswers,
  username: string | null,
): OnboardingPlan {
  const goalCopy = answers.goal ? GOAL_COPY[answers.goal] : FALLBACK_GOAL_COPY;
  const classKey = classForMover(answers.mover);
  const classMeta = CLASS_META[classKey];
  const sessionsPerWeek = answers.daysPerWeek ?? DEFAULT_SESSIONS_PER_WEEK;
  const motivation = answers.motivation
    ? MOTIVATION_COPY[answers.motivation]
    : MOTIVATION_COPY.streaks;

  const rows: PlanRow[] = [
    {
      key: 'load',
      label: `${sessionsPerWeek} sessions per week`,
      detail:
        answers.daysPerWeek === null
          ? 'A balanced starting load — change it any time'
          : 'The weekly load you committed to',
      icon: 'calendar',
      fromAnswer: answers.daysPerWeek !== null,
    },
    {
      key: 'class',
      label: `Starting at ${classMeta.label}`,
      detail: answers.mover
        ? `${MOVER_COPY[answers.mover]} · ${classMeta.tagline}`
        : `${classMeta.tagline} — you can move up whenever`,
      icon: classMeta.icon,
      fromAnswer: answers.mover !== null,
    },
    {
      key: 'motivation',
      label: motivation.label,
      detail: motivation.detail,
      icon: motivation.icon,
      fromAnswer: answers.motivation !== null,
    },
    {
      key: 'reminders',
      label: answers.reminders ? 'Reminders on' : 'Reminders off',
      detail: answers.reminders
        ? 'A nudge on your training days'
        : 'Turn them on later in your profile',
      icon: answers.reminders ? 'notifications' : 'notifications-off',
      fromAnswer: true,
    },
  ];

  return {
    eyebrow: goalCopy.eyebrow,
    headline: goalCopy.headline,
    emphasis: goalCopy.emphasis,
    handle: username,
    classKey,
    sessionsPerWeek,
    firstMonthSessions: sessionsPerWeek * WEEKS_PER_MONTH,
    rows,
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
 * be four default rows presented as personalisation, which undercuts the offer
 * that follows it, so the caller falls through to the paywall instead.
 */
export function shouldShowPlan(plan: OnboardingPlan): boolean {
  return plan.answeredCount > 0;
}
