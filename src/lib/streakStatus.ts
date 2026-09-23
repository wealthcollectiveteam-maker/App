/**
 * WHAT THE STREAK HEADER AND THE STATUS BANNER SAY — as data, not as JSX.
 *
 * Phase 38C. Two lies were on screen the morning after a Hard restart:
 *
 *   1. The "Streak broken" banner was gone. It rendered on
 *      `missedDay === true`, and the server sets that only while
 *      `missed_notice_day` equals the current day — the judgement day. The
 *      next morning the replacement challenge was on day 2, the banner had
 *      expired, and nothing anywhere said a restart had happened.
 *
 *   2. The header read "Streak starts today". It rendered whenever `flame`
 *      was 0 — including on a restart where `best_flame` was 22. A person who
 *      had run 22 days and lost them was told this was the beginning.
 *
 * Both decisions now live here, pure, so scripts/streak-status.test.mjs can
 * call the SAME function the screens render from — the trade checkinCard.ts
 * and checkinDeck.ts already made, for the same reason: a `return null`
 * inside a .tsx file is not reachable from a Node test, and this repo has
 * shipped a green suite over a missing screen three times.
 *
 * Kept free of react-native imports so it runs in plain Node.
 */

// ---------------------------------------------------------------------------
// THE HEADER
// ---------------------------------------------------------------------------

export interface StreakHeaderInput {
  /** challenges.flame — the current streak. */
  flame: number;
  /**
   * challenges.best_flame — the longest streak this person has ever run.
   * restart_challenge() carries it across a restart on purpose: an attempt
   * ending does not un-happen the days they did.
   */
  bestFlame: number;
}

export type StreakHeader =
  /** A live streak. The figure is shown. */
  | { kind: 'streak'; flame: number }
  /**
   * No streak has ever existed on this account's run. The only case in
   * which "starts today" is a true sentence.
   */
  | { kind: 'first' }
  /**
   * The streak is 0 and a longer one came before it — a Hard restart, or a
   * Medium/Soft reset. Whatever the header says here, it is not "starts
   * today": something was lost, and the header must not pretend otherwise.
   */
  | { kind: 'reset'; bestFlame: number };

/**
 * THE INVARIANT THIS FUNCTION EXISTS TO HOLD:
 *
 *   bestFlame > 0  =>  kind !== 'first'
 *
 * "Streak starts today" may be said only to someone who has never had one.
 *
 * The bug this replaces was `flame > 0 ? <figure> : "Streak starts today"`
 * in AppHeader.tsx (Phase 33 through 38B). It keyed the copy on the CURRENT
 * streak alone, so a restart with best_flame 22 and a fresh sign-up were
 * told the same thing.
 */
export function streakHeader(input: StreakHeaderInput): StreakHeader {
  if (input.flame > 0) return { kind: 'streak', flame: input.flame };
  if (input.bestFlame > 0) return { kind: 'reset', bestFlame: input.bestFlame };
  return { kind: 'first' };
}

/** The header's copy, per kind. Uppercased by the Micro that renders it. */
export const HEADER_FIRST_COPY = 'Streak starts today';
export const headerResetCopy = (bestFlame: number) =>
  `Streak reset · best ${bestFlame}`;

// ---------------------------------------------------------------------------
// THE BANNER
// ---------------------------------------------------------------------------

export interface StatusNoticeInput {
  /**
   * challenges.restarted_from is set. restart_challenge() has exactly one
   * caller — the evaluator, with reason 'missed_day' — so a restarted
   * challenge is one that a missed day created.
   */
  restarted: boolean;
  /**
   * Days sealed complete on THIS challenge (challenge_days.sealed_at, per
   * challenge — the store's `perfectDays`). Zero until the first day is
   * sealed; the old challenge's days do not count, they belong to it.
   */
  sealedDays: number;
  /**
   * challenges.missed_notice_day === today. The server's one-day notice —
   * the day after a Medium/Soft reset, or day 1 of a Hard restart.
   */
  missedDay: boolean;
  /** The user tapped Dismiss on the restart notice for this challenge. */
  dismissed: boolean;
}

export type StatusNotice =
  /**
   * A restarted challenge with nothing sealed on it yet. Derived from the
   * challenge, not from a day number, so it is still true on day 2, day 5,
   * day 9 — until a day is sealed or the user dismisses it.
   */
  | 'restart'
  /** The same-challenge streak reset, on its judgement day. Unchanged. */
  | 'missed'
  | null;

/**
 * THE INVARIANT THIS FUNCTION EXISTS TO HOLD:
 *
 *   restarted && sealedDays === 0 && !dismissed  =>  'restart'
 *
 * regardless of what day it is and regardless of `missedDay`. The restart
 * notice is a property of the challenge — "this one exists because the last
 * one ended" — and it stays on screen until one of two things the USER does
 * makes it stale: sealing a day, which makes the new challenge theirs, or
 * dismissing it, which says they have read it.
 *
 * Sealing was chosen over "any completion" because a completion is
 * reversible (uncompleteTask) and a seal is not; the notice should not
 * flicker back on when a tick is undone. Dismissal is per challenge, keyed
 * on the challenge id, so a later restart gets its own notice.
 *
 * On day 1 of a restart both conditions are true and 'restart' wins: it is
 * the same event, and the restart notice is the one that survives.
 */
export function statusNotice(input: StatusNoticeInput): StatusNotice {
  if (input.restarted && input.sealedDays === 0 && !input.dismissed) {
    return 'restart';
  }
  if (input.missedDay) return 'missed';
  return null;
}

/**
 * The restart notice, in plain words. No exclamation marks, nothing
 * triumphant: what happened, what it means, and what the streak is now.
 *
 * "The streak is 0 until a day is sealed" is true whenever this notice
 * shows: it shows only while sealedDays === 0, and flame cannot rise before
 * the first seal. "Under Hard rules" is true because Hard is the only tier
 * with restartsChallenge: true, and restart_challenge() runs only from the
 * evaluator's missed-day branch.
 */
export const RESTART_NOTICE_LABEL = 'Challenge restarted';
export const RESTART_NOTICE_COPY =
  'A missed day ended the last run. Under Hard rules the clock resets, so ' +
  'this challenge started over at day 1. The streak is 0 until a day is ' +
  'sealed.';
