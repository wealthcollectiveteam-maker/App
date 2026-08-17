/** Challenge-wide tunables. Change values here, not at call sites. */

export const CHALLENGE = {
  days: 75,
} as const;

export const XP = {
  task: 20,
  journal: 10,
  milestone: 50,
  dayComplete: 120,
  perLevel: 800,
} as const;

export const PINGS = {
  /** Every ping — preset quip or free text — costs 1 of this daily allowance. */
  maxPerDay: 5,
} as const;
