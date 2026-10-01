/**
 * BEFORE / NOW and LOAD & RECOVERY (Phase 38O, O1c–e). Pure, over the
 * daily series.
 *
 * BASELINE = the 14 days before Day 1. A metric has one only if at least
 * MIN_BASELINE_DAYS of those days have data. Medians, never means, and the
 * number of days behind every figure travels with it.
 */
import { formatHoursMinutes } from '../sleepNight.ts';
import { formatInteger } from '../intl.ts';
import { COPY, METRIC_COPY } from './copy.ts';
import type { DailyRow } from './series.ts';
import { median, quantile, roundTo } from './stats.ts';

export const MIN_BASELINE_DAYS = 5;
export const NOW_DAYS = 7;

export type MetricKey = keyof typeof METRIC_COPY;

export const METRIC_KEYS: MetricKey[] = [
  'asleepMinutes',
  'bedtimeMinutes',
  'wakeMinutes',
  'rhr',
  'hrv',
  'rr',
  'steps',
  'activeKcal',
  'workoutMinutes',
  'weightKg',
];

export interface Figure {
  value: number;
  /** Days behind the figure. */
  n: number;
}

export interface WeeklyPoint {
  /** Challenge week, 1-based. */
  week: number;
  value: number | null;
  n: number;
}

export interface BeforeNow {
  key: MetricKey;
  label: string;
  /** null when fewer than MIN_BASELINE_DAYS baseline days have data. */
  baseline: Figure | null;
  /** How many baseline days HAD data, whether or not that made a baseline. */
  baselineDays: number;
  now: Figure | null;
  /** now − baseline, when both exist. */
  diff: number | null;
  weekly: WeeklyPoint[];
}

/** A value as PROOF prints it, per metric. Never a grade. */
export function formatMetric(key: MetricKey, value: number, unit: 'metric' | 'imperial' = 'metric'): string {
  switch (key) {
    case 'asleepMinutes':
      return formatHoursMinutes(Math.round(value));
    case 'bedtimeMinutes': {
      const m = (value + 12 * 60) % (24 * 60);
      return clock(m);
    }
    case 'wakeMinutes':
      return clock(value);
    case 'rhr':
    case 'hrv':
      return `${Math.round(value)} ${METRIC_COPY[key].unit}`;
    case 'rr':
      return `${roundTo(value, 1)} ${METRIC_COPY.rr.unit}`;
    case 'steps':
      return formatInteger(Math.round(value));
    case 'activeKcal':
      return `${formatInteger(Math.round(value))} ${METRIC_COPY.activeKcal.unit}`;
    case 'workoutMinutes':
      return `${Math.round(value)} ${METRIC_COPY.workoutMinutes.unit}`;
    case 'weightKg':
      return unit === 'imperial' ? `${roundTo(value * 2.2046226218, 1)} lb` : `${roundTo(value, 1)} kg`;
    default:
      return String(value);
  }
}

/** A DIFFERENCE as printed: signed, in the metric's own terms. */
export function formatDiff(key: MetricKey, diff: number, unit: 'metric' | 'imperial' = 'metric'): string {
  const sign = diff > 0 ? '+' : diff < 0 ? '−' : '±';
  const a = Math.abs(diff);
  switch (key) {
    case 'asleepMinutes':
    case 'bedtimeMinutes':
    case 'wakeMinutes':
    case 'workoutMinutes':
      return `${sign}${formatHoursMinutes(Math.round(a))}`;
    case 'weightKg':
      return `${sign}${unit === 'imperial' ? `${roundTo(a * 2.2046226218, 1)} lb` : `${roundTo(a, 1)} kg`}`;
    case 'rr':
      return `${sign}${roundTo(a, 1)}`;
    default:
      return `${sign}${formatInteger(Math.round(a))}`;
  }
}

