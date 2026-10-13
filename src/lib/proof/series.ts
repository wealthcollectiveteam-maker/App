/**
 * THE DAILY SERIES (Phase 38O, O1b). One row per date from Day 1 − 14 to
 * today, in the challenge zone, built from arrays the service already read.
 * This module never calls HealthKit; everything is testable with fixtures.
 *
 * WHERE EACH COLUMN COMES FROM
 *   asleep / bedtime / wake  lib/sleepNight.ts, the night that ENDED on the
 *                            date (union across writers, naps excluded)
 *   rhr / hrv / rr           the night's value as 38N defines it: the mean
 *                            of the samples inside the night (±1 h); with
 *                            no night, the mean of that date's samples
 *   steps / active energy    HealthKit's statistics COLLECTION, one bucket
 *                            per day, sources merged (see HealthService
 *                            getDailySeries and the citation there)
 *   workout minutes          38N's merged workouts, bucketed by the date
 *                            they started; a challenge day with none in
 *                            Health but workout TASKS completed takes the
 *                            task durations instead and is marked "tasks"
 *   weight                   a Health body-mass sample on the date, else
 *                            the user's own weekly check-in on the date
 *   last task done           the latest task_completions.completed_at of
 *                            that challenge day (the user's own rows)
 *   water done               whether the day's snapshot had a water task
 *                            and it was completed
 */
import type { SleepSample } from '../sleepNight.ts';
import { dateKeyIn, sleepNightFor, wakeMinuteOfDay } from '../sleepNight.ts';
import { wallClockIn } from '../intl.ts';
import { dateKeysBetween, day1DateKey, dayNumberOf, shiftDateKey } from './dates.ts';
import { mean } from './stats.ts';

export const BASELINE_DAYS = 14;

export interface DiscretePoint {
  value: number;
  endMs: number;
}

export interface WorkoutPoint {
  startISO: string;
  minutes: number;
  source: string;
}

export interface WeightPoint {
  kg: number;
  /** Milliseconds since epoch. */
  atMs: number;
}

export interface CompletionRow {
  day: number;
  taskKey: string;
  /** task_completions.completed_at, as milliseconds. */
  completedAtMs: number;
  /** task_completions.duration_seconds, when the timer recorded one. */
  durationSeconds: number | null;
}

export interface SnapshotRow {
  day: number;
  tasks: { key: string; target: { value: number; unit: string } | null }[];
}

export interface ProofInputs {
  /** Today's date in the challenge zone. */
  todayKey: string;
  currentDay: number;
  durationDays: number;
  zone: string | undefined;
  /** null = the query did not run. */
  sleep: SleepSample[] | null;
  rhr: DiscretePoint[] | null;
  hrv: DiscretePoint[] | null;
  rr: DiscretePoint[] | null;
  /** Date key (as the collection bucketed it) → total. null = not read. */
  stepsByDate: Record<string, number> | null;
  energyByDate: Record<string, number> | null;
  workouts: WorkoutPoint[] | null;
  weights: WeightPoint[] | null;
  checkins: WeightPoint[];
  completions: CompletionRow[];
  snapshots: SnapshotRow[];
}

export interface DailyRow {
  dateKey: string;
  /** 1 on Day 1; 0 and below are the baseline. */
  dayNumber: number;
  asleepMinutes: number | null;
  bedtimeMs: number | null;
  wakeMs: number | null;
  /** Bedtime as minutes after NOON, so 23:00 (660) and 00:30 (750) order. */
  bedtimeMinutes: number | null;
  /** Wake as minutes after midnight, challenge zone. */
  wakeMinutes: number | null;
  sleepSources: string[];
  rhr: number | null;
  hrv: number | null;
  rr: number | null;
  steps: number | null;
  activeKcal: number | null;
  workoutMinutes: number | null;
  workoutsFrom: 'health' | 'tasks' | null;
  /** End of the last workout that day, for "finished after 7 PM". */
  lastWorkoutEndMs: number | null;
  /** The same, as minutes after midnight in the challenge zone. */
  lastWorkoutEndMinutes: number | null;
  weightKg: number | null;
  weightFrom: 'health' | 'checkin' | null;
  /** Latest completion of the day, minutes after midnight, challenge zone. */
  lastTaskDoneMinutes: number | null;
  tasksTotal: number | null;
  tasksDone: number | null;
  /** null when the day had no water task or no snapshot. */
  waterDone: boolean | null;
}

function nightValue(
  samples: DiscretePoint[] | null,
  night: { bedtimeMs: number; wakeMs: number } | null,
  dateKey: string,
  zone: string | undefined,
): number | null {
  if (!samples) return null;
  if (night) {
    const inNight = samples.filter(
      (s) => s.endMs >= night.bedtimeMs - 3_600_000 && s.endMs <= night.wakeMs + 3_600_000,
    );
    const m = mean(inNight.map((s) => s.value));
    if (m != null) return m;
  }
  return mean(samples.filter((s) => dateKeyIn(s.endMs, zone) === dateKey).map((s) => s.value));
}

export function bedtimeMinutesAfterNoon(bedtimeMs: number, zone: string | undefined): number {
  const w = wallClockIn(bedtimeMs, zone);
  let m = w.hour * 60 + w.minute;
  if (m < 12 * 60) m += 24 * 60;
  return m - 12 * 60;
}

