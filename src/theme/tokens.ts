/**
 * "Nocturne" design tokens — quiet, compact, dark.
 * Contrast comes from tonal ramps, not saturation. Accent is used as lines,
 * outlines and glows — never large filled areas.
 */

export const colors = {
  bg: '#161826',
  surface: '#232532',
  text: '#e9e9ed',
  divider: 'rgba(233,233,237,0.16)',

  neutral100: '#f3f5fe',
  neutral200: '#e4e7f5',
  neutral300: '#cfd3e5',
  neutral400: '#b2b6ca',
  neutral500: '#9397ab',
  neutral600: '#75798c',
  neutral700: '#595d6c',
  neutral800: '#3f424d',
  neutral900: '#292b31',

  // Accent: BLUE — OKLCH hue ~260, ramp per spec L/C stops.
  accent100: '#edf6ff',
  accent200: '#d3e6ff',
  accent300: '#b4d3ff',
  accent400: '#87b2f7',
  accent500: '#5a90e8',
  accent600: '#4d74b5',
  accent700: '#37588d',
  accent800: '#253d64',
  accent900: '#162641',

  // Tinted fills (accent-900 as translucent tint on surface)
  accentTint: 'rgba(90,144,232,0.12)',

  // Celebration ground (full-screen moments only)
  celebrationGround: '#14295f',
  celebrationGlow: '#243e7c',

  backdrop: 'rgba(8,9,16,0.55)',
} as const;

export const radius = {
  sm: 8,
  lg: 14,
  pill: 99,
} as const;

export const space = {
  screenX: 20,
  cardPad: 15,
} as const;

export const shadows = {
  sm: {
    boxShadow: '0 0 0 1px #3f424d',
  },
  md: {
    boxShadow: '0 0 0 1px #595d6c, 0 6px 18px rgba(0,0,0,0.55)',
  },
  lg: {
    boxShadow: '0 0 0 1px #9397ab, 0 16px 40px rgba(0,0,0,0.65)',
  },
} as const;

/** Inter only — headings max weight 500; hierarchy via size and space. */
export const font = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
} as const;

export const type = {
  kicker: {
    fontFamily: font.medium,
    fontSize: 10,
    letterSpacing: 1.4, // .14em
    textTransform: 'uppercase' as const,
    color: colors.accent400,
  },
  title: {
    fontFamily: font.medium,
    fontSize: 20,
    color: colors.text,
  },
  body: {
    fontFamily: font.regular,
    fontSize: 13.5,
    color: colors.neutral300,
    lineHeight: 19,
  },
  label: {
    fontFamily: font.regular,
    fontSize: 14,
    color: colors.text,
  },
} as const;
