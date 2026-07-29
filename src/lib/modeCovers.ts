import type { ImageSourcePropType } from 'react-native';

/**
 * Cover artwork is keyed by stable internal mode IDs so display-title changes
 * never affect asset lookup or saved workout data.
 */
export const modeCovers = {
  'wild-city': require('../../assets/covers/cover-wild-city-1.jpg'),
  'pixel-kingdom': require('../../assets/covers/cover-pixel-kingdom.jpg'),
  'neon-beat-hunters': require('../../assets/covers/cover-neon-beat-hunters.jpg'),
  'dino-escape': require('../../assets/covers/cover-dino-escape.jpg'),
  'wild-city-rush': require('../../assets/covers/cover-wild-city-2.jpg'),
  'red-light-rush': require('../../assets/covers/cover-red-light-rush.jpg'),
  'critter-chase': require('../../assets/covers/cover-critter-chase.jpg'),
  'red-light-rush-2': require('../../assets/covers/cover-red-light-rush-2.jpg'),
  'metro-zombie-escape': require('../../assets/covers/cover-metro-zombie-escape.jpg'),
  'drumline-dash': require('../../assets/covers/cover-drumline-dash.jpg'),
  'block-world-dash': require('../../assets/covers/cover-block-world-dash.jpg'),
  'neon-rails': require('../../assets/covers/cover-neon-rails.jpg'),
  'prison-escape-run': require('../../assets/covers/cover-prison-escape-run.jpg'),
} as const satisfies Record<string, ImageSourcePropType>;

export type CoveredModeId = keyof typeof modeCovers;

export function getModeCover(modeId: string): ImageSourcePropType | undefined {
  return modeCovers[modeId as CoveredModeId];
}
