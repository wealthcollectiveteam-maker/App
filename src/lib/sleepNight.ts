/**
 * WHAT COUNTS AS "LAST NIGHT" AND "WOKE UP" (Phase 38N, N2).
 *
 * Pure. No react-native imports; the timezone work goes through
 * ./intl.ts, which is itself proved in Node. Tests: scripts/health-sleep.test.mjs.
 *
 * THE RULES, as the brief set them and as this file keeps them:
 *
 *   a. Sleep for challenge day D is the MAIN sleep that ENDS on D's calendar
 *      date, in the CHALLENGE timezone, not the phone's. Naps are separate
 *      sessions and never count toward the night.
 *   b. Oura and an Apple Watch can both write the same night. Overlapping
 *      asleep intervals are merged as a UNION, never added. Per-source totals
 *      are reported alongside so a double count would be visible.
 *   c. Asleep time is the union of the asleep stages — core, deep, REM and
 *      unspecified asleep — not "in bed".
 *   d. Wake time is the end of the last asleep interval of that main sleep.
 *
 * HOW A "SESSION" IS FOUND. Asleep intervals from every source are pooled
 * and sorted; a gap of more than SESSION_GAP_MS between one interval's end
 * and the next's start closes a session. Brief awakenings inside a night are
 * shorter than that and stay inside it; an afternoon nap is hours from the
 * night and becomes its own session. Of the sessions that end on date D,
 * the LONGEST is the main sleep. The others are naps.
 *
 * HKCategoryValueSleepAnalysis, from the installed library
 * (src/generated/healthkit.generated.ts, `CategoryValueSleepAnalysis`):
 *   inBed 0, asleepUnspecified 1, awake 2, asleepCore 3, asleepDeep 4,
 *   asleepREM 5. Only 1, 3, 4 and 5 are sleep.
 */
import { wallClockIn } from './intl.ts';

export interface SleepSample {
  startMs: number;
  endMs: number;
  /** HKCategoryValueSleepAnalysis raw value. */
  value: number;
  /** Shortened source name — see healthMerge.sourceLabel. */
  source: string;
}

export type SleepStage = 'core' | 'deep' | 'rem' | 'unspecified';

/** Sessions closer together than this are one night. */
export const SESSION_GAP_MS = 2 * 60 * 60 * 1000;

const STAGE_BY_VALUE: Record<number, SleepStage> = {
  1: 'unspecified',
  3: 'core',
  4: 'deep',
  5: 'rem',
};

/** The asleep stage for a raw value, or null for in-bed, awake, unknown. */
export function asleepStage(value: unknown): SleepStage | null {
  if (typeof value !== 'number') return null;
  return STAGE_BY_VALUE[value] ?? null;
}

export interface SleepNight {
  /** The challenge-zone calendar date this night ended on, YYYY-MM-DD. */
  dateKey: string;
  /** Union of asleep intervals, all sources. */
  asleepMinutes: number;
  /** Start of the first asleep interval. */
  bedtimeMs: number;
  /** End of the last asleep interval. */
  wakeMs: number;
  /** Minutes per stage, from the source with stage detail (union within it). */
  stages: Partial<Record<SleepStage, number>> | null;
  /** Which writers contributed, alphabetical. */
  sources: string[];
  /** Union per source — so Oura 7h + Watch 7h reading as 14h would show. */
  perSource: { source: string; asleepMinutes: number }[];
  /** Sessions that ended the same date but were not the main sleep. */
  napMinutes: number;
}

/** YYYY-MM-DD for an instant, in `zone` (device zone when undefined). */
export function dateKeyIn(ms: number, zone: string | undefined): string {
  const w = wallClockIn(ms, zone);
  return `${w.year}-${String(w.month).padStart(2, '0')}-${String(w.day).padStart(2, '0')}`;
}

interface Interval {
  startMs: number;
  endMs: number;
  stage: SleepStage;
  source: string;
}