export function minuteOfDay(ms: number, zone: string | undefined): number {
  const w = wallClockIn(ms, zone);
  return w.hour * 60 + w.minute;
}

/** The whole span: 14 baseline days, then Day 1 to today. */
export function buildDailySeries(input: ProofInputs): DailyRow[] {
  const day1 = day1DateKey(input.todayKey, input.currentDay);
  const start = shiftDateKey(day1, -BASELINE_DAYS);
  const keys = dateKeysBetween(start, input.todayKey);
  const snapshotByDay = new Map(input.snapshots.map((s) => [s.day, s]));
  const completionsByDay = new Map<number, CompletionRow[]>();
  for (const c of input.completions) {
    const list = completionsByDay.get(c.day) ?? [];
    list.push(c);
    completionsByDay.set(c.day, list);
  }

  return keys.map((dateKey) => {
    const dayNumber = dayNumberOf(dateKey, day1);
    const night = input.sleep ? sleepNightFor(input.sleep, dateKey, input.zone) : null;

    // Workouts that STARTED on this date, in the challenge zone.
    let workoutMinutes: number | null = null;
    let workoutsFrom: DailyRow['workoutsFrom'] = null;
    let lastWorkoutEndMs: number | null = null;
    if (input.workouts) {
      const todays = input.workouts.filter((w) => dateKeyIn(Date.parse(w.startISO), input.zone) === dateKey);
      if (todays.length) {
        workoutMinutes = todays.reduce((s, w) => s + w.minutes, 0);
        workoutsFrom = 'health';
        lastWorkoutEndMs = Math.max(...todays.map((w) => Date.parse(w.startISO) + w.minutes * 60_000));
      } else {
        workoutMinutes = 0;
        workoutsFrom = 'health';
      }
    }
    const snapshot = dayNumber >= 1 ? snapshotByDay.get(dayNumber) : undefined;
    const done = dayNumber >= 1 ? completionsByDay.get(dayNumber) ?? [] : [];
    if (dayNumber >= 1 && !(workoutMinutes && workoutMinutes > 0) && snapshot) {
      // No Health workout on a challenge day: the completed workout TASKS
      // stand in, with the timer's duration when it recorded one.
      let fromTasks = 0;
      let lastEnd: number | null = null;
      for (const t of snapshot.tasks) {
        if (!/^workout/.test(t.key)) continue;
        const c = done.find((x) => x.taskKey === t.key);
        if (!c) continue;
        const minutes =
          c.durationSeconds != null && c.durationSeconds > 0
            ? c.durationSeconds / 60
            : t.target?.unit === 'minutes'
              ? t.target.value
              : 0;
        fromTasks += minutes;
        lastEnd = Math.max(lastEnd ?? 0, c.completedAtMs);
      }
      if (fromTasks > 0) {
        workoutMinutes = Math.round(fromTasks);
        workoutsFrom = 'tasks';
        lastWorkoutEndMs = lastEnd;
      }
    }

    // Weight: Health first, the user's own check-in second.
    let weightKg: number | null = null;
    let weightFrom: DailyRow['weightFrom'] = null;
    const onDate = (p: WeightPoint) => dateKeyIn(p.atMs, input.zone) === dateKey;
    const healthW = (input.weights ?? []).filter(onDate).sort((a, b) => b.atMs - a.atMs)[0];
    if (healthW) {
      weightKg = healthW.kg;
      weightFrom = 'health';
    } else {
      const checkin = input.checkins.filter(onDate).sort((a, b) => b.atMs - a.atMs)[0];
      if (checkin) {
        weightKg = checkin.kg;
        weightFrom = 'checkin';
      }
    }

    const lastTask = done.length ? Math.max(...done.map((c) => c.completedAtMs)) : null;
    const waterTask = snapshot?.tasks.find((t) => t.key === 'water');

    return {
      dateKey,
      dayNumber,
      asleepMinutes: night ? night.asleepMinutes : null,
      bedtimeMs: night ? night.bedtimeMs : null,
      wakeMs: night ? night.wakeMs : null,
      bedtimeMinutes: night ? bedtimeMinutesAfterNoon(night.bedtimeMs, input.zone) : null,
      wakeMinutes: night ? wakeMinuteOfDay(night.wakeMs, input.zone) : null,
      sleepSources: night ? night.sources : [],
      rhr: nightValue(input.rhr, night, dateKey, input.zone),
      hrv: nightValue(input.hrv, night, dateKey, input.zone),
      rr: nightValue(input.rr, night, dateKey, input.zone),
      steps: input.stepsByDate ? input.stepsByDate[dateKey] ?? null : null,
      activeKcal: input.energyByDate ? input.energyByDate[dateKey] ?? null : null,
      workoutMinutes,
      workoutsFrom,
      lastWorkoutEndMs,
      lastWorkoutEndMinutes: lastWorkoutEndMs != null ? minuteOfDay(lastWorkoutEndMs, input.zone) : null,
      weightKg,
      weightFrom,
      lastTaskDoneMinutes: lastTask != null ? minuteOfDay(lastTask, input.zone) : null,
      tasksTotal: snapshot ? snapshot.tasks.length : null,
      tasksDone: snapshot ? done.length : null,
      waterDone: waterTask ? done.some((c) => c.taskKey === 'water') : null,
    };
  });
}
