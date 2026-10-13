/**
 * ONE ACTIVITY, MANY WRITERS (Phase 38N, section 0).
 *
 * An Apple Watch, an Oura ring, an Ultrahuman ring and the phone can all
 * write the same workout to Apple Health. Read raw, that is two or three
 * workouts where one happened, and a suggestion that offers to mark two
 * tasks complete off one gym session. Overlapping workouts are therefore
 * collapsed to one before anything reads them: the LONGER one is kept and
 * its source is named, so the suggestion can say where it came from.
 *
 * Pure. No react-native imports, proved in scripts/health-merge.test.mjs.
 */

export interface SourcedInterval {
  startMs: number;
  endMs: number;
  /** Where Apple Health says it came from — "Apple Watch", "Oura". */
  source: string;
}

/**
 * The name Apple Health carries for a source, made short. "Aly’s Apple
 * Watch" is the Watch, "iPhone" is the phone; anything else keeps its name
 * ("Oura", "Ultrahuman", "WHOOP", "MyFitnessPal"). A missing name is
 * "Apple Health": the reading is real, only its writer is unknown.
 */
export function sourceLabel(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (!name) return 'Apple Health';
  if (/apple watch/i.test(name)) return 'Apple Watch';
  if (/\biphone\b/i.test(name)) return 'iPhone';
  return name;
}

/** Whether two intervals share any time at all. Touching ends do not. */
export function overlaps(a: SourcedInterval, b: SourcedInterval): boolean {
  return a.startMs < b.endMs && b.startMs < a.endMs;
}

/**
 * Collapse overlapping workouts to one each. Whatever the writers, two
 * recordings that share time are one activity, and the longer recording is
 * the one that counts. Chronological on the way out.
 *
 * Same-source overlaps collapse too: a watch that wrote a segment twice is
 * still one workout.
 */
export function dedupeWorkouts<T extends SourcedInterval>(workouts: T[]): T[] {
  const byLength = [...workouts].sort(
    (a, b) => b.endMs - b.startMs - (a.endMs - a.startMs) || a.startMs - b.startMs,
  );
  const kept: T[] = [];
  for (const w of byLength) {
    if (w.endMs <= w.startMs) continue;
    if (kept.some((k) => overlaps(k, w))) continue;
    kept.push(w);
  }
  return kept.sort((a, b) => a.startMs - b.startMs);
}

/**
 * Total minutes of a set of intervals counted ONCE — the union, never the
 * sum. Two rings that both saw the same hour saw one hour.
 */
export function unionMinutes(intervals: { startMs: number; endMs: number }[]): number {
  const sorted = intervals
    .filter((i) => i.endMs > i.startMs)
    .sort((a, b) => a.startMs - b.startMs);
  let total = 0;
  let curStart: number | null = null;
  let curEnd = 0;
  for (const i of sorted) {
    if (curStart === null || i.startMs > curEnd) {
      if (curStart !== null) total += curEnd - curStart;
      curStart = i.startMs;
      curEnd = i.endMs;
    } else if (i.endMs > curEnd) {
      curEnd = i.endMs;
    }
  }
  if (curStart !== null) total += curEnd - curStart;
  return Math.round(total / 60_000);
}
