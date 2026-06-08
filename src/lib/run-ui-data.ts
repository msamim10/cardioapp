import type { ImageSourcePropType } from 'react-native';
import type { FitnessLevel, UserProfile } from './types';

export type UiAccent = 'pink' | 'lime' | 'cyan' | 'orange' | 'purple' | 'blue';

export type UiIconKind =
  | 'home'
  | 'play'
  | 'challenge'
  | 'progress'
  | 'profile'
  | 'settings'
  | 'search'
  | 'coin'
  | 'plus'
  | 'fire'
  | 'bolt'
  | 'timer'
  | 'trophy'
  | 'chart'
  | 'runner'
  | 'shoe'
  | 'jump'
  | 'duck'
  | 'left'
  | 'right'
  | 'music'
  | 'sound'
  | 'space'
  | 'check'
  | 'arrow'
  | 'heart'
  | 'users'
  | 'medical';

export type RunnerUser = {
  id: string;
  name: string;
  title: string;
  level: number;
  xp: number;
  nextLevelXp: number;
  streakDays: number;
  coins: number;
  avatarImage: ImageSourcePropType;
  followers: number;
  following: number;
  totalRuns: number;
};

export type RunMode = {
  id: string;
  title: string;
  subtitle: string;
  durationMin: number;
  calorieRange: string;
  level: FitnessLevel | 'endless';
  image: ImageSourcePropType;
  accent: UiAccent;
  icon: UiIconKind;
  rewardCoins: number;
  tags: string[];
  route?: string;
  imageHasText?: boolean;
  imagePosition?: 'center' | 'left center' | 'top center';
};

export type Challenge = {
  id: string;
  title: string;
  subtitle: string;
  rewardCoins: number;
  progress: number;
  target: number;
  image: ImageSourcePropType;
  accent: UiAccent;
  icon: UiIconKind;
  imageHasText?: boolean;
};

export type MetricCardData = {
  id: string;
  label: string;
  value: string;
  detail?: string;
  icon: UiIconKind;
  accent: UiAccent;
  trend?: number[];
};

export type MoveCardData = {
  id: string;
  title: string;
  subtitle: string;
  icon: UiIconKind;
  accent: UiAccent;
  image?: ImageSourcePropType;
  imageHasText?: boolean;
  imageCrop?: 'left' | 'top' | 'center';
};

export type ReadinessItem = {
  id: string;
  title: string;
  subtitle: string;
  icon: UiIconKind;
  accent: UiAccent;
  ready: boolean;
};

export type Achievement = {
  id: string;
  title: string;
  subtitle: string;
  icon: UiIconKind;
  accent: UiAccent;
  progress?: number;
  target?: number;
  completed?: boolean;
};

export type WeeklyActivity = {
  day: string;
  calories: number | null;
};

export type RecentRun = {
  id: string;
  dateLabel: string;
  distanceKm: number;
  calories: number;
  image: ImageSourcePropType;
};

export type RunnerUiData = {
  user: RunnerUser;
  homeHeroImage: ImageSourcePropType;
  quickDurations: { id: string; label: string; minutes: number; icon: UiIconKind; accent: UiAccent }[];
  featuredMode: RunMode;
  modes: RunMode[];
  recommendedRuns: RunMode[];
  dailyChallenge: Challenge;
  challenges: Challenge[];
  homeStats: MetricCardData[];
  progressStats: MetricCardData[];
  moves: MoveCardData[];
  readiness: ReadinessItem[];
  achievements: Achievement[];
  personalBests: MetricCardData[];
  weeklyActivity: WeeklyActivity[];
  recentRuns: RecentRun[];
  badges: Achievement[];
  workoutGoals: Achievement[];
  settings: { id: string; label: string; icon: UiIconKind }[];
};

export type RuntimeSummary = {
  count: number;
  totalSec: number;
  totalCalories: number;
  totalCoins: number;
  longestSec: number;
};

