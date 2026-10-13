/**
 * THE CALENDAR DATE A DAY NUMBER MEANS (Phase 20, P3).
 *
 * Every label in this app is a day number — "Day 18", "DAY 17 CLOSED AT NOON".
 * A day number is a fine name for a thing you are in the middle of and a
 * useless one at 12:20 AM, when the question is not "which day of my
 * challenge" but "is this the day that just ended or the one that just
 * started". Nobody knows whether day 18 is today or yesterday. A weekday and a
 * date, they know instantly.
 *
 * WHY THE DATE IS DERIVED FROM closes_at AND NOT FROM THE DEVICE CLOCK.
 * `day_closes_at(c, day)` is noon, in the CHALLENGE's timezone, on the day
 * AFTER the one it names. That instant is the server's own arithmetic, carried
 * to the client rather than recomputed, exactly like `open`. Read in the
 * challenge's timezone, its calendar date is the following day; one calendar
 * day earlier is the day itself. That gives the same answer regardless of
 * where the phone is or what its clock says — which is the entire reason the
 * boundary is server-owned in the first place.
 *
 * CALENDAR DAYS, NEVER HOURS (Phase 24). This used to subtract twelve hours and
 * a millisecond from closes_at, which assumes midnight-to-noon is twelve hours
 * long. On 1 November 2026 in New York it is thirteen: the result landed at
 * 00:59 on the 1st, and Saturday 31 October — day 69 of the live challenge —
 * was labelled "Sunday, November 1", the same label as day 70. Stepping back a
 * calendar date cannot be an hour out on any day of the year.
 *
 * A phone set to the wrong day, or carried across a timezone, must not be able
 * to make this label disagree with the day the server will write to.
 *
 * Kept free of react-native imports so scripts/day-boundary.test.mjs can run
 * it in plain Node.
 */
// With the extension: this module also runs in plain Node for its test,
// where an extension-less relative import does not resolve
// (tsconfig allowImportingTsExtensions).
import { type CalendarOptions, formatCalendar, wallClockIn, zoneIsUsable } from './intl.ts';

/**
 * The calendar date of the day that closes at `closesAtISO`, as an instant at
 * NOON UTC on that date — so formatting it with `timeZone: 'UTC'` prints that
 * date and nothing else, whatever zone the formatter itself runs in.
 *
 * `zone` undefined reads closes_at in the device's zone. Throws for an IANA
 * name this runtime does not know; the caller decides what to fall back to.
 */
function dayThatCloses(closesAtISO: string, zone: string | undefined): Date | null {
  const closes = Date.parse(closesAtISO);
  if (Number.isNaN(closes)) return null;
  // Phase 38I: through lib/intl.ts, which falls back to the device's clock
  // on a runtime without zone data rather than throwing.
  const w = wallClockIn(closes, zone);
  if (![w.year, w.month, w.day].every(Number.isFinite)) return null;
  // closes_at falls on the day AFTER the one it names. Date.UTC rolls day 0
  // back into the previous month, and the previous year, correctly.
  return new Date(Date.UTC(w.year, w.month - 1, w.day - 1, 12));
}

function labelFor(
  closesAtISO: string | null | undefined,
  timeZone: string | null,
  options: Omit<CalendarOptions, 'timeZone'>,
): string | null {
  if (!closesAtISO) return null;
  // An unknown IANA zone: better a label in the device's zone than none.
  const zone = timeZone && zoneIsUsable(timeZone) ? timeZone : undefined;
  const date = dayThatCloses(closesAtISO, zone);
  return date ? formatCalendar(date, { ...options, timeZone: 'UTC' }) : null;
}

/**
 * "Wednesday 10 September" for the day that closes at `closesAtISO`.
 *
 * `timeZone` is the CHALLENGE's zone. When it is unknown — an older mirror, a
 * config read that has not landed — the platform default is used rather than
 * inventing one; the label is then still right for anyone whose phone is in
 * the challenge's zone, which is everyone until they travel, and the caller
 * can tell the two cases apart because `timeZone` was null when it asked.
 *
 * Returns null when the instant cannot be parsed, so a caller renders nothing
 * rather than "Invalid Date".
 */
export function dayDateLabel(
  closesAtISO: string | null | undefined,
  timeZone: string | null,
): string | null {
  return labelFor(closesAtISO, timeZone, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

/** The same date, short, for a chip: "Wed 10 Sep". */
export function dayDateLabelShort(
  closesAtISO: string | null | undefined,
  timeZone: string | null,
): string | null {
  return labelFor(closesAtISO, timeZone, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}
