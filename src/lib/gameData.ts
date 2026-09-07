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
 * storage folders in videoSources.ts and to the cover art in modeCovers.ts, so
 * display names can change freely without touching assets or saved progress.
 *
 * NAMES are the single source of truth for what the user sees everywhere
 * (Home, Levels, level detail, onboarding, the run summary). Each is an
 * original, evocative title that reads straight off its cover — never a
 * third-party trademark (App Store 5.2.1), even where the art nods at a genre.
 * Taglines and glyphs describe the cover's scene for the same reason.
 *
 * These are the static content definitions only. Whether a world is locked or
 * completed is derived at runtime from persisted progress (see ProgressContext
 * + progression.ts) rather than baked in here.
 */
export const modes: Mode[] = [
  {
    // Daytime city, a fox sprinting the boulevard ahead of the pack.
    id: 'wild-city',
    name: 'Wild City',
    tagline: 'Outrun the pack downtown',
    accent: 'lime',
    icon: 'paw',
    levels: [{ id: 'wild-city', name: 'Wild City', durationMin: 5 }],
  },
  {
    // Giant mushrooms, floating blocks, coins and waterfalls.
    id: 'pixel-kingdom',
    name: 'Mushroom Falls',
    tagline: 'Blocks, coins and waterfalls',
    accent: 'violet',
    icon: 'cube',
    levels: [{ id: 'pixel-kingdom', name: 'Mushroom Falls', durationMin: 7 }],
  },
  {
    // Dance crew under a neon skyline with a demon looming overhead.
    id: 'neon-beat-hunters',
    name: 'Neon Beat Hunters',
    tagline: 'Beat drops and dodge cues',
    accent: 'pink',
    icon: 'musical-notes',
    levels: [{ id: 'neon-beat-hunters', name: 'Neon Beat Hunters', durationMin: 6 }],
  },
  {
    // Jungle trail with a T-rex on your heels.
    id: 'dino-escape',
    name: 'Dino Escape',
    tagline: 'Outrun the T-rex',
    accent: 'cyan',
    icon: 'footsteps',
    levels: [{ id: 'dino-escape', name: 'Dino Escape', durationMin: 7 }],
  },
  {
    // The same city after dark: neon streets, full sprint.
    id: 'wild-city-rush',
    name: 'Wild City Nights',
    tagline: 'Neon streets, full sprint',
    accent: 'orange',
    icon: 'moon',
    levels: [{ id: 'wild-city-rush', name: 'Wild City Nights', durationMin: 6 }],
  },
  {
    // Pink-and-teal arena, a giant doll calling red light, green light.
    id: 'red-light-rush',
    name: 'Red Light Rush',
    tagline: 'Freeze on red, sprint on green',
    accent: 'lime',
    icon: 'stop-circle',
    levels: [{ id: 'red-light-rush', name: 'Red Light Rush', durationMin: 7 }],
  },
  {
    // Meadow trail with fire, water and leaf critters bounding alongside.
    id: 'critter-chase',
    name: 'Critter Chase',
    tagline: 'Fire, water and leaf on your heels',
    accent: 'violet',
    icon: 'flame',
    levels: [{ id: 'critter-chase', name: 'Critter Chase', durationMin: 7 }],
  },
  {
    // Neon glass walkways over a red-lit void, masked guards watching.
    id: 'red-light-rush-2',
    name: 'Glass Maze',
    tagline: 'Neon glass, one wrong step',
    accent: 'pink',
    icon: 'grid',
    levels: [{ id: 'red-light-rush-2', name: 'Glass Maze', durationMin: 7 }],
  },
  {
    // Railway tracks, an oncoming train and a shambling horde.
    id: 'metro-zombie-escape',
    name: 'Zombie Metro',
    tagline: 'Down the tracks, ahead of the horde',
    accent: 'cyan',
    icon: 'skull',
    levels: [{ id: 'metro-zombie-escape', name: 'Zombie Metro', durationMin: 5 }],
  },
  {
    // A giant living drum chasing you through a lantern-lit village at night.
    id: 'drumline-dash',
    name: 'Drum Demon',
    tagline: 'A beat that chases you',
    accent: 'orange',
    icon: 'musical-note',
    levels: [{ id: 'drumline-dash', name: 'Drum Demon', durationMin: 6 }],
  },
  {
    // Brick road through the clouds, green pipes and floating castles.
    id: 'block-world-dash',
    name: 'Cloud Kingdom',
    tagline: 'Brick roads above the clouds',
    accent: 'lime',
    icon: 'cloud',
    levels: [{ id: 'block-world-dash', name: 'Cloud Kingdom', durationMin: 5 }],
  },
  {
    // Hoverboard along graffiti-covered subway tracks, trains either side.
    id: 'neon-rails',
    name: 'Neon Subway',
    tagline: 'Board the rails, dodge the trains',
    accent: 'cyan',
    icon: 'train',
    levels: [{ id: 'neon-rails', name: 'Neon Subway', durationMin: 2 }],
  },
  {
    // Prison yard under searchlights, guard towers behind.
    id: 'prison-escape-run',
    name: 'Prison Escape',
    tagline: 'Break out under the searchlights',
    accent: 'orange',
    icon: 'flashlight',
    levels: [{ id: 'prison-escape-run', name: 'Prison Escape', durationMin: 3 }],
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