export type RunnerRuntimeInput = {
  profile: UserProfile;
  summary: RuntimeSummary;
  streakDays: number;
};

const assets = {
  avatar: require('../../assets/images/real1.png') as ImageSourcePropType,
  hero: require('../../assets/images/top1.png') as ImageSourcePropType,
  featured: require('../../assets/images/real.png') as ImageSourcePropType,
  topBanner: require('../../assets/images/topbanner.png') as ImageSourcePropType,
  dailyChallenge: require('../../assets/images/chal.png') as ImageSourcePropType,
  endless: require('../../assets/images/m.png') as ImageSourcePropType,
  sprint: require('../../assets/images/n.png') as ImageSourcePropType,
  fatBurn: require('../../assets/images/x.png') as ImageSourcePropType,
  friends: require('../../assets/images/c.png') as ImageSourcePropType,
  city: require('../../assets/images/real1.png') as ImageSourcePropType,
  beach: require('../../assets/images/real2.png') as ImageSourcePropType,
  challengeOne: require('../../assets/images/ch1.png') as ImageSourcePropType,
  challengeTwo: require('../../assets/images/ch2.png') as ImageSourcePropType,
  challengeThree: require('../../assets/images/ch3.png') as ImageSourcePropType,
  challengeFour: require('../../assets/images/ch4.png') as ImageSourcePropType,
};

