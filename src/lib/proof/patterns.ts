/**
 * WHAT MOVES ME (Phase 38O, O1f). Personal patterns from the person's own
 * days. Pure, over the daily series.
 *
 * RULES
 *   - each side needs at least MIN_SIDE days, or the pair is not shown;
 *   - the figure is the median difference between the sides, with n on each;
 *   - at most MAX_SHOWN, ranked by the difference relative to the spread of
 *     the outcome across both sides;
 *   - nothing that does not vary is shown: a spread of zero, or a side with
 *     too few days, drops the pair. A perfect streak has no "done vs not";
 *   - every pattern carries COPY.patternsCaveat. Not proof of cause.
 *
 * Times are the challenge zone's: "after 7 PM" and "before 11 PM" are read
 * from the row's minutes, which series.ts computed with wallClockIn(zone).
 */
import { COPY } from './copy.ts';
import type { DailyRow } from './series.ts';
import { median, spread } from './stats.ts';

export const MIN_SIDE = 5;
export const MAX_SHOWN = 3;
export const LATE_WORKOUT_MINUTE = 19 * 60;
/** 11 PM as minutes after noon. */
export const LATE_BED_MINUTE = 11 * 60;
export const LONG_SLEEP_MINUTES = 7 * 60;

export interface Pattern {
  key: 'late-workout-sleep' | 'early-bed-hrv' | 'sleep-finish' | 'water-sleep';
  text: string;
  /** Median of side A minus median of side B, in the outcome's unit. */
  diff: number;
  nA: number;
  nB: number;
  /** |diff| / spread — the ranking key. */
  score: number;
}

interface Candidate {
  key: Pattern['key'];
  /** Split a row into side A (true), side B (false), or neither (null). */
  side: (row: DailyRow, next: DailyRow | undefined) => boolean | null;
  /** The outcome for a row, or null. */
  outcome: (row: DailyRow, next: DailyRow | undefined) => number | null;
  text: (diff: number, nA: number, nB: number) => string;
}

function nightAfter(row: DailyRow, next: DailyRow | undefined): number | null {
  return next && next.asleepMinutes != null ? next.asleepMinutes : null;
}

const CANDIDATES: Candidate[] = [
  {
    key: 'late-workout-sleep',
    side: (r) => {
      if (r.lastWorkoutEndMs == null || r.workoutMinutes == null || r.workoutMinutes <= 0) return null;
      return r.lastWorkoutEndMinutes != null ? r.lastWorkoutEndMinutes >= LATE_WORKOUT_MINUTE : null;
    },
    outcome: nightAfter,
    text: COPY.lateWorkoutSleep,
  },
  {
    key: 'early-bed-hrv',
    side: (r) => (r.bedtimeMinutes == null ? null : r.bedtimeMinutes < LATE_BED_MINUTE),
    outcome: (r) => r.hrv,
    text: COPY.earlyBedHrv,
  },
  {
    key: 'sleep-finish',
    side: (r) => (r.asleepMinutes == null ? null : r.asleepMinutes >= LONG_SLEEP_MINUTES),
    outcome: (r) => r.lastTaskDoneMinutes,
    text: COPY.sleepFinish,
  },
  {
    key: 'water-sleep',
    side: (r) => r.waterDone,
    outcome: nightAfter,
    text: COPY.waterSleep,
  },
];

/** One candidate evaluated, or null when it does not qualify. */
export function evaluateCandidate(rows: DailyRow[], c: Candidate): Pattern | null {
  const a: number[] = [];
  const b: number[] = [];
  rows.forEach((row, i) => {
    const next = rows[i + 1];
    const side = c.side(row, next);
    if (side == null) return;
    const y = c.outcome(row, next);
    if (y == null) return;
    (side ? a : b).push(y);
  });
  if (a.length < MIN_SIDE || b.length < MIN_SIDE) return null;
  const s = spread([...a, ...b]);
  if (!s) return null;
  const diff = median(a)! - median(b)!;
  if (diff === 0) return null;
  return { key: c.key, text: c.text(diff, a.length, b.length), diff, nA: a.length, nB: b.length, score: Math.abs(diff) / s };
}

/** The patterns to show: qualifying, ranked, at most MAX_SHOWN. */
export function patterns(rows: DailyRow[]): Pattern[] {
  return CANDIDATES.map((c) => evaluateCandidate(rows, c))
    .filter((p): p is Pattern => p != null)
    .sort((x, y) => y.score - x.score)
    .slice(0, MAX_SHOWN);
}
