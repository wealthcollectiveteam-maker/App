/**
 * WHAT THE CHECK-IN DECK SHOWS, AND WHAT ITS FINISHED CARD DOES — as data.
 *
 * THE DEFECT THIS EXISTS FOR (Phase 30, A1). On 2026-09-17 at 03:33 the
 * account holder finished yesterday's eleven tasks inside the grace window.
 * seal_day() was never called. The flame sat at 23 with day 24 complete and
 * unsealed until an operator sealed it by hand, and the function sealed it on
 * the first attempt — it was willing the whole time. The client never asked.
 *
 * WHY. The screen offered yesterday only while `yDone < yTotal`. The instant
 * the last task was ticked that became false, writeDay() resolved back to
 * today, the deck flipped to today's cards, and the finished-day card for
 * yesterday — the one whose button calls sealDay — could never render. It was
 * a card no user could reach: the deck showed it only when every task was
 * done, and the deck left yesterday-mode the moment every task was done.
 *
 * Today's path has no such hole: finish today and the deck stays on today,
 * the finished card renders, "Lock in" goes to the celebration screen, and
 * that screen calls sealDay. This module makes yesterday's path the same
 * shape: yesterday is offered while it is OPEN and UNSEALED — not while it is
 * unfinished — so finishing it lands on the finished card with "Lock in Day
 * N", exactly as finishing today does.
 *
 * WHY A MODULE AND NOT A FIX IN THE COMPONENT. The decision lived inside the
 * screen as a run of consts feeding JSX, and JSX is not reachable from a Node
 * test. Phase 20 shipped a green suite over this exact bug because its test
 * stopped at writeDay() — a pure function that was correct — and never
 * reached the thing that decided whether the seal happened. So the decision
 * is a pure function, the screen renders whatever it returns, and
 * scripts/checkin-deck.test.mjs drives THIS function with production's state
 * and asserts that the finished card offers the seal. That test fails against
 * the old condition and passes against this one; both runs are recorded in
 * the Phase 30 report.
 *
 * Kept free of react-native imports so it runs in plain Node, like writeDay.ts
 * and checkinCard.ts.
 */

// Explicit extension: plain Node (scripts/checkin-deck.test.mjs) resolves it,
// Metro resolves it, and tsconfig allows it (allowImportingTsExtensions).
import { writeDay, type ActiveDay } from './writeDay.ts';

/** The subset of a task the deck needs. */
export interface DeckTask {
  key: string;
}

/** The subset of the store's `yesterday` (an OpenDay) the deck needs. */
export interface DeckYesterday {
  day: number;
  /** The SERVER's answer. Never recomputed from the device clock. */
  open: boolean;
  sealed: boolean;
  tasks: DeckTask[];
  tasksDone: Partial<Record<string, string>>;
}

export interface CheckinDeckInput {
  /** The day number the server called `is_today`. */
  today: number;
  activeDay: ActiveDay;
  yesterday: DeckYesterday | null;
  todayTasks: DeckTask[];
  todayDone: Partial<Record<string, string>>;
  /** Today already sealed (the store's `dayComplete`). */
  todayComplete: boolean;
  /** Today's deferred keys, in deferral order. Deferral is a today affordance. */
  deferred: string[];
}

/**
 * What the finished-day card does. Present only when the active deck has no
 * task left to show.
 *
 *   seal       yesterday, finished, open, unsealed — the button calls sealDay
 *   celebrate  today, finished, unsealed — the button opens the celebration
 *              screen, which calls sealDay
 *   sealed     already locked in; the card is a receipt and has no button
 */
export type FinishedAction =
  | { kind: 'seal'; day: number }
  | { kind: 'celebrate'; day: number }
  | { kind: 'sealed'; day: number };

export interface CheckinDeck {
  /** The day the deck is ticking — the same value every write names. */
  target: number;
  mode: 'today' | 'yesterday';
  /** Yesterday is on offer: the switcher and the notice render. */
  offerYesterday: boolean;
  /** Yesterday closed unfinished: say so, offer nothing. */
  closedUnfinished: boolean;
  yesterdayDone: number;
  yesterdayTotal: number;
  /** Undone keys of the ACTIVE deck, fresh first, deferred after. */
  queue: string[];
  /** Non-null exactly when `queue` is empty. */
  finished: FinishedAction | null;
}

export function checkinDeck(input: CheckinDeckInput): CheckinDeck {
  const { today, activeDay, yesterday, todayTasks, todayDone, todayComplete, deferred } = input;

  const yesterdayTotal = yesterday?.tasks.length ?? 0;
  const yesterdayDone = yesterday
    ? yesterday.tasks.filter((t) => yesterday.tasksDone[t.key]).length
    : 0;

  // THE WINDOW. Yesterday is offered only while the SERVER calls it open and
  // it has not been sealed. Nothing here is derived from this device's clock:
  // the boundary is noon in the CHALLENGE's timezone, and a phone in another
  // zone (or simply set wrong) must not be able to talk the screen into
  // offering a day every write against it will be refused.
  //
  // NOT "and it is unfinished". That third condition was the A1 defect: it
  // dropped yesterday from the deck at the exact moment the finished card —
  // the one that seals — was due to render. A finished, unsealed, open day is
  // the one state in which yesterday MOST needs to stay on offer.
  const offerYesterday = !!yesterday && yesterday.open && !yesterday.sealed;

  // Closed, and it was never finished. Say so — do not simply take the option
  // away and leave the user wondering whether they imagined it.
  const closedUnfinished =
    !!yesterday && !yesterday.open && !yesterday.sealed && yesterdayDone < yesterdayTotal;

  // The identical call every write path makes: the day this deck NAMES and
  // the day the database RECEIVES are the same expression on the same state.
  const target = writeDay({
    activeDay,
    today,
    yesterday: yesterday ? { day: yesterday.day, open: offerYesterday } : null,
  });
  const mode: 'today' | 'yesterday' = yesterday && target === yesterday.day ? 'yesterday' : 'today';

  const tasks = mode === 'yesterday' && yesterday ? yesterday.tasks : todayTasks;
  const tasksDone = mode === 'yesterday' && yesterday ? yesterday.tasksDone : todayDone;
  const pending = tasks.map((t) => t.key).filter((k) => !tasksDone[k]);
  // Deferral is a today affordance: a day you are closing out has nowhere to
  // push a task to.
  const deferredKeys = mode === 'today' ? deferred : [];
  const fresh = pending.filter((k) => !deferredKeys.includes(k));
  const later = deferredKeys.filter((k) => pending.includes(k));
  const queue = [...fresh, ...later];

  let finished: FinishedAction | null = null;
  if (queue.length === 0) {
    if (mode === 'yesterday' && yesterday) {
      finished = yesterday.sealed
        ? { kind: 'sealed', day: yesterday.day }
        : { kind: 'seal', day: yesterday.day };
    } else {
      finished = todayComplete
        ? { kind: 'sealed', day: today }
        : { kind: 'celebrate', day: today };
    }
  }

  return {
    target,
    mode,
    offerYesterday,
    closedUnfinished,
    yesterdayDone,
    yesterdayTotal,
    queue,
    finished,
  };
}