export const baseRunnerUiData: RunnerUiData = {
  user: {
    id: 'runner-1',
    name: 'Mansoor',
    title: 'Neon Runner',
    level: 18,
    xp: 7450,
    nextLevelXp: 10000,
    streakDays: 7,
    coins: 12450,
    avatarImage: assets.avatar,
    followers: 128,
    following: 86,
    totalRuns: 245,
  },
  homeHeroImage: assets.hero,
  quickDurations: [
    { id: 'quick-3', label: '3 min', minutes: 3, icon: 'bolt', accent: 'lime' },
    { id: 'quick-5', label: '5 min', minutes: 5, icon: 'timer', accent: 'pink' },
    { id: 'quick-10', label: '10 min', minutes: 10, icon: 'bolt', accent: 'cyan' },
  ],
  featuredMode: {
    id: 'neon-track-run',
    title: 'Neon Track Run',
    subtitle: 'Run the neon tracks, collect coins, beat obstacles.',
    durationMin: 5,
    calorieRange: '80-100 cal',
    level: 'beginner',
    image: assets.featured,
    accent: 'pink',
    icon: 'runner',
    rewardCoins: 120,
    tags: ['Featured map', 'Hot pick'],
    route: '/start-run',
    imageHasText: true,
  },
  modes: [
    {
      id: 'endless-run',
      title: 'Endless Run',
      subtitle: 'No clock. Keep moving.',
      durationMin: 0,
      calorieRange: 'Open',
      level: 'endless',
      image: assets.endless,
      accent: 'purple',
      icon: 'play',
      rewardCoins: 0,
      tags: ['Endless'],
      route: '/start-run',
      imageHasText: true,
    },
    {
      id: 'neon-sprint',
      title: 'Neon Sprint',
      subtitle: 'Fast beginner run.',
      durationMin: 5,
      calorieRange: '80-100 cal',
      level: 'beginner',
      image: assets.sprint,
      accent: 'lime',
      icon: 'bolt',
      rewardCoins: 100,
      tags: ['Beginner'],
      route: '/start-run',
      imageHasText: true,
    },
    {
      id: 'fat-burn',
      title: 'Fat Burn',
      subtitle: 'Higher heat cardio.',
      durationMin: 10,
      calorieRange: '110-140 cal',
      level: 'intermediate',
      image: assets.fatBurn,
      accent: 'orange',
      icon: 'fire',
      rewardCoins: 140,
      tags: ['Burn'],
      route: '/start-run',
      imageHasText: true,
    },
    {
      id: 'friends-challenge',
      title: 'Friends Challenge',
      subtitle: 'Race your friend score.',
      durationMin: 5,
      calorieRange: '70-90 cal',
      level: 'beginner',
      image: assets.friends,
      accent: 'cyan',
      icon: 'users',
      rewardCoins: 120,
      tags: ['Social'],
      route: '/start-run',
      imageHasText: true,
    },
    {
      id: 'boss-rush',
      title: 'Boss Rush',
      subtitle: 'Beat the toughest track.',
      durationMin: 8,
      calorieRange: '100-130 cal',
      level: 'intermediate',
      image: assets.challengeThree,
      imagePosition: 'left center',
      accent: 'purple',
      icon: 'trophy',
      rewardCoins: 180,
      tags: ['Boss'],
      route: '/start-run',
    },
    {
      id: 'recovery-run',
      title: 'Recovery Run',
      subtitle: 'Easy reset session.',
      durationMin: 3,
      calorieRange: '40-60 cal',
      level: 'beginner',
      image: assets.challengeFour,
      accent: 'lime',
      icon: 'medical',
      rewardCoins: 60,
      tags: ['Light'],
      route: '/start-run',
      imagePosition: 'left center',
    },
  ],
  recommendedRuns: [
    {
      id: 'city-lights-run',
      title: 'City Lights Run',
      subtitle: 'Short neon city session.',
      durationMin: 7,
      calorieRange: '90-120 cal',
      level: 'beginner',
      image: assets.topBanner,
      accent: 'pink',
      icon: 'runner',
      rewardCoins: 130,
      tags: ['City'],
      route: '/start-run',
    },
    {
      id: 'sunset-beach-dash',
      title: 'Sunset Beach Dash',
      subtitle: 'Palm lights and smooth pace.',
      durationMin: 10,
      calorieRange: '110-140 cal',
      level: 'intermediate',
      image: assets.friends,
      accent: 'orange',
      icon: 'bolt',
      rewardCoins: 150,
      tags: ['Beach'],
      route: '/start-run',
    },
    {
      id: 'underground-chase',
      title: 'Underground Chase',
      subtitle: 'Duck, dodge, and move fast.',
      durationMin: 5,
      calorieRange: '70-90 cal',
      level: 'beginner',
      image: assets.dailyChallenge,
      accent: 'cyan',
      icon: 'duck',
      rewardCoins: 100,
      tags: ['Underground'],
      route: '/start-run',
      imageHasText: true,
    },
  ],
  dailyChallenge: {
    id: 'duck-20',
    title: 'Duck 20 obstacles',
    subtitle: 'Stay low. Stay fast.',
    rewardCoins: 100,
    progress: 8,
    target: 20,
    image: assets.dailyChallenge,
    accent: 'purple',
    icon: 'duck',
    imageHasText: true,
  },
  challenges: [
    {
      id: 'jump-50',
      title: 'Jump 50 times',
      subtitle: 'Leap over anything.',
      rewardCoins: 80,
      progress: 22,
      target: 50,
      image: assets.challengeOne,
      accent: 'pink',
      icon: 'jump',
    },
    {
      id: 'burn-300',
      title: 'Burn 300 calories',
      subtitle: 'Turn up the heat.',
      rewardCoins: 120,
      progress: 96,
      target: 300,
      image: assets.fatBurn,
      accent: 'orange',
      icon: 'fire',
    },
    {
      id: 'finish-3-runs',
      title: 'Finish 3 runs',
      subtitle: 'Every run counts.',
      rewardCoins: 150,
      progress: 1,
      target: 3,
      image: assets.endless,
      accent: 'cyan',
      icon: 'play',
    },
    {
      id: 'beat-friend',
      title: "Beat your friend's score",
      subtitle: "Show them who's faster.",
      rewardCoins: 200,
      progress: 0,
      target: 1,
      image: assets.friends,
      accent: 'lime',
      icon: 'users',
    },
  ],
  homeStats: [
    { id: 'burned', label: 'cal burned', value: '82', icon: 'fire', accent: 'pink', trend: [2, 4, 3, 5, 6, 5, 8] },
    { id: 'minutes', label: 'min this week', value: '14', icon: 'timer', accent: 'cyan', trend: [1, 3, 2, 2, 4, 3, 5] },
    { id: 'dodges', label: 'dodges', value: '236', icon: 'runner', accent: 'lime', trend: [3, 2, 4, 3, 5, 4, 7] },
  ],
  progressStats: [
    { id: 'week-cal', label: 'cal burned this week', value: '1,024', icon: 'fire', accent: 'pink' },
    { id: 'week-min', label: 'min played this week', value: '215', icon: 'timer', accent: 'cyan' },
    { id: 'dodged', label: 'obstacles dodged', value: '1,356', icon: 'runner', accent: 'lime' },
    { id: 'combo', label: 'longest combo', value: 'x48', icon: 'fire', accent: 'orange' },
    { id: 'runs', label: 'total runs', value: '36', icon: 'shoe', accent: 'purple' },
  ],
  moves: [
    { id: 'jump', title: 'Jump', subtitle: 'Leap over obstacles', icon: 'jump', accent: 'pink', image: assets.challengeOne, imageHasText: true, imageCrop: 'left' },
    { id: 'duck', title: 'Duck', subtitle: 'Slide under barriers', icon: 'duck', accent: 'cyan', image: assets.dailyChallenge, imageHasText: true, imageCrop: 'left' },
    { id: 'left', title: 'Left', subtitle: 'Move left to switch lanes', icon: 'left', accent: 'lime', image: assets.sprint, imageHasText: true, imageCrop: 'top' },
    { id: 'right', title: 'Right', subtitle: 'Move right to switch lanes', icon: 'right', accent: 'orange', image: assets.sprint, imageHasText: true, imageCrop: 'top' },
  ],
  readiness: [
    { id: 'space', title: 'Clear space', subtitle: 'You need at least 2 meters.', icon: 'space', accent: 'purple', ready: true },
    { id: 'sound', title: 'Sound on', subtitle: 'Better with the beat.', icon: 'sound', accent: 'cyan', ready: true },
    { id: 'warmup', title: 'Warm-up 1 min', subtitle: 'Get your body ready.', icon: 'timer', accent: 'lime', ready: true },
  ],
  achievements: [
    { id: 'streak', title: '7 Day Streak', subtitle: 'Keep it going.', icon: 'fire', accent: 'orange', completed: true },
    { id: 'coins', title: '1000 Coins', subtitle: 'Coin collector.', icon: 'coin', accent: 'orange', completed: true },
    { id: 'first10', title: 'First 10 Runs', subtitle: 'Getting started.', icon: 'shoe', accent: 'purple', completed: true },
    { id: 'combo', title: 'Combo Master', subtitle: '50+ combo.', icon: 'trophy', accent: 'pink', progress: 48, target: 50 },
  ],
  personalBests: [
    { id: 'far', label: 'Farthest Run', value: '1.82 km', detail: 'New Record', icon: 'shoe', accent: 'lime' },
    { id: 'cal', label: 'Most Calories', value: '412 cal', detail: 'New Record', icon: 'fire', accent: 'pink' },
    { id: 'long', label: 'Longest Run', value: '22:18', detail: 'New Record', icon: 'timer', accent: 'cyan' },
  ],
  weeklyActivity: [
    { day: 'MON', calories: 180 },
    { day: 'TUE', calories: 240 },
    { day: 'WED', calories: 310 },
    { day: 'THU', calories: 160 },
    { day: 'FRI', calories: 280 },
    { day: 'SAT', calories: 120 },
    { day: 'SUN', calories: null },
  ],
  recentRuns: [
    { id: 'r1', dateLabel: 'May 24, 2025', distanceKm: 1.42, calories: 312, image: assets.topBanner },
    { id: 'r2', dateLabel: 'May 23, 2025', distanceKm: 1.2, calories: 256, image: assets.sprint },
    { id: 'r3', dateLabel: 'May 22, 2025', distanceKm: 0.95, calories: 198, image: assets.topBanner },
  ],
  badges: [
    { id: 'streak-king', title: 'Streak King', subtitle: '7 day streak', icon: 'fire', accent: 'orange', completed: true },
    { id: 'jump-master', title: 'Jump Master', subtitle: '500 jumps', icon: 'jump', accent: 'pink' },
    { id: 'duck-pro', title: 'Duck Pro', subtitle: '250 ducks', icon: 'duck', accent: 'cyan' },
    { id: 'coin-collector', title: 'Coin Collector', subtitle: '10,000 coins', icon: 'coin', accent: 'orange', completed: true },
  ],
  workoutGoals: [
    { id: 'runs-week', title: 'Runs per Week', subtitle: 'Goal met.', icon: 'runner', accent: 'pink', progress: 5, target: 5, completed: true },
    { id: 'active-min', title: 'Active Minutes', subtitle: 'Goal met.', icon: 'timer', accent: 'cyan', progress: 150, target: 150, completed: true },
  ],
  settings: [
    { id: 'account', label: 'Account', icon: 'profile' },
    { id: 'notifications', label: 'Notifications', icon: 'challenge' },
    { id: 'sound', label: 'Sound', icon: 'sound' },
    { id: 'devices', label: 'Connected Devices', icon: 'settings' },
  ],
};

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(value));
}

