/**
 * Calendar arithmetic on YYYY-MM-DD keys (Phase 38O). Pure.
 *
 * The keys are produced by lib/sleepNight.ts dateKeyIn(ms, zone) — a date in
 * the CHALLENGE zone — and everything here shifts and compares them without
 * ever going back through a clock, so a phone in another zone cannot move
 * a day.
 */

function parts(key: string): [number, number, number] {
  const [y, m, d] = key.split('-').map(Number);
  return [y, m, d];
}

function toKey(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** `key` plus `days` calendar days (negative to go back). */
export function shiftDateKey(key: string, days: number): string {
  const [y, m, d] = parts(key);
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000;
  const dt = new Date(t);
  return toKey(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/** Whole days from `a` to `b`; negative when `b` is earlier. */
export function daysBetweenKeys(a: string, b: string): number {
  const [ay, am, ad] = parts(a);
  const [by, bm, bd] = parts(b);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/**
 * THE DAY 1 DATE. The date the current day number counts from:
 * today − (current day − 1), in the challenge zone.
 *
 * Right for a restored run too: the day number continues from the original
 * Day 1 after a restore, so counting back from today's number lands on the
 * original date, not on the day the run was restored.
 */
export function day1DateKey(todayKey: string, currentDay: number): string {
  return shiftDateKey(todayKey, -(Math.max(1, currentDay) - 1));
}

/** Every key from `startKey` to `endKey` inclusive, ascending. */
export function dateKeysBetween(startKey: string, endKey: string): string[] {
  const n = daysBetweenKeys(startKey, endKey);
  if (n < 0) return [];
  const out: string[] = [];
  for (let i = 0; i <= n; i += 1) out.push(shiftDateKey(startKey, i));
  return out;
}

/** 1 on Day 1, 0 the day before, −13 fourteen days before. */
export function dayNumberOf(dateKey: string, day1Key: string): number {
  return daysBetweenKeys(day1Key, dateKey) + 1;
}

/** Weekday for a key, 0 = Sunday. */
export function weekdayOf(key: string): number {
  const [y, m, d] = parts(key);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
