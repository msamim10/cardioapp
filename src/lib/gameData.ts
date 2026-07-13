import type { AccentKey } from '@/theme';

export type Difficulty = 'Beginner' | 'Normal' | 'Hard';

export type Level = {
  id: string;
  name: string;
  durationMin: number;
  emoji: string;
};

export type Mode = {
  id: string;
  name: string;
  tagline: string;
  accent: AccentKey;
  emoji: string;
  locked: boolean;
  levels: Level[];
};

export type Challenge = {
  id: string;
  title: string;
  reward: string;
  progress: number; // 0..1
  done: boolean;
};

export const user = {
  name: 'Riley',
  handle: '@riley',
  coins: 1240,
  xp: 3820,
  xpToNext: 5000,
  level: 12,
  streak: 4,
  runsThisWeek: 3,
  caloriesThisWeek: 640,
};

/** One world per full-length video (12 total). Titles match the ordered source set. */
export const modes: Mode[] = [
  {
    id: 'jurassic-escape',
    name: 'Jurassic Escape Edition',
    tagline: 'Outrun what\u2019s behind you',
    accent: 'lime',
    emoji: '🦖',
    locked: false,
    levels: [{ id: 'jurassic-escape', name: 'Jurassic Escape Edition', durationMin: 5, emoji: '🦖' }],
  },
  {
    id: 'godzilla-kong',
    name: 'Godzilla vs. Kong New Map Run',
    tagline: 'Titans, chaos, and speed',
    accent: 'orange',
    emoji: '🦍',
    locked: false,
    levels: [{ id: 'godzilla-kong', name: 'Godzilla vs. Kong New Map Run', durationMin: 7, emoji: '🦍' }],
  },
  {
    id: 'kpop-demon',
    name: 'K-Pop Demon Hunters 3 New Map',
    tagline: 'Beat drops and dodge cues',
    accent: 'pink',
    emoji: '🎤',
    locked: false,
    levels: [{ id: 'kpop-demon', name: 'K-Pop Demon Hunters 3 New Map', durationMin: 6, emoji: '🎤' }],
  },
  {
    id: 'subway-surfers',
    name: 'Subway Surfers New Map',
    tagline: 'Classic runner energy',
    accent: 'cyan',
    emoji: '🚇',
    locked: false,
    levels: [{ id: 'subway-surfers', name: 'Subway Surfers New Map', durationMin: 7, emoji: '🚇' }],
  },
  {
    id: 'digital-circus',
    name: 'Digital Circus Escape',
    tagline: 'Glitchy obstacles, big energy',
    accent: 'violet',
    emoji: '🎪',
    locked: true,
    levels: [{ id: 'digital-circus', name: 'Digital Circus Escape', durationMin: 6, emoji: '🎪' }],
  },
  {
    id: 'frozen-escape',
    name: 'Frozen Escape',
    tagline: 'Ice, speed, and survival',
    accent: 'cyan',
    emoji: '❄️',
    locked: true,
    levels: [{ id: 'frozen-escape', name: 'Frozen Escape', durationMin: 7, emoji: '❄️' }],
  },
  {
    id: 'minecraft-nether',
    name: 'Minecraft Nether Escape',
    tagline: 'Heat, lava, and lanes',
    accent: 'orange',
    emoji: '🔥',
    locked: true,
    levels: [{ id: 'minecraft-nether', name: 'Minecraft Nether Escape', durationMin: 7, emoji: '🔥' }],
  },
  {
    id: 'toy-story',
    name: 'Toy Story Escape',
    tagline: 'Playtime turned workout',
    accent: 'lime',
    emoji: '🤠',
    locked: true,
    levels: [{ id: 'toy-story', name: 'Toy Story Escape', durationMin: 7, emoji: '🤠' }],
  },
  {
    id: 'zootopia',
    name: 'Zootopia 3 Escape Edition',
    tagline: 'City chase cardio',
    accent: 'pink',
    emoji: '🦊',
    locked: true,
    levels: [{ id: 'zootopia', name: 'Zootopia 3 Escape Edition', durationMin: 5, emoji: '🦊' }],
  },
  {
    id: 'minecraft-subway',
    name: 'Minecraft Subway Edition',
    tagline: 'Blocks, rails, and speed',
    accent: 'violet',
    emoji: '⛏️',
    locked: false,
    levels: [{ id: 'minecraft-subway', name: 'Minecraft Subway Edition', durationMin: 6, emoji: '⛏️' }],
  },
  {
    id: 'mario-world',
    name: 'Mario World Escape',
    tagline: 'Jump, duck, and dash',
    accent: 'orange',
    emoji: '🍄',
    locked: false,
    levels: [{ id: 'mario-world', name: 'Mario World Escape', durationMin: 5, emoji: '🍄' }],
  },
  {
    id: 'stranger-things',
    name: 'Stranger Things Edition',
    tagline: 'Upside-down cardio run',
    accent: 'violet',
    emoji: '🔦',
    locked: false,
    levels: [{ id: 'stranger-things', name: 'Stranger Things Edition', durationMin: 6, emoji: '🔦' }],
  },
  {
    id: '4k-test',
    name: '4K Quality Test',
    tagline: 'High-res sample run',
    accent: 'lime',
    emoji: '🎬',
    locked: false,
    levels: [{ id: '4k-test', name: '4K Quality Test', durationMin: 2, emoji: '🎬' }],
  },
];

export const featured = {
  modeId: 'jurassic-escape',
  levelId: 'jurassic-escape',
  title: 'Jurassic Escape Edition',
  subtitle: 'Full-length run · ~5 min',
  accent: 'lime' as AccentKey,
  emoji: '🦖',
};

export const dailyChallenges: Challenge[] = [
  { id: 'c1', title: 'Complete one Jurassic Escape run', reward: '+120 coins', progress: 0, done: false },
  { id: 'c2', title: 'Finish a run without pausing', reward: '+300 XP', progress: 0.5, done: false },
  { id: 'c3', title: 'Earn 200 coins', reward: 'Jump Master badge', progress: 0.3, done: false },
];

export const difficulties: { key: Difficulty; multiplier: string; note: string }[] = [
  { key: 'Beginner', multiplier: '1.0x', note: 'Chill pace, learn the cues' },
  { key: 'Normal', multiplier: '1.25x', note: 'Balanced score boost' },
  { key: 'Hard', multiplier: '1.5x', note: 'Tougher goals, best rewards' },
];

export function getMode(id: string | undefined): Mode | undefined {
  return modes.find((m) => m.id === id);
}
