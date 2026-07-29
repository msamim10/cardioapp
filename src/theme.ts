// Gen-Z leaning design tokens: dark base, punchy electric accents, big rounded shapes.

export const colors = {
  bg: '#0A0A0F',
  bgElevated: '#111119',
  surface: '#16161F',
  surface2: '#1E1E2A',
  border: 'rgba(255,255,255,0.08)',
  borderStrong: 'rgba(255,255,255,0.16)',

  text: '#F5F5F7',
  textDim: '#A0A0B0',
  textFaint: '#6C6C7C',

  lime: '#C6FF3D',
  violet: '#8B5CFF',
  pink: '#FF5CAA',
  cyan: '#45E0FF',
  orange: '#FF8A3D',

  black: '#000000',
  white: '#FFFFFF',
} as const;

export const gradients = {
  lime: ['#C6FF3D', '#7BE000'] as const,
  violet: ['#A97BFF', '#6B3DFF'] as const,
  pink: ['#FF7AC0', '#FF3D8A'] as const,
  cyan: ['#7CEBFF', '#22C4FF'] as const,
  sunset: ['#FF8A3D', '#FF3D6E'] as const,
  night: ['#1B1B2B', '#0A0A0F'] as const,
} as const;

export type AccentKey = 'lime' | 'violet' | 'pink' | 'cyan' | 'orange';

export const accentColor: Record<AccentKey, string> = {
  lime: colors.lime,
  violet: colors.violet,
  pink: colors.pink,
  cyan: colors.cyan,
  orange: colors.orange,
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
} as const;

export const radius = {
  sm: 12,
  md: 18,
  lg: 24,
  xl: 32,
  pill: 999,
} as const;

export const cardSurface = {
  borderRadius: radius.lg,
  backgroundColor: colors.surface,
  borderWidth: 1,
  borderColor: colors.border,
} as const;

export const font = {
  black: '800' as const,
  bold: '700' as const,
  semibold: '600' as const,
  medium: '500' as const,
  regular: '400' as const,
};
