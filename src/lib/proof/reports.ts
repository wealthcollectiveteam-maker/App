/**
 * HALFWAY AND FINAL REPORTS (Phase 38O, O3). One-screen summaries built only
 * from the model. Pure.
 *
 * Halfway unlocks on ceil(duration / 2) — the same day the HALFWAY badge is
 * earned (src/app/(tabs)/you.tsx badgesFor) — and the final report on the
 * last day. Only what exists is rendered: someone with a phone and no watch
 * gets steps and workouts, not a wall of "no data".
 */
import { COPY } from './copy.ts';
import { allBeforeNow, challengeRows, type BeforeNow } from './metrics.ts';
import { patterns, type Pattern } from './patterns.ts';
import type { DailyRow } from './series.ts';
import { median } from './stats.ts';

export type ReportKind = 'halfway' | 'final';

export function halfwayDay(durationDays: number): number {
  return Math.ceil(durationDays / 2);
}

export function unlockDay(kind: ReportKind, durationDays: number): number {
  return kind === 'halfway' ? halfwayDay(durationDays) : durationDays;
}

export interface Report {
  kind: ReportKind;
  title: string;
  unlockDay: number;
  unlocked: boolean;
  /** The metrics that have BOTH a baseline and a now. */
  beforeNow: BeforeNow[];
  /** Metrics with no baseline are named once, not listed as rows. */
  withoutBaseline: string[];
  totalWorkoutMinutes: number | null;
  /** How many challenge days had a workout value at all. */
  workoutDays: number;
  nightsLogged: number;
  medianBedtimeMinutes: number | null;
  medianWakeMinutes: number | null;
  topPattern: Pattern | null;
  /** True when the report would show nothing at all. */
  empty: boolean;
}

export function report(kind: ReportKind, rows: DailyRow[], currentDay: number, durationDays: number): Report {
  const unlock = unlockDay(kind, durationDays);
  const unlocked = currentDay >= unlock;
  const chal = challengeRows(rows);
  const all = allBeforeNow(rows);
  const beforeNow = all.filter((m) => m.baseline && m.now);
  const withoutBaseline = all.filter((m) => !m.baseline).map((m) => m.label);
  const workoutRows = chal.filter((r) => r.workoutMinutes != null);
  const totalWorkoutMinutes = workoutRows.length
    ? workoutRows.reduce((s, r) => s + (r.workoutMinutes ?? 0), 0)
    : null;
  const nights = chal.filter((r) => r.asleepMinutes != null);
  const medianBedtimeMinutes = median(nights.map((r) => r.bedtimeMinutes!).filter((v) => v != null));
  const medianWakeMinutes = median(nights.map((r) => r.wakeMinutes!).filter((v) => v != null));
  const top = patterns(rows)[0] ?? null;
  const empty =
    beforeNow.length === 0 && totalWorkoutMinutes == null && nights.length === 0 && top == null;
  return {
    kind,
    title: kind === 'halfway' ? COPY.halfwayTitle : COPY.finalTitle(durationDays),
    unlockDay: unlock,
    unlocked,
    beforeNow,
    withoutBaseline,
    totalWorkoutMinutes,
    workoutDays: workoutRows.length,
    nightsLogged: nights.length,
    medianBedtimeMinutes,
    medianWakeMinutes,
    topPattern: top,
    empty,
  };
}
