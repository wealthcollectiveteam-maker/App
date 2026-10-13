/**
 * WHICH REOPENED DAY THE DECK IS ON, AND WHERE IT GOES AFTER A LOCK-IN
 * (Phase 38Q, Q3).
 *
 * 0020 reopens a RANGE of days — the owner's 43 to 50 — and get_day_window()
 * hands every one of them back, open, with one close. The check-in path was
 * built for ONE non-today open day (`yesterday`): the deck ticks it, the
 * finished card seals it, and the store drops back to today the moment the
 * seal lands. Fed eight reopened days, that code would show one, seal it,
 * land on today, and leave seven open on the server with no screen to reach
 * them.
 *
 * So the rule is here, in one place both the service and the store call:
 *
 *   - the deck is on the OLDEST reopened day that is open and unsealed;
 *   - after a lock-in it moves to the next such day;
 *   - when there is none left, it lands on today.
 *
 * `yesterday` keeps its name and its shape — it is still "the one non-today
 * day the deck is ticking" — and writeDay(), checkinDeck() and the screen's
 * grace mode are untouched. What changes is which day fills it, and when.
 *
 * NOTHING HERE TICKS ANYTHING. Each day is the same honest tick-and-seal as
 * any day; a day the person did not do stays undone and is judged missed
 * when the deadline passes, exactly as 0018's single reopened day was.
 *
 * Kept free of react-native imports so scripts/catch-up.test.mjs runs it in
 * plain Node.
 */

/** The subset of an OpenDay this module reads. */
export interface ReopenedDay {
  day: number;
  /** The SERVER's answer. Never recomputed from the device clock. */
  open: boolean;
  sealed: boolean;
}

/**
 * The day the deck should be on, from the window's non-today rows (any
 * order). The oldest open, unsealed day; failing that, the oldest unsealed
 * day even if closed, so the screen can say it closed rather than silently
 * dropping it; failing that, null.
 */
export function currentOpenDay<T extends ReopenedDay>(days: readonly T[]): T | null {
  const sorted = [...days].sort((a, b) => a.day - b.day);
  return (
    sorted.find((d) => d.open && !d.sealed) ??
    sorted.find((d) => !d.sealed) ??
    null
  );
}

/**
 * The list after `sealedDay` was locked in, the day to move to, and the
 * deck mode that follows: 'yesterday' while a reopened day is still open
 * and unsealed, 'today' once none is.
 */
export function nextAfterSeal<T extends ReopenedDay>(
  days: readonly T[],
  sealedDay: number,
): { days: T[]; current: T | null; activeDay: 'today' | 'yesterday' } {
  const next = days.map((d) => (d.day === sealedDay ? { ...d, sealed: true } : d));
  const current = currentOpenDay(next);
  return {
    days: next,
    current,
    activeDay: current && current.open && !current.sealed ? 'yesterday' : 'today',
  };
}

/** How far through the reopened days the person is. */
export function catchUpProgress(days: readonly ReopenedDay[]): {
  total: number;
  done: number;
  remaining: number;
} {
  const done = days.filter((d) => d.sealed).length;
  return { total: days.length, done, remaining: days.length - done };
}
