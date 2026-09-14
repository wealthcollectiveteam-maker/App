/**
 * WHICH DAY A TAP IS RECORDED AGAINST (Phase 20).
 *
 * THE DEFECT THIS EXISTS FOR. The check-in screen picked the day it DISPLAYED
 * from the store, and the day it WROTE to was picked by the server, at write
 * time, from `coalesce(p_day, challenge_day(c))`. Two clocks, consulted at two
 * different moments. For most of every day they agree and nothing is visibly
 * wrong. Inside the grace window they do not: at 00:20 on 2026-09-10 the
 * previous day was still open, the screen was still showing it, and thirteen
 * seconds apart two taps landed on day 3 while eleven landed on day 2.
 *
 * THE FIX IS NOT A BETTER GUESS. It is that there is only one answer to guess
 * at. `writeDay()` is called by the screen to decide what to render and by the
 * store to decide what to send, so the displayed day and the written day are
 * the same value by construction rather than by agreement. A divergence would
 * now require the two callers to pass different views of the world, which is a
 * far louder kind of bug than a silent off-by-one at midnight.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. It does not guess intent. There is no
 * "it is before 3am so they probably mean yesterday" rule here and there must
 * never be one: a rule that is right most of the time and silently wrong the
 * rest is the failure being fixed, not a cure for it. The default stays
 * `today`, because most taps on most days are for today. What changes is that
 * the choice is now stated out loud instead of left to whichever clock
 * answered last.
 *
 * Kept free of react-native imports so scripts/day-boundary.test.mjs can run
 * it in plain Node — the same reason pingRollback.ts and checkinCard.ts exist.
 */

/** Which deck the check-in screen is showing. Defaults to 'today'. */
export type ActiveDay = 'today' | 'yesterday';

/** The previous day, while the server still calls it open. */
export interface PreviousDay {
  day: number;
  /** The SERVER's answer. Never recomputed from the device clock. */
  open: boolean;
}

/**
 * Everything the decision needs, and nothing else.
 *
 * `today` is the day number the server's day window called `is_today`. It may
 * be stale — see `dayWindowIsStale` — and that is precisely why it is passed
 * in rather than read from a clock here: a stale day that the screen is also
 * showing produces a write to the day the user was looking at, which is the
 * property we want. Freshness is a separate concern with a separate answer.
 */
export interface DayView {
  activeDay: ActiveDay;
  today: number;
  yesterday: PreviousDay | null;
}

/**
 * The day a completion, an uncompletion or a seal must name.
 *
 * ALWAYS A NUMBER. Never undefined, never null — the whole point is that the
 * client stops omitting it and the server stops having to guess. The server's
 * `coalesce(p_day, challenge_day(c))` stays exactly as it is: it remains a
 * correct default for any caller that omits the day. This client is simply no
 * longer one of those callers.
 *
 * The previous day is chosen only when the user has explicitly switched to it
 * AND the server still calls it open. An `activeDay` of 'yesterday' left over
 * from before the window closed resolves back to today rather than writing
 * into a day the server would refuse.
 */
export function writeDay(view: DayView): number {
  const { activeDay, today, yesterday } = view;
  if (activeDay === 'yesterday' && yesterday && yesterday.open) {
    return yesterday.day;
  }
  return today;
}

/**
 * True when the day window was fetched on a different local calendar day than
 * the one we are now in — so `today` may name a day that has since rolled.
 *
 * Compares local date KEYS, not instants: the question is "has the date
 * changed on this device since we last asked the server", and that is a
 * calendar question. A null `fetchedOn` means nothing has been fetched yet,
 * which is not staleness — there is simply no window to be stale.
 */
export function dayWindowIsStale(
  fetchedOn: string | null,
  todayKey: string,
): boolean {
  return fetchedOn !== null && fetchedOn !== todayKey;
}

/**
 * Milliseconds from `now` until the next DAY BOUNDARY — noon or midnight,
 * whichever comes first — on the CHALLENGE's wall clock.
 *
 * TWO BOUNDARIES, because a day window goes stale at both. Midnight is when
 * today rolls and yesterday opens; noon is when yesterday closes. An app left
 * open across either one is showing a window the server has moved on from.
 *
 * THE CHALLENGE'S ZONE, NOT THE PHONE'S (Phase 24). Every boundary in this
 * schema is measured in challenges.timezone — challenge_day() and
 * day_closes_at(), 0011. The helper this replaced read the device's midnight,
 * so a phone in another zone refreshed hours before or after the roll it
 * existed to catch, and a phone-zone noon would have doubled that error. A
 * null zone (not hydrated yet) or an IANA name this runtime rejects falls
 * back to the device's zone, which is right for everyone who has not
 * travelled.
 *
 * Wall time is resolved through Intl, never by adding hours: the day New York
 * falls back is 25 hours long and the day it springs forward is 23.
 *
 * Never returns less than one second: a timer scheduled for the instant it
 * fires would spin.
 */