function unionMs(intervals: { startMs: number; endMs: number }[]): number {
  const sorted = [...intervals].sort((a, b) => a.startMs - b.startMs);
  let total = 0;
  let s: number | null = null;
  let e = 0;
  for (const i of sorted) {
    if (s === null || i.startMs > e) {
      if (s !== null) total += e - s;
      s = i.startMs;
      e = i.endMs;
    } else if (i.endMs > e) {
      e = i.endMs;
    }
  }
  if (s !== null) total += e - s;
  return total;
}

/** Group asleep intervals into sessions separated by SESSION_GAP_MS. */
function sessions(intervals: Interval[]): Interval[][] {
  const sorted = [...intervals].sort((a, b) => a.startMs - b.startMs);
  const out: Interval[][] = [];
  let cur: Interval[] = [];
  let curEnd = -Infinity;
  for (const i of sorted) {
    if (cur.length && i.startMs - curEnd > SESSION_GAP_MS) {
      out.push(cur);
      cur = [];
    }
    cur.push(i);
    curEnd = Math.max(curEnd, i.endMs);
  }
  if (cur.length) out.push(cur);
  return out;
}

/**
 * The main sleep that ended on `dateKey` in `zone`, or null when there is
 * none. `samples` may span any number of nights and sources; only asleep
 * stages are read, in-bed and awake records are ignored.
 */
export function sleepNightFor(
  samples: SleepSample[],
  dateKey: string,
  zone: string | undefined,
): SleepNight | null {
  const intervals: Interval[] = [];
  for (const s of samples) {
    const stage = asleepStage(s.value);
    if (!stage) continue;
    if (!(s.endMs > s.startMs)) continue;
    intervals.push({ startMs: s.startMs, endMs: s.endMs, stage, source: s.source });
  }
  if (!intervals.length) return null;

  const ending = sessions(intervals).filter((sess) => {
    const wake = Math.max(...sess.map((i) => i.endMs));
    return dateKeyIn(wake, zone) === dateKey;
  });
  if (!ending.length) return null;

  const scored = ending
    .map((sess) => ({ sess, ms: unionMs(sess) }))
    .sort((a, b) => b.ms - a.ms);
  const main = scored[0].sess;
  const napMs = scored.slice(1).reduce((sum, x) => sum + x.ms, 0);

  const sources = [...new Set(main.map((i) => i.source))].sort();
  const perSource = sources.map((source) => ({
    source,
    asleepMinutes: Math.round(unionMs(main.filter((i) => i.source === source)) / 60_000),
  }));

  // Stages: from the ONE source with the most stage detail, so two writers
  // with different stage opinions do not get added on top of each other.
  const staged = sources
    .map((source) => ({
      source,
      detail: main.filter((i) => i.source === source && i.stage !== 'unspecified'),
    }))
    .filter((x) => x.detail.length > 0)
    .sort((a, b) => unionMs(b.detail) - unionMs(a.detail));
  let stages: SleepNight['stages'] = null;
  if (staged.length) {
    const own = main.filter((i) => i.source === staged[0].source);
    stages = {};
    for (const stage of ['core', 'deep', 'rem', 'unspecified'] as SleepStage[]) {
      const ms = unionMs(own.filter((i) => i.stage === stage));
      if (ms > 0) stages[stage] = Math.round(ms / 60_000);
    }
  }

  return {
    dateKey,
    asleepMinutes: Math.round(unionMs(main) / 60_000),
    bedtimeMs: Math.min(...main.map((i) => i.startMs)),
    wakeMs: Math.max(...main.map((i) => i.endMs)),
    stages,
    sources,
    perSource,
    napMinutes: Math.round(napMs / 60_000),
  };
}

/** "7h 12m" — never a decimal hour, never a grade. */
export function formatHoursMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/**
 * Minutes after midnight of the wake instant, in `zone`. What "woke up by
 * 06:00" compares against.
 */
export function wakeMinuteOfDay(wakeMs: number, zone: string | undefined): number {
  const w = wallClockIn(wakeMs, zone);
  return w.hour * 60 + w.minute;
}
