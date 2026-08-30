import Ionicons from '@expo/vector-icons/Ionicons';
import type { AccentKey } from '@/theme';
import { getMode, modes } from '@/lib/gameData';
import { getModeCover } from '@/lib/modeCovers';

/**
 * Onboarding data model + question definitions.
 *
 * Each question step below notes the persuasion principle it leans on so the
 * flow stays intentional rather than a generic form. See ONBOARDING_STEPS.
 */

export type GoalKey = 'lose' | 'habit' | 'active' | 'fun';
export type MoverKey = 'couch' | 'weekend' | 'daily' | 'comeback';
export type MotivationKey = 'compete' | 'streaks' | 'rewards' | 'chill';
export type AttributionKey = 'instagram' | 'tiktok' | 'twitter' | 'appstore' | 'friends' | 'other';

export type OnboardingAnswers = {
  attribution: AttributionKey | null;
  goal: GoalKey | null;
  mover: MoverKey | null;
  worlds: string[]; // optional legacy mode ids; new showcase flow leaves this empty
  daysPerWeek: number | null; // weekly run goal — set by the goal-picker screen
  sessionMin: number | null; // legacy persisted answer; no longer collected during onboarding
  motivation: MotivationKey | null;
  reminders: boolean; // notifications opt-in — set by the notifications screen
};

export const defaultAnswers: OnboardingAnswers = {
  attribution: null,
  goal: null,
  mover: null,
  worlds: [],
  daysPerWeek: null,
  sessionMin: null,
  motivation: null,
  reminders: false,
};

type IconName = keyof typeof Ionicons.glyphMap;

export type Option<T extends string> = {
  key: T;
  label: string;
  desc?: string;
  icon?: IconName;
  accent: AccentKey;
};

export const goalOptions: Option<GoalKey>[] = [
  { key: 'lose', label: 'Lose weight', desc: 'Burn calories every session', accent: 'pink' },
  { key: 'habit', label: 'Build the habit', desc: 'Show up on schedule, hold the streak', accent: 'lime' },
  { key: 'active', label: 'Stay conditioned', desc: 'Keep your base cardio fitness', accent: 'cyan' },
  { key: 'fun', label: 'Train without the grind', desc: 'Cardio that holds your attention', accent: 'violet' },
];

export const moverOptions: Option<MoverKey>[] = [
  { key: 'couch', label: 'Starting from zero', desc: 'No regular training right now', accent: 'violet' },
  { key: 'weekend', label: 'On and off', desc: 'A session here and there', accent: 'cyan' },
  { key: 'daily', label: 'Already training', desc: 'Movement is part of my week', accent: 'lime' },
  { key: 'comeback', label: 'Getting back in', desc: 'Rebuilding after a break', accent: 'orange' },
];

export const motivationOptions: Option<MotivationKey>[] = [
  { key: 'compete', label: 'Competition', desc: 'Leaderboards & high scores', accent: 'orange' },
  { key: 'streaks', label: 'Consistency', desc: 'Never break the chain', accent: 'pink' },
  { key: 'rewards', label: 'Progression', desc: 'Coins, unlocks & badges', accent: 'cyan' },
  { key: 'chill', label: 'Low pressure', desc: 'Just moving, on my own terms', accent: 'violet' },
];

export const daysOptions = [2, 3, 4, 5, 6] as const;

/**
 * Attribution channels for the "Where did you hear about us?" screen. Each brand
 * uses its closest available vector-icon glyph (Ionicons) so the list stays
 * icon-based rather than plain text.
 */
export const attributionOptions: {
  key: AttributionKey;
  label: string;
  icon: IconName;
  accent: AccentKey;
}[] = [
  { key: 'instagram', label: 'Instagram', icon: 'logo-instagram', accent: 'pink' },
  { key: 'tiktok', label: 'TikTok', icon: 'logo-tiktok', accent: 'cyan' },
  { key: 'twitter', label: 'Twitter / X', icon: 'logo-x', accent: 'cyan' },
  { key: 'appstore', label: 'App Store', icon: 'logo-apple-appstore', accent: 'violet' },
  { key: 'friends', label: 'Friends & Family', icon: 'people', accent: 'lime' },
  { key: 'other', label: 'Other', icon: 'chatbubble-ellipses', accent: 'orange' },
];

/**
 * Weekly run goal options (runs per week). Drives `weeklyGoal` in ProgressContext
 * and the Home weekly tracker. One option is flagged as recommended.
 */
