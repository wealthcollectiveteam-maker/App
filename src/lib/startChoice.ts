/**
 * WHEN DAY 1 STARTS — the setup screen's decisions, as data, not as JSX.
 *
 * Phase 38F. Nine of eleven people signed up between 20:38 and 23:52 and were
 * handed eleven tasks with the evening already gone. Not one of nine ever
 * completed a full day. So setup now offers "today" and "tomorrow", both
 * always visible, one preselected by the clock, either changeable in a tap.
 *
 * Every decision here is pure so scripts/start-choice.test.mjs drives the
 * same functions the screens render from — the streakStatus.ts trade, for
 * the same reason.
 *
 * Kept free of react-native imports so it runs in plain Node.
 */

export type StartChoice = 'today' | 'tomorrow';

/**
 * From this local hour on, "tomorrow" is preselected.
 *
 * 18:00, as the brief proposed, and kept after thinking about it: the Hard
 * day is two 45-minute workouts, a gallon of water, ten pages, the diet and a
 * photo. From six in the evening that is still a real day — the tasks stay
 * open until noon tomorrow, so the water, the reading and the photo have the
 * whole morning — and every one of the nine late sign-ups on production was
 * after 20:38, which this catches. Earlier than 18:00 would push an afternoon
 * sign-up to tomorrow and lose the momentum of someone who just decided.
 *
 * Deliberately NOT derived from grace_deadline_hour(): that is when a day
 * CLOSES; this is about how much of a day is left to START in.
 */
export const START_TOMORROW_FROM_HOUR = 18;

/** The preselection, from the device's local hour (0-23). */
export function defaultStartChoice(localHour: number): StartChoice {
  return localHour >= START_TOMORROW_FROM_HOUR ? 'tomorrow' : 'today';
}

/**
 * One sentence per choice. It says what will happen; it does not comfort
 * anyone about it. "Stay open until noon tomorrow" is the grace window
 * (0011: day_closes_at); "never counted as a miss" is first_judged_day 2,
 * which every fresh challenge holds whichever day it starts.
 */
export const START_CHOICE_COPY: Record<StartChoice, string> = {
  today: 'Day 1 starts now, and its tasks stay open until noon tomorrow.',
  tomorrow: 'Day 1 starts tomorrow, and there are no tasks today.',
};

export function startChoiceLine(choice: StartChoice): string {
  return START_CHOICE_COPY[choice];
}

/** What the primary action is called. It names the day it will create. */
export function startButtonLabel(choice: StartChoice, busy: boolean): string {
  if (busy) return 'Starting…';
  return choice === 'tomorrow' ? 'Start tomorrow →' : 'Start day 01 →';
}

/**
 * THE DAY BEFORE THE START. What the waiting screen says, from the server's
 * start date and the device's local date, both as YYYY-MM-DD.
 *
 * The screen exists because get_or_freeze_today refuses with 'challenge not
 * started' until day 1, and the alternative was an error, or a setup form
 * that let the person create a second challenge into the unique index.
 */
export function waitingLine(startDate: string, today: string): string {
  const days = daysBetween(today, startDate);
  if (days === 1) return 'Day 1 starts tomorrow, and there are no tasks today.';
  if (days > 1) return `Day 1 starts on ${startDate}, and there are no tasks until then.`;
  // The clock has crossed the start while this screen was up.
  return 'Day 1 has started.';
}

export function waitingTitle(startDate: string, today: string): string {
  const days = daysBetween(today, startDate);
  if (days === 1) return 'Day 1 is tomorrow.';
  if (days > 1) return `Day 1 is ${startDate}.`;
  return 'Day 1 is today.';
}

/** Whole days from `from` to `to`, both YYYY-MM-DD, calendar arithmetic only. */
export function daysBetween(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

/** The device's local calendar date as YYYY-MM-DD. */
export function localDateISO(now: Date = new Date()): string {
  const m = `${now.getMonth() + 1}`.padStart(2, '0');
  const d = `${now.getDate()}`.padStart(2, '0');
  return `${now.getFullYear()}-${m}-${d}`;
}

// ---------------------------------------------------------------------------
// THE RETURNING PERSON (Phase 38F, F3 — so 0016 can ship)
// ---------------------------------------------------------------------------

/**
 * What setup says to someone whose last challenge ended as dormant (0016):
 * two consecutive attempts with no completed day, so the app stopped
 * restarting them and waited. They are back, and they are choosing when to
 * begin like anyone else. Plain, and it does not imply the app is
 * disappointed in them.
 *
 * null for a genuinely new account, and for every other ended reason: a
 * finished 75-day run needs no explaining, and a missed_day ending always
 * has a restart in front of it, so it never reaches setup.
 */
export const RETURNING_DORMANT_COPY =
  'Your last challenge ended after two attempts with no day completed. ' +
  'A new one starts when you choose to start it.';

export function returningLine(lastEndedReason: string | null | undefined): string | null {
  if (lastEndedReason === 'dormant') return RETURNING_DORMANT_COPY;
  return null;
}
