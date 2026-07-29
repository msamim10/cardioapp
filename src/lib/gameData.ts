import type { Ionicons } from '@expo/vector-icons';
import type { AccentKey } from '@/theme';

export type IconName = keyof typeof Ionicons.glyphMap;

export type Level = {
  id: string;
  name: string;
  durationMin: number;
};

export type Mode = {
  id: string;
  name: string;
  tagline: string;
  accent: AccentKey;
  icon: IconName;
  levels: Level[];
};

/**
 * One world per full-length video (13 total). Stable IDs map to the immutable
 * storage folders in videoSources.ts; display titles intentionally follow the
 * supplied cover/video order.
 * Accent keys cycle through the theme palette for visual variety, and each
 * world carries an Ionicons glyph so the UI stays icon-based (no emoji).
 *
 * These are the static content definitions only. Whether a world is locked or
 * completed is derived at runtime from persisted progress (see ProgressContext
 * + progression.ts) rather than baked in here.
 */
export const modes: Mode[] = [
  {
    id: 'wild-city',
    name: 'Wild City',
    tagline: 'Outrun what\u2019s behind you',
    accent: 'lime',
    icon: 'paw',
    levels: [{ id: 'wild-city', name: 'Wild City', durationMin: 5 }],
  },
  {
    id: 'pixel-kingdom',
    name: 'Pixel Kingdom',
    tagline: 'Titans, chaos, and speed',
    accent: 'violet',
    icon: 'shield',
    levels: [{ id: 'pixel-kingdom', name: 'Pixel Kingdom', durationMin: 7 }],
  },
  {
    id: 'neon-beat-hunters',
    name: 'Neon Beat Hunters',
    tagline: 'Beat drops and dodge cues',
    accent: 'pink',
    icon: 'musical-notes',
    levels: [{ id: 'neon-beat-hunters', name: 'Neon Beat Hunters', durationMin: 6 }],
  },
  {
    id: 'dino-escape',
    name: 'Dino Escape',
    tagline: 'Classic runner energy',
    accent: 'cyan',
    icon: 'train',
    levels: [{ id: 'dino-escape', name: 'Dino Escape', durationMin: 7 }],
  },
  {
    id: 'wild-city-rush',
    name: 'Wild City Rush',
    tagline: 'Glitchy obstacles, big energy',
    accent: 'orange',
    icon: 'sparkles',
    levels: [{ id: 'wild-city-rush', name: 'Wild City Rush', durationMin: 6 }],
  },
  {
    id: 'red-light-rush',
    name: 'Red Light Rush',
    tagline: 'Ice, speed, and survival',
    accent: 'lime',
    icon: 'snow',
    levels: [{ id: 'red-light-rush', name: 'Red Light Rush', durationMin: 7 }],
  },
  {
    id: 'critter-chase',
    name: 'Critter Chase',
    tagline: 'Heat, lava, and lanes',
    accent: 'violet',
    icon: 'flame',
    levels: [{ id: 'critter-chase', name: 'Critter Chase', durationMin: 7 }],
  },
  {
    id: 'red-light-rush-2',
    name: 'Red Light Rush 2',
    tagline: 'Playtime turned workout',
    accent: 'pink',
    icon: 'rocket',
    levels: [{ id: 'red-light-rush-2', name: 'Red Light Rush 2', durationMin: 7 }],
  },
  {
    id: 'metro-zombie-escape',
    name: 'Metro Zombie Escape',
    tagline: 'City chase cardio',
    accent: 'cyan',
    icon: 'navigate',
    levels: [{ id: 'metro-zombie-escape', name: 'Metro Zombie Escape', durationMin: 5 }],
  },
  {
    id: 'drumline-dash',
    name: 'Drumline Dash',
    tagline: 'Blocks, rails, and speed',
    accent: 'orange',
    icon: 'cube',
    levels: [{ id: 'drumline-dash', name: 'Drumline Dash', durationMin: 6 }],
  },
  {
    id: 'block-world-dash',
    name: 'Block World Dash',
    tagline: 'Jump, duck, and dash',
    accent: 'lime',
    icon: 'game-controller',
    levels: [{ id: 'block-world-dash', name: 'Block World Dash', durationMin: 5 }],
  },
  {
    id: 'neon-rails',
    name: 'Neon Rails',
    tagline: 'Dash the rails and dodge fast',
    accent: 'cyan',
    icon: 'speedometer',
    levels: [{ id: 'neon-rails', name: 'Neon Rails', durationMin: 2 }],
  },
  {
    id: 'prison-escape-run',
    name: 'Prison Escape Run',
    tagline: 'Break free and outrun pursuit',
    accent: 'orange',
    icon: 'warning',
    levels: [{ id: 'prison-escape-run', name: 'Prison Escape Run', durationMin: 3 }],
  },
];

export function getMode(id: string | undefined): Mode | undefined {
  return modes.find((m) => m.id === id);
}

/** Flat lookup of every level across all worlds (one level per world today). */
export function getLevel(id: string | undefined): Level | undefined {
  if (!id) return undefined;
  for (const mode of modes) {
    const level = mode.levels.find((l) => l.id === id);
    if (level) return level;
  }
  return undefined;
}