export function msUntilNextBoundary(now: Date, timeZone: string | null): number {
  const zone = usableZone(timeZone);
  const at = now.getTime();
  const w = wallClock(at, zone);
  const target =
    w.hour < 12
      ? zonedInstant(w.year, w.month, w.day, 12, zone)
      : zonedInstant(w.year, w.month, w.day + 1, 0, zone);
  return Math.max(1000, target - at);
}

/** The zone to hand Intl: the challenge's if this runtime knows it, else the device's. */
function usableZone(timeZone: string | null): string | undefined {
  if (!timeZone) return undefined;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return timeZone;
  } catch {
    return undefined;
  }
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** What `zone`'s wall clock reads at instant `at`. */
function wallClock(at: number, zone: string | undefined): WallClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour12: false,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(at));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    // Some engines render midnight as "24" under hour12: false.
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second'),
  };
}

/** How far `zone`'s wall clock is ahead of UTC at instant `at`, in ms. */
function zoneOffset(at: number, zone: string | undefined): number {
  const w = wallClock(at, zone);
  const wallAsUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return wallAsUtc - Math.floor(at / 1000) * 1000;
}

/**
 * The instant at which `zone`'s wall clock reads year-month-day hour:00.
 *
 * Two passes, because the offset at the first guess can differ from the offset
 * at the answer when a DST change falls between them. `day` may overflow the
 * month; Date.UTC rolls it.
 */
function zonedInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  zone: string | undefined,
): number {
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, 0, 0);
  const guess = wallAsUtc - zoneOffset(wallAsUtc, zone);
  return wallAsUtc - zoneOffset(guess, zone);
}

/**
 * How long after each boundary the refresh fires.
 *
 * The phone's clock and the server's are not the same clock. A refresh at
 * 12:00:00.000 by the phone can reach a server for which it is still 11:59:59
 * — which still calls yesterday open, and the screen would then sit on a stale
 * window until the NEXT boundary, twelve hours away. Five seconds is far more
 * than an NTP-synced phone drifts and far less than anyone notices.
 */
export const BOUNDARY_SLACK_MS = 5000;

/** The timer primitives, injectable so the test can drive a fake clock. */
export interface BoundaryClock {
  now: () => number;
  setTimeout: (run: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

const realClock: BoundaryClock = {
  now: () => Date.now(),
  setTimeout: (run, ms) => setTimeout(run, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * ONE timer, not a poll: armed for the next noon or midnight on the
 * challenge's wall clock, and re-armed every time it fires. Returns the
 * function that stops it.
 *
 * THE RE-ARM, stated rather than assumed. After each fire the next target is
 * computed afresh from the moment of firing — which is past the boundary just
 * crossed by BOUNDARY_SLACK_MS — so after a noon fire the only boundary ahead
 * is midnight, and after a midnight fire it is noon. It re-arms in `finally`,
 * so an `onBoundary` that throws cannot end the loop. scripts/
 * day-boundary.test.mjs drives this function with a fake clock through five
 * boundaries across the 25-hour day and checks exactly one timer is armed
 * before every fire.
 *
 * `getTimeZone` is read at every arm rather than captured once: the zone
 * arrives with the first hydrate, which is after this has started.
 */
export function scheduleDayBoundaries(
  getTimeZone: () => string | null,
  onBoundary: () => void,
  clock: BoundaryClock = realClock,
): () => void {
  let handle: unknown;
  let stopped = false;
  const arm = () => {
    const delay =
      msUntilNextBoundary(new Date(clock.now()), getTimeZone()) + BOUNDARY_SLACK_MS;
    handle = clock.setTimeout(() => {
      if (stopped) return;
      try {
        onBoundary();
      } finally {
        if (!stopped) arm();
      }
    }, delay);
  };
  arm();
  return () => {
    stopped = true;
    clock.clearTimeout(handle);
  };
}