export function percent(current: number, target: number): number {
  if (target <= 0) return 0;
  return Math.max(0, Math.min(1, current / target));
}

export function levelLabel(level: RunMode['level']): string {
  if (level === 'endless') return 'Endless';
  return level.charAt(0).toUpperCase() + level.slice(1);
}

export function buildRunnerUiData(input: RunnerRuntimeInput): RunnerUiData {
  const { profile, summary, streakDays } = input;
  const liveCoins = profile.totalCoins && profile.totalCoins > 0 ? profile.totalCoins : baseRunnerUiData.user.coins;
  const liveName = profile.name?.trim() || baseRunnerUiData.user.name;
  const liveRuns = Math.max(summary.count, baseRunnerUiData.user.totalRuns);
  const liveCalories = summary.totalCalories > 0 ? Math.round(summary.totalCalories) : 82;
  const liveMinutes = summary.totalSec > 0 ? Math.round(summary.totalSec / 60) : 14;
  const liveStreak = streakDays > 0 ? streakDays : baseRunnerUiData.user.streakDays;
  const liveProgress = Math.min(baseRunnerUiData.dailyChallenge.target, Math.max(summary.count, baseRunnerUiData.dailyChallenge.progress));

  return {
    ...baseRunnerUiData,
    user: {
      ...baseRunnerUiData.user,
      name: liveName,
      streakDays: liveStreak,
      coins: liveCoins,
      totalRuns: liveRuns,
    },
    dailyChallenge: {
      ...baseRunnerUiData.dailyChallenge,
      progress: liveProgress,
    },
    homeStats: [
      { ...baseRunnerUiData.homeStats[0], value: formatNumber(liveCalories) },
      { ...baseRunnerUiData.homeStats[1], value: formatNumber(liveMinutes) },
      { ...baseRunnerUiData.homeStats[2] },
    ],
    progressStats: [
      { ...baseRunnerUiData.progressStats[0], value: formatNumber(Math.max(liveCalories, 1024)) },
      { ...baseRunnerUiData.progressStats[1], value: formatNumber(Math.max(liveMinutes, 215)) },
      { ...baseRunnerUiData.progressStats[2] },
      { ...baseRunnerUiData.progressStats[3] },
      { ...baseRunnerUiData.progressStats[4], value: formatNumber(Math.max(summary.count, 36)) },
    ],
  };
}
