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
  { key: 'lose', label: 'Lose weight', desc: 'Burn it off, one run at a time', accent: 'pink' },
  { key: 'habit', label: 'Build a habit', desc: 'Show up daily, keep the streak', accent: 'lime' },
  { key: 'active', label: 'Stay active', desc: 'Keep the body moving & healthy', accent: 'cyan' },
  { key: 'fun', label: 'Have fun & de-stress', desc: 'Play your way to a clear head', accent: 'violet' },
];

export const moverOptions: Option<MoverKey>[] = [
  { key: 'couch', label: 'Couch legend', desc: 'Just getting off the sofa', accent: 'violet' },
  { key: 'weekend', label: 'Weekend warrior', desc: 'Active when the mood hits', accent: 'cyan' },
  { key: 'daily', label: 'Daily grinder', desc: 'Moving is already my thing', accent: 'lime' },
  { key: 'comeback', label: 'Comeback story', desc: 'Getting back into it', accent: 'orange' },
];

export const motivationOptions: Option<MotivationKey>[] = [
  { key: 'compete', label: 'Competition', desc: 'Leaderboards & high scores', accent: 'orange' },
  { key: 'streaks', label: 'Streaks', desc: 'Never break the chain', accent: 'pink' },
  { key: 'rewards', label: 'Rewards', desc: 'Coins, unlocks & badges', accent: 'cyan' },
  { key: 'chill', label: 'Chill vibes', desc: 'Just me, moving, no pressure', accent: 'violet' },
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
  { runs: 3, label: '3 runs / week', desc: 'Easy to keep up', icon: 'leaf', accent: 'cyan' },
  { runs: 4, label: '4 runs / week', desc: 'Steady, balanced progress', icon: 'flash', accent: 'lime', recommended: true },
  { runs: 5, label: '5 runs / week', desc: 'Serious momentum', icon: 'barbell', accent: 'violet' },
  { runs: 6, label: '6 runs / week', desc: 'Go all in', icon: 'flame', accent: 'pink' },
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

export const ONBOARDING_STEPS: { id: StepId; principle: string }[] = [
  { id: 'welcome', principle: 'Social proof + identity framing (low-friction first tap)' },
  { id: 'goal', principle: 'Goal-setting + autonomy (choose your why)' },
  { id: 'mover', principle: 'Autonomy & identity framing (vs clinical fitness language)' },
  { id: 'worlds', principle: 'Endowment effect + excitement (pick worlds you own)' },
  { id: 'days', principle: 'Commitment & consistency (concrete weekly commitment)' },
  { id: 'motivation', principle: 'Autonomy — tailor the gamification to the user' },
  { id: 'reminders', principle: 'Loss-aversion framed around protecting a streak' },
];
