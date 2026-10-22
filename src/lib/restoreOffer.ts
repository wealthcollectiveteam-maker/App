/**
 * THE RESTORE IS ITS OWN THING (Phase 38H, H1 + H2).
 *
 * 38G put the offer inside the 38C restart notice, and that notice goes the
 * moment a day is sealed on the replacement. So the person who saved their
 * day 1 — exactly the person the door is for — could not find it. The rule
 * is now one line, and it lives here rather than in streakStatus.ts because
 * it is not about the streak or the notice at all:
 *
 *     if my_restorable_miss() returned a row, the restore is offered.
 *
 * Not gated on the restart notice, on whether a day is sealed, on the
 * notice's dismissal, or on the day number.
 *
 * H2. While a restore is available, "02 OF 75 DAYS" must not stand alone as
 * if it were simply the truth. The block says what happened and names the
 * real day number the person would be back on — computed from the row's own
 * data, not from the device clock:
 *
 *     days since the miss = (restore_by - missed_on) - days_left
 *     the day they return to = missed_day + days since the miss
 *
 * Kept free of react-native imports so scripts/restore-offer.test.mjs runs
 * it in plain Node.
 */
/**
 * Whole days from `from` to `to`, both YYYY-MM-DD, calendar arithmetic only.
 * Local rather than imported from startChoice.ts: this module runs in plain
 * Node for its test, where neither the bundler's alias nor an
 * extension-less relative import resolves.
 */
function daysBetween(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

/**
 * One row of my_reopen_offer() (0020; my_restorable_miss()'s successor), as
 * the store holds it. A single day has lastDay = day.
 */
export interface RestorableMissInput {
  challengeId: string;
  /** The first missed day's number on the challenge that ended. */
  day: number;
  /**
   * The last reopened day (0020). Equal to `day` for a single-day restore.
   * Optional: a row read before 0020 carried one day only.
   */
  lastDay?: number;
  /** YYYY-MM-DD, in the challenge's zone. */
  missedOn: string;
  /** YYYY-MM-DD, the last reopened day's date (0020). Optional, as lastDay. */
  lastOn?: string;
  /** YYYY-MM-DD, the last day the restore is accepted. */
  restoreBy: string;
  /** Whole days from today (in the challenge's zone) to restoreBy. */
  daysLeft: number;
  /**
   * Which RPC the tap must call (0020): 'catchup' reopens the whole range
   * through catch_up_missed_days(); 'single' is 0019's restore_missed_day().
   * Optional: a row read before 0020 is a single.
   */
  kind?: 'single' | 'catchup';
}

export interface RestoreOfferInput {
  restorable: RestorableMissInput | null | undefined;
  /** The day number on screen now — the replacement's. */
  currentDay: number;
  /** `restoreBy` as a person reads it, e.g. "September 29". */
  restoreByLabel: string;
}

export interface RestoreOffer {
  /** The (first) day that would be reopened. */
  day: number;
  /** The last day that would be reopened; equal to `day` for one day. */
  lastDay: number;
  /** The day number the person would be on today, on the run that ended. */
  returnDay: number;
  /** Plain sentences: what happened, and what the action does. */
  explainer: string;
  /** "Reopen by September 29" — the window, as a label. */
  deadline: string;
  button: string;
}

/**
 * Today's day number on the run that ended, from the row alone. The server
 * computed days_left on its own clock in the challenge's zone, so no device
 * clock enters this. Clamped at the missed day itself if the row is ever
 * inconsistent.
 */
export function returnDayToday(r: RestorableMissInput): number {
  const windowDays = daysBetween(r.missedOn, r.restoreBy);
  const since = Math.max(0, windowDays - r.daysLeft);
  return r.day + since;
}

export function restoreOffer(input: RestoreOfferInput): RestoreOffer | null {
  const r = input.restorable;
  if (!r) return null;
  const returnDay = returnDayToday(r);
  const lastDay = r.lastDay ?? r.day;
  const deadline = `Reopen by ${input.restoreByLabel}`;
  // CATCH-UP (Phase 38Q): a range of unlogged days. The same plain register:
  // what happened, what the action does, where the run continues, how long
  // the days stay open. Never "late", never a tick-all.
  if (lastDay > r.day) {
    return {
      day: r.day,
      lastDay,
      returnDay,
      explainer:
        `Days ${r.day} to ${lastDay} weren't logged. Reopen them and tick each ` +
        `day you did. Your run continues at Day ${returnDay} today. Open until ` +
        `noon tomorrow.`,
      deadline,
      button: `Reopen Days ${r.day} to ${lastDay}`,
    };
  }
  return {
    day: r.day,
    lastDay,
    returnDay,
    explainer:
      `This is day ${input.currentDay} because day ${r.day} of the run before it ` +
      `was judged missed. Reopen day ${r.day} and complete it to continue that ` +
      `run, at day ${returnDay} today.`,
    deadline,
    button: `Reopen day ${r.day}`,
  };
}
