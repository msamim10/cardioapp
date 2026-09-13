/**
 * HUD palettes for the in-run overlay (`PoseOverlay.tsx`): skeleton, home
 * lane, upcoming-cue arrow, move counters and the PERFECT/GOOD/MISS flash.
 *
 * `volt` is the shipped look (brand lime) and always available. The rest are
 * level rewards (see `LEVEL_REWARDS` in `levels.ts`). Only the CHOSEN theme id
 * is persisted (`hudTheme` in progress state / `CloudProgressState`); whether
 * it is unlocked is re-derived from the effective level every time, so a
 * theme picked at level 8 on one device never renders on a fresh device that
 * is still level 2 — `resolveHudTheme` falls back to `volt`.
 *
 * Perfect/good/miss keep fixed semantic hues across every palette (lime /
 * cyan / red) so judgement feedback stays legible regardless of accent.
 */

import { colors } from '@/theme';
import { isHudThemeUnlocked, unlockLevelForHudTheme } from '@/lib/levels';

export type HudTheme = {
  id: string;
  name: string;
  tagline: string;
  /** Skeleton bones, joint ring, cue arrow, counters, lane floor. */
  accent: string;
  /** Joint fill (bones use `accent`). */
  joint: string;
  perfect: string;
  good: string;
  miss: string;
};

export const DEFAULT_HUD_THEME_ID = 'volt';

export const HUD_THEMES: readonly HudTheme[] = [
  {
    id: 'volt',
    name: 'Volt',
    tagline: 'The original signal lime.',
    accent: colors.lime,
    joint: colors.white,
    perfect: colors.lime,
    good: colors.cyan,
    miss: colors.pink,
  },
  {
    id: 'glacier',
    name: 'Glacier',
    tagline: 'Cool cyan, clean lines.',
    accent: '#3DC5F0',
    joint: colors.white,
    perfect: colors.lime,
    good: colors.cyan,
    miss: colors.pink,
  },
  {
    id: 'ember',
    name: 'Ember',
    tagline: 'Heat orange for high-burn sessions.',
    accent: '#FF6A2B',
    joint: colors.white,
    perfect: colors.lime,
    good: colors.cyan,
    miss: colors.pink,
  },
  {
    id: 'ultraviolet',
    name: 'Ultraviolet',
    tagline: 'Deep indigo, night-run feel.',
    accent: '#7B88FF',
    joint: colors.white,
    perfect: colors.lime,
    good: colors.cyan,
    miss: colors.pink,
  },
  {
    id: 'rose',
    name: 'Rose',
    tagline: 'Warm magenta with soft joints.',
    accent: '#FF6B9D',
    joint: '#FFE3EE',
    perfect: colors.lime,
    good: colors.cyan,
    miss: colors.pink,
  },
  {
    id: 'gold',
    name: 'Gold',
    tagline: 'Championship gold. Earned.',
    accent: '#FFC72C',
    joint: '#FFF4CC',
    perfect: colors.lime,
    good: colors.cyan,
    miss: colors.pink,
  },
  {
    id: 'mint',
    name: 'Mint',
    tagline: 'Fresh sea-green, easy on the eyes.',
    accent: '#4DFFB4',
    joint: colors.white,
    perfect: colors.lime,
    good: colors.cyan,
    miss: colors.pink,
  },
  {
    id: 'carbon',
    name: 'Carbon',
    tagline: 'Monochrome. Nothing but the numbers.',
    accent: colors.white,
    joint: '#08090A',
    perfect: colors.lime,
    good: colors.cyan,
    miss: colors.pink,
  },
];

const THEME_BY_ID: Readonly<Record<string, HudTheme>> = Object.fromEntries(
  HUD_THEMES.map((theme) => [theme.id, theme])
);

export const DEFAULT_HUD_THEME: HudTheme = THEME_BY_ID[DEFAULT_HUD_THEME_ID];

export function isHudThemeId(value: unknown): value is string {
  return typeof value === 'string' && value in THEME_BY_ID;
}

export function getHudTheme(id: string | null | undefined): HudTheme | null {
  return id && isHudThemeId(id) ? THEME_BY_ID[id] : null;
}

/**
 * Theme to render for a persisted selection at the given effective level.
 * Unknown ids and themes the level has not unlocked fall back to the default.
 */
export function resolveHudTheme(selectedId: string | null | undefined, level: number): HudTheme {
  const theme = getHudTheme(selectedId);
  if (!theme) return DEFAULT_HUD_THEME;
  return isHudThemeUnlocked(theme.id, level) ? theme : DEFAULT_HUD_THEME;
}

/** Picker rows: every palette with its unlock level and state for this level. */
export function hudThemeOptions(level: number): { theme: HudTheme; unlockLevel: number; unlocked: boolean }[] {
  return HUD_THEMES.map((theme) => ({
    theme,
    unlockLevel: unlockLevelForHudTheme(theme.id),
    unlocked: isHudThemeUnlocked(theme.id, level),
  }));
}

/** `#RRGGBB` → `rgba(r,g,b,alpha)` for translucent lane / halo fills. */
export function withAlpha(hex: string, alpha: number): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return hex;
  const value = parseInt(match[1], 16);
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  const a = Math.min(1, Math.max(0, alpha));
  return `rgba(${r},${g},${b},${a})`;
}
