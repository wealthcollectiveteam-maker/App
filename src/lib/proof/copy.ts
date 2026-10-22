/**
 * EVERY USER-FACING SENTENCE IN PROOF, in one file (Phase 38O, O1g).
 *
 * THE TONE RULE: describe, never diagnose or prescribe. No "healthy", "good",
 * "bad", "should", no grading. Numbers, the number of days behind them, and
 * plain sentences. scripts/proof-copy.test.mjs reads this file, the rest of
 * src/lib/proof/ and the PROOF screens, and fails on any banned word.
 */
import { formatHoursMinutes } from '../sleepNight.ts';

export const COPY = {
  title: 'Proof',
  subtitle: 'What the challenge is doing to your body, from your own Apple Health, on this phone.',

  beforeNow: 'Before / now',
  beforeNowIntro: 'The 14 days before Day 1, against the last 7. Medians, with the number of days behind each.',
  beforeLabel: 'Before Day 1',
  nowLabel: 'Last 7 days',
  noBaseline: 'No baseline: nothing wrote this to Apple Health before Day 1.',
  noBaselineAny:
    'No baseline yet. Nothing in Apple Health covers the two weeks before Day 1 — a watch or ring worn before the challenge is what makes a before / now comparison possible.',
  noNowData: 'No data in the last 7 days.',

  loadRecovery: 'Load & recovery',
  loadIntro: 'Workout minutes over each rolling 7 days, and resting heart rate and HRV against your own pre-challenge normal.',
  loadNoWorkouts: 'No workouts in Apple Health or from completed tasks yet.',
  recoveryNoBaseline:
    'Resting heart rate and HRV have no pre-challenge normal to compare against, so there is nothing to observe.',
  recoveryQuiet: 'Nothing to observe: resting heart rate and HRV are within the range they held before Day 1.',

  patterns: 'What moves me',
  patternsIntro: 'Pairs from your own days. Each side needs at least 5 days.',
  patternsCaveat: 'A pattern in your own days, not proof of cause.',
  patternsNone:
    'No pattern to show yet. Each side of a pair needs at least 5 days, and the days have to differ from each other.',

  reports: 'Reports',
  halfwayTitle: 'Halfway report',
  finalTitle: (durationDays: number) => `Day ${durationDays} report`,
  reportLocked: (which: string, day: number) => `${which} unlocks on Day ${day}.`,
  reportOpen: 'Open',
  reportNothing: 'Nothing to report yet: Apple Health holds no data for this run.',
  totalWorkouts: 'Total workout time',
  nightsLogged: 'Nights logged',
  medianBedtime: 'Median bedtime',
  medianWake: 'Median wake time',
  topPattern: 'The strongest pattern in your days',

  reading: 'Reading Apple Health…',
  notOnWeb: 'Proof reads Apple Health on the phone. Open the iPhone app.',
  fromTasks: 'from tasks',
  days: (n: number) => `${n} day${n === 1 ? '' : 's'}`,
  nights: (n: number) => `${n} night${n === 1 ? '' : 's'}`,
  nightsInARow: (n: number) => `${n} nights in a row`,

  /** An OBSERVATION. Exactly this shape: what, relative to what, for how long. */
  rhrAbove: (nights: number) =>
    `Your resting heart rate has been above your pre-challenge normal for ${nights} nights in a row.`,
  hrvBelow: (nights: number) =>
    `Your HRV has been below the range it held before the challenge for ${nights} nights in a row.`,

  /** Patterns. Median difference and n on each side, always. */
  lateWorkoutSleep: (diffMin: number, nLate: number, nEarly: number) =>
    `After a workout that ended past 7 PM you slept ${formatHoursMinutes(Math.abs(Math.round(diffMin)))} ${
      diffMin < 0 ? 'less' : 'more'
    } that night (${nLate} days vs ${nEarly} days).`,
  earlyBedHrv: (diffMs: number, nEarly: number, nLate: number) =>
    `After a bedtime before 11 PM your HRV was ${Math.abs(Math.round(diffMs))} ms ${
      diffMs < 0 ? 'lower' : 'higher'
    } (${nEarly} nights vs ${nLate} nights).`,
  sleepFinish: (diffMin: number, nLong: number, nShort: number) =>
    `After 7h+ of sleep you finished your list ${formatHoursMinutes(Math.abs(Math.round(diffMin)))} ${
      diffMin < 0 ? 'earlier' : 'later'
    } (${nLong} days vs ${nShort} days).`,
  waterSleep: (diffMin: number, nDone: number, nNot: number) =>
    `On days the water task was done you slept ${formatHoursMinutes(Math.abs(Math.round(diffMin)))} ${
      diffMin < 0 ? 'less' : 'more'
    } that night (${nDone} days vs ${nNot} days).`,
} as const;

/** Metric names and units, as shown. */
export const METRIC_COPY = {
  asleepMinutes: { label: 'Asleep', unit: '' },
  bedtimeMinutes: { label: 'Bedtime', unit: '' },
  wakeMinutes: { label: 'Wake time', unit: '' },
  rhr: { label: 'Resting heart rate', unit: 'bpm' },
  hrv: { label: 'HRV', unit: 'ms' },
  rr: { label: 'Respiratory rate', unit: '/min' },
  steps: { label: 'Steps', unit: '' },
  activeKcal: { label: 'Active energy', unit: 'kcal' },
  workoutMinutes: { label: 'Workout minutes', unit: 'min' },
  weightKg: { label: 'Weight', unit: '' },
} as const;
