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

/** One row of my_restorable_miss(), as the store holds it. */
export interface RestorableMissInput {
  challengeId: string;
  /** The missed day's number on the challenge that ended. */
  day: number;
  /** YYYY-MM-DD, in the challenge's zone. */
  missedOn: string;
  /** YYYY-MM-DD, the last day the restore is accepted. */
  restoreBy: string;
  /** Whole days from today (in the challenge's zone) to restoreBy. */
  daysLeft: number;
}

export interface RestoreOfferInput {
  restorable: RestorableMissInput | null | undefined;
  /** The day number on screen now — the replacement's. */
  currentDay: number;
  /** `restoreBy` as a person reads it, e.g. "September 29". */
  restoreByLabel: string;
}

export interface RestoreOffer {
  /** The day that would be reopened. */
  day: number;
  /** The day number the person would be on today, on the run that ended. */
  returnDay: number;
  /** Two sentences: what happened, and what the action does. */
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
  return {
    day: r.day,
    returnDay,
    explainer:
      `This is day ${input.currentDay} because day ${r.day} of the run before it ` +
      `was judged missed. Reopen day ${r.day} and complete it to continue that ` +
      `run, at day ${returnDay} today.`,
    deadline: `Reopen by ${input.restoreByLabel}`,
    button: `Reopen day ${r.day}`,
  };
}
