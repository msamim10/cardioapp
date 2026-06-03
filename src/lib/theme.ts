export const theme = {
  colors: {
    bg: '#0a0e14',
    bgElevated: '#141a23',
    bgCard: '#1c2330',
    border: '#2a3441',
    text: '#f3f6fb',
    textMuted: '#8a96a8',
    textDim: '#5a6779',
    primary: '#22d3ee',
    primaryDark: '#0891b2',
    accent: '#f59e0b',
    danger: '#ef4444',
    success: '#10b981',
    overlay: 'rgba(10, 14, 20, 0.55)',
  },
  radii: {
    sm: 8,
    md: 14,
    lg: 22,
    pill: 999,
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
    xxl: 48,
  },
} as const;

export type Theme = typeof theme;