export function clock(minuteOfDay: number): string {
  const m = ((Math.round(minuteOfDay) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const h12 = h % 12 || 12;
  return `${h12}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

function valuesOf(rows: DailyRow[], key: MetricKey): number[] {
  return rows.map((r) => r[key]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
}

/** The baseline rows: day numbers 0 down to −13. */
export function baselineRows(rows: DailyRow[]): DailyRow[] {
  return rows.filter((r) => r.dayNumber <= 0);
}

export function challengeRows(rows: DailyRow[]): DailyRow[] {
  return rows.filter((r) => r.dayNumber >= 1);
}

/** Baseline median and its n, or null with the n it had. */
export function baselineOf(rows: DailyRow[], key: MetricKey): { figure: Figure | null; days: number } {
  const values = valuesOf(baselineRows(rows), key);
  if (values.length < MIN_BASELINE_DAYS) return { figure: null, days: values.length };
  return { figure: { value: median(values)!, n: values.length }, days: values.length };
}

/**
 * Before / now for one metric. Weight uses the FIRST baseline value and the
 * LATEST value instead of medians; everything else is medians.
 */
export function beforeNow(rows: DailyRow[], key: MetricKey): BeforeNow {
  const label = METRIC_COPY[key].label;
  const base = baselineRows(rows);
  const chal = challengeRows(rows);
  const last7 = rows.slice(-NOW_DAYS);

  let baseline: Figure | null = null;
  let baselineDays = 0;
  let now: Figure | null = null;

  if (key === 'weightKg') {
    const before = base.filter((r) => r.weightKg != null);
    baselineDays = before.length;
    if (before.length >= 1) baseline = { value: before[0].weightKg!, n: before.length };
    const during = chal.filter((r) => r.weightKg != null);
    if (during.length) now = { value: during[during.length - 1].weightKg!, n: during.length };
  } else {
    const b = baselineOf(rows, key);
    baseline = b.figure;
    baselineDays = b.days;
    const nowValues = valuesOf(last7, key);
    if (nowValues.length) now = { value: median(nowValues)!, n: nowValues.length };
  }

  // Week-by-week across the challenge, for the small trend line.
  const weekly: WeeklyPoint[] = [];
  const weeks = Math.max(0, Math.ceil(chal.length / 7));
  for (let w = 0; w < weeks; w += 1) {
    const slice = chal.filter((r) => Math.floor((r.dayNumber - 1) / 7) === w);
    const values = valuesOf(slice, key);
    const value =
      key === 'weightKg' ? (values.length ? values[values.length - 1] : null) : median(values);
    weekly.push({ week: w + 1, value, n: values.length });
  }

  return {
    key,
    label,
    baseline,
    baselineDays,
    now,
    diff: baseline && now ? now.value - baseline.value : null,
    weekly,
  };
}

/** Every metric, in display order. */
export function allBeforeNow(rows: DailyRow[]): BeforeNow[] {
  return METRIC_KEYS.map((k) => beforeNow(rows, k));
}

// ---------------------------------------------------------------------------
// Load & recovery.
// ---------------------------------------------------------------------------

export const LOAD_WINDOW = 7;
export const RHR_ABOVE_BPM = 5;
export const HRV_LOW_QUANTILE = 0.1;
export const OBSERVATION_NIGHTS = 3;

export interface LoadPoint {
  dateKey: string;
  dayNumber: number;
  /** Sum of the last 7 days' workout minutes; null when none of them had a value. */
  minutes: number | null;
  /** How many of the 7 days had a value. */
  n: number;
}

/** Rolling 7-day workout minutes, one point per challenge day. */
export function rollingLoad(rows: DailyRow[]): LoadPoint[] {
  const out: LoadPoint[] = [];
  rows.forEach((r, i) => {
    if (r.dayNumber < 1) return;
    const window = rows.slice(Math.max(0, i - LOAD_WINDOW + 1), i + 1);
    const values = window.map((x) => x.workoutMinutes).filter((v): v is number => v != null);
    out.push({
      dateKey: r.dateKey,
      dayNumber: r.dayNumber,
      minutes: values.length ? values.reduce((a, b) => a + b, 0) : null,
      n: values.length,
    });
  });
  return out;
}

export interface Observation {
  kind: 'rhr-above' | 'hrv-below';
  nights: number;
  text: string;
}

/**
 * The run of most recent CONSECUTIVE dates, each with a value, each meeting
 * `test`. Consecutive means calendar-consecutive: a missing night breaks
 * the run, because "3 nights in a row" has to mean three nights.
 */
function trailingRun(rows: DailyRow[], key: 'rhr' | 'hrv', test: (v: number) => boolean): number {
  let run = 0;
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const v = rows[i][key];
    if (v == null || !test(v)) break;
    run += 1;
  }
  return run;
}

/**
 * OBSERVATIONS. Only two, only against the person's OWN baseline, only when
 * the condition has held for OBSERVATION_NIGHTS consecutive nights. No
 * baseline means no observation, ever.
 */
export function observations(rows: DailyRow[]): Observation[] {
  const out: Observation[] = [];
  const chal = challengeRows(rows);

  const rhrBase = baselineOf(rows, 'rhr').figure;
  if (rhrBase) {
    const run = trailingRun(chal, 'rhr', (v) => v >= rhrBase.value + RHR_ABOVE_BPM);
    if (run >= OBSERVATION_NIGHTS) out.push({ kind: 'rhr-above', nights: run, text: COPY.rhrAbove(run) });
  }

  const hrvValues = valuesOf(baselineRows(rows), 'hrv');
  if (hrvValues.length >= MIN_BASELINE_DAYS) {
    const p10 = quantile(hrvValues, HRV_LOW_QUANTILE)!;
    const run = trailingRun(chal, 'hrv', (v) => v < p10);
    if (run >= OBSERVATION_NIGHTS) out.push({ kind: 'hrv-below', nights: run, text: COPY.hrvBelow(run) });
  }
  return out;
}

/** Whether recovery has anything to compare against at all. */
export function recoveryHasBaseline(rows: DailyRow[]): boolean {
  return baselineOf(rows, 'rhr').figure != null || baselineOf(rows, 'hrv').figure != null;
}
