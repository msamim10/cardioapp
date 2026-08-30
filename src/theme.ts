import type { TextStyle } from 'react-native';

// Athletic performance tokens: neutral near-black base, one signal accent
// (lime), fixed metric colors for data, tight radii and a numeral-first type
// scale. Color is a role, not decoration — see `metric` below.

export const colors = {
  bg: '#08090A',
  bgElevated: '#0E0F11',
  surface: '#141618',
  surface2: '#1C1F22',
  surface3: '#252A2E',
  border: 'rgba(255,255,255,0.09)',
  borderStrong: 'rgba(255,255,255,0.18)',

  text: '#F7F8F8',
  textDim: '#9BA1A6',
  textFaint: '#828A8E',

  // The single signal color. CTAs, active states, progress, selection — and
  // nothing else. Nike-Volt leaning so it reads performance, not candy.
  lime: '#D7FF3E',
  limeDim: '#A8C92E',

  // Fixed metric colors, in the Peloton / Zwift / Whoop tradition: each hue
  // means one kind of data everywhere it appears. These are NOT free accents.
  // `violet`/`pink`/`cyan`/`orange` are retained as aliases below purely so the
  // existing `AccentKey` call sites keep working.
  heat: '#FF6A2B', // calories, intensity, streak
  pace: '#3DC5F0', // speed, cadence, time
  effort: '#FF4757', // hard difficulty, live, alerts
  focus: '#5B6CFF', // premium / secondary emphasis (fills only, never small text)

  violet: '#5B6CFF',
  pink: '#FF4757',
  cyan: '#3DC5F0',
  orange: '#FF6A2B',

  black: '#000000',
  white: '#FFFFFF',
} as const;

// Two-stop ramps kept deliberately tight in value, so a "gradient" fill reads
// as a single confident color with a faint sheen rather than a candy button.
export const gradients = {
  lime: ['#DEFF52', '#C2F02A'] as const,
  violet: ['#6B7BFF', '#4B5BF5'] as const,
  pink: ['#FF5A68', '#F0303F'] as const,
  cyan: ['#54CDF4', '#22B4E4'] as const,
  sunset: ['#FF7838', '#F5561B'] as const,
  night: ['#141618', '#08090A'] as const,
  graphite: ['#25292E', '#111417'] as const,
} as const;

export type AccentKey = 'lime' | 'violet' | 'pink' | 'cyan' | 'orange';

export const accentColor: Record<AccentKey, string> = {
  lime: colors.lime,
  violet: colors.focus,
  pink: colors.effort,
  cyan: colors.pace,
  orange: colors.heat,
};

export const accentGradient: Record<AccentKey, readonly [string, string]> = {
  lime: gradients.lime,
  violet: gradients.violet,
  pink: gradients.pink,
  cyan: gradients.cyan,
  orange: gradients.sunset,
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 44,
} as const;

// Tight, structural radii. Large radii are the strongest single "friendly app"
// signal, so cards sit at 14 and hero artwork at 18 (Zwift/Whoop territory).
// `pill` is reserved for chips, badges, tracks and pips — never for buttons.
export const radius = {
  xs: 4,
  sm: 6,
  md: 10,
  lg: 14,
  xl: 18,
  button: 12,
  pill: 999,
} as const;

export const cardSurface = {
  borderRadius: radius.lg,
  backgroundColor: colors.surface,
  borderWidth: 1,
  borderColor: colors.border,
} as const;

export const font = {
  heavy: '900' as const,
  black: '800' as const,
  bold: '700' as const,
  semibold: '600' as const,
  medium: '500' as const,
  regular: '400' as const,
};

/** Applied to any number the user reads as data, so digits never jitter. */
export const metric: Pick<TextStyle, 'fontVariant'> = {
  fontVariant: ['tabular-nums'],
};

/**
 * Type scale. Display sizes carry heavy weight and negative tracking; labels
 * carry uppercase positive tracking. Numbers pair with `metric`.
 */
export const type = {
  hero: { fontSize: 64, lineHeight: 66, fontWeight: font.heavy, letterSpacing: -2.4 },
  display: { fontSize: 40, lineHeight: 43, fontWeight: font.heavy, letterSpacing: -1.4 },
  h1: { fontSize: 30, lineHeight: 34, fontWeight: font.heavy, letterSpacing: -0.9 },
  h2: { fontSize: 22, lineHeight: 26, fontWeight: font.black, letterSpacing: -0.5 },
  h3: { fontSize: 17, lineHeight: 22, fontWeight: font.bold, letterSpacing: -0.2 },
  body: { fontSize: 15, lineHeight: 22, fontWeight: font.medium, letterSpacing: 0 },
  bodySm: { fontSize: 13, lineHeight: 19, fontWeight: font.medium, letterSpacing: 0 },
  label: {
    fontSize: 12,
    lineHeight: 15,
    fontWeight: font.bold,
    letterSpacing: 1,
    textTransform: 'uppercase' as const,
  },
  micro: {
    fontSize: 10,
    lineHeight: 13,
    fontWeight: font.black,
    letterSpacing: 1.1,
    textTransform: 'uppercase' as const,
  },
  /** Button text: uppercase, heavy, positive tracking. */
  action: { fontSize: 15, lineHeight: 18, fontWeight: font.heavy, letterSpacing: 1 },
} as const;
