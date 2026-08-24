/**
 * Design tokens — near-black ground, electric blue used as a FILL.
 *
 * Nine tokens carry the system: three grounds, one hairline, two accents,
 * three text levels. The `neutral*` / `accent*` ramps below are LEGACY
 * ALIASES kept so screens outside the redesign keep compiling; every one of
 * them is derived from the nine, so nothing can drift off-palette. New code
 * uses the nine names.
 *
 * No hardcoded hex outside this file.
 */

const bg = '#0A0B0D'; // near-black ground
const surface = '#131519'; // cards
const surfaceAlt = '#1A1D23'; // chips, avatar tiles, inactive segments
const line = '#22262E'; // hairlines
const accent = '#1E5BFF'; // electric blue — a fill, not only an outline
const accentDeep = '#10306B'; // filled chips, dim accent states
const textHi = '#F2F3F5';
const textMid = '#8B919B';
const textLow = '#4E545D';

export const colors = {
  bg,
  surface,
  surfaceAlt,
  line,
  accent,
  accentDeep,
  textHi,
  textMid,
  textLow,

  // ---- Legacy aliases (derived, never independent) ----
  text: textHi,
  divider: line,

  neutral100: textHi,
  neutral200: '#E2E4E8',
  neutral300: '#C2C6CD',
  neutral400: '#A0A6AF',
  neutral500: textMid,
  neutral600: '#6A707A',
  neutral700: textLow,
  neutral800: '#2E333B',
  neutral900: surfaceAlt,

  accent100: '#E8EFFF',
  accent200: '#C7D8FF',
  accent300: '#9DBAFF',
  accent400: '#5C8CFF',
  accent500: accent,
  accent600: '#1848CC',
  accent700: '#143A9E',
  accent800: accentDeep,
  accent900: '#0C2148',

  /** Accent at low opacity, for pressed/tinted states on surface. */
  accentTint: 'rgba(30,91,255,0.12)',

  // Celebration ground (full-screen moments only)
  celebrationGround: '#0F2A6B',
  celebrationGlow: '#1A3E8F',

  backdrop: 'rgba(5,6,8,0.62)',
} as const;

/** The redesign is square. Corners are a hairline, not a curve. */
export const radius = {
  sm: 2,
  lg: 2,
  pill: 2,
} as const;

export const space = {
  screenX: 20,
  cardPad: 18,
} as const;

export const shadows = {
  sm: {
    boxShadow: `0 0 0 1px ${line}`,
  },
  md: {
    boxShadow: `0 0 0 1px ${line}, 0 6px 18px rgba(0,0,0,0.55)`,
  },
  lg: {
    boxShadow: `0 0 0 1px ${textLow}, 0 16px 40px rgba(0,0,0,0.7)`,
  },
} as const;

/**
 * Two families do the work.
 *
 * Inter — everything structural. Instrument Serif Italic — quotes and
 * descriptors ONLY (the why-quote, task descriptors, journal entries, the
 * tier-penalty line). Nothing else gets the serif.
 */
export const font = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  black: 'Inter_900Black',
  /** Wordmark and the large day numeral only. */
  blackItalic: 'Inter_900Black_Italic',
  serifItalic: 'InstrumentSerif_400Regular_Italic',
} as const;

/** Uppercase micro-label tracking: ~0.14em, applied at the label's size. */
export const microTracking = (size: number) => size * 0.14;

export const type = {
  /** 01, 03/06, 10:00, stat figures. Heavy and tight. */
  display: {
    fontFamily: font.black,
    letterSpacing: -2,
    color: colors.textHi,
  },
  /** Check-in, Track, Squad, Pick your tier. */
  heading: {
    fontFamily: font.bold,
    fontSize: 30,
    letterSpacing: -0.8,
    color: colors.textHi,
  },
  /** RANKED. */
  wordmark: {
    fontFamily: font.blackItalic,
    fontSize: 21,
    letterSpacing: 0.4,
    color: colors.textHi,
  },
  /** OF 75 DAYS, 2 OF 6 TODAY, PROOF OPTIONAL, INVITE CODE. */
  micro: {
    fontFamily: font.semibold,
    fontSize: 11,
    letterSpacing: microTracking(11),
    textTransform: 'uppercase' as const,
    color: colors.textMid,
  },
  kicker: {
    fontFamily: font.semibold,
    fontSize: 10,
    letterSpacing: microTracking(10),
    textTransform: 'uppercase' as const,
    color: colors.textMid,
  },
  title: {
    fontFamily: font.bold,
    fontSize: 20,
    letterSpacing: -0.4,
    color: colors.textHi,
  },
  body: {
    fontFamily: font.regular,
    fontSize: 14,
    color: colors.textMid,
    lineHeight: 20,
  },
  label: {
    fontFamily: font.medium,
    fontSize: 15,
    color: colors.textHi,
  },
  /** Quotes and descriptors. Never labels, never buttons. */
  serif: {
    fontFamily: font.serifItalic,
    fontSize: 17,
    color: colors.textMid,
    lineHeight: 24,
  },
} as const;