export const weeklyGoalOptions: {
  runs: number;
  label: string;
  desc: string;
  icon: IconName;
  accent: AccentKey;
  recommended?: boolean;
}[] = [
  { runs: 3, label: '3 sessions / week', desc: 'Sustainable baseline', icon: 'leaf', accent: 'cyan' },
  { runs: 4, label: '4 sessions / week', desc: 'Steady, balanced progress', icon: 'flash', accent: 'lime', recommended: true },
  { runs: 5, label: '5 sessions / week', desc: 'Real conditioning load', icon: 'barbell', accent: 'violet' },
  { runs: 6, label: '6 sessions / week', desc: 'Maximum commitment', icon: 'flame', accent: 'pink' },
];

/** All canonical worlds remain available for persisted answers and plan copy. */
export const worldOptions = modes.map((mode) => ({
  id: mode.id,
  name: mode.name,
  accent: mode.accent,
}));

/**
 * Six recognizable canonical levels, led by the same three objects shown by
 * Home's "Popular this week" row. Selection still persists the existing
 * mode/level id, while the cover resolves through the exact helper used by
 * Home, Levels, and All Maps.
 */
const FEATURED_WORLD_IDS = [
  'neon-rails',
  'prison-escape-run',
  'dino-escape',
  'pixel-kingdom',
  'neon-beat-hunters',
  'wild-city',
] as const;

export const featuredWorldOptions = FEATURED_WORLD_IDS.map((id) => {
  const mode = getMode(id);
  if (!mode) {
    throw new Error(`Missing featured onboarding mode: ${id}`);
  }
  const level = mode.levels.find((candidate) => candidate.id === id) ?? mode.levels[0];
  if (!level) {
    throw new Error(`Missing featured onboarding level: ${id}`);
  }
  const cover = getModeCover(level.id);
  if (!cover) {
    throw new Error(`Missing featured onboarding cover: ${id}`);
  }
  return {
    id: level.id,
    name: level.name,
    cover,
  };
});

// ---------------------------------------------------------------------------
// Step metadata (used for the report + to keep intent visible in code).
// ---------------------------------------------------------------------------

export type StepId =
  | 'welcome'
  | 'goal'
  | 'mover'
  | 'worlds'
  | 'days'
  | 'motivation'
  | 'reminders';

/**
 * Ordered onboarding screens, and the single source of truth for the progress
 * bar. Screens previously hardcoded their own fraction, which drifted out of
 * order as the flow changed: `questions` ended at 0.52 while `username` — the
 * screen straight after it — claimed 0.42, so the bar visibly ran backwards.
 * Deriving the fraction from position makes that class of bug impossible.
 *
 * `welcome` is excluded because it has no progress bar, and the hosted paywall
 * is excluded because it is native UI we do not chrome.
 */
export const ONBOARDING_SCREENS = [
  'attribution',
  'questions',
  'username',
  'climb',
  'goal',
  'notifications',
  'gameplay-showcase',
  'create-account',
  'plan',
] as const;

export type OnboardingScreenId = (typeof ONBOARDING_SCREENS)[number];

/**
 * Fraction complete on arriving at a screen. The first screen starts partly
 * filled (the user already tapped through welcome) and the last lands short of
 * full, because the offer still follows.
 */
export function onboardingProgress(screen: OnboardingScreenId): number {
  const index = ONBOARDING_SCREENS.indexOf(screen);
  if (index < 0) return 0;
  return (index + 1) / (ONBOARDING_SCREENS.length + 1);
}

/**
 * Progress across a multi-question screen, spanning that screen's slice up to
 * the next screen's value so the bar stays monotonic through the sub-steps.
 */
export function onboardingStepProgress(
  screen: OnboardingScreenId,
  index: number,
  count: number,
): number {
  const start = onboardingProgress(screen);
  const nextIndex = ONBOARDING_SCREENS.indexOf(screen) + 1;
  const end =
    nextIndex < ONBOARDING_SCREENS.length
      ? onboardingProgress(ONBOARDING_SCREENS[nextIndex])
      : 1;
  if (count <= 1) return start;
  return start + (Math.min(index, count - 1) / count) * (end - start);
}

export const ONBOARDING_STEPS: { id: StepId; principle: string }[] = [
  { id: 'welcome', principle: 'Social proof + identity framing (low-friction first tap)' },
  { id: 'goal', principle: 'Goal-setting + autonomy (choose your why)' },
  { id: 'mover', principle: 'Autonomy & identity framing (vs clinical fitness language)' },
  { id: 'worlds', principle: 'Endowment effect + excitement (pick worlds you own)' },
  { id: 'days', principle: 'Commitment & consistency (concrete weekly commitment)' },
  { id: 'motivation', principle: 'Autonomy — tailor the gamification to the user' },
  { id: 'reminders', principle: 'Loss-aversion framed around protecting a streak' },
];
