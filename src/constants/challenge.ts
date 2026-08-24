/** Challenge-wide tunables. Change values here, not at call sites. */

import type { ChallengeLength } from '@/data/types';

/**
 * The three lengths a challenge can run for, and the one line each of them
 * has to earn its place with.
 *
 * These are the ONLY three the server accepts: `challenges.duration_days`
 * carries a `check (duration_days in (30, 45, 75))`, and both
 * create_challenge() and set_challenge_duration() reject anything else. Add
 * a fourth here and the RPC refuses it — deliberately, so the set cannot
 * drift apart across the two halves of the app.
 */
export const CHALLENGE_LENGTHS: {
  days: ChallengeLength;
  label: string;
  descriptor: string;
}[] = [
  { days: 75, label: '75 days', descriptor: 'The full thing. Two and a half months.' },
  { days: 45, label: '45 days', descriptor: 'Long enough to change something. Six weeks.' },
  { days: 30, label: '30 days', descriptor: 'One month. A real start, not a warm-up.' },
];

export const CHALLENGE = {
  /**
   * What a NEW challenge gets when nobody has chosen yet, and what every
   * challenge created before lengths existed carries (migration 0008 backfills
   * it as the column default).
   *
   * It is NOT the length of the challenge on screen. Every screen reads
   * `durationDays` off the store, because two people in the same squad can be
   * running different lengths. If you are reaching for this constant in a
   * component, you almost certainly want the store value instead.
   */
  defaultDays: 75 as ChallengeLength,
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

/**
 * The most custom tasks a challenge may hold at once. Mirrors
 * public.custom_task_limit(); the server is the one that enforces it.
 */
export const MAX_CUSTOM_TASKS = 5;
