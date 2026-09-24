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
  /**
   * A live streak. The figure is shown — and beside it the best, when the
   * best is longer (Phase 38G). The moment a day was sealed after a
   * restart, the 29 used to vanish from the screen: the app knew and stopped
   * mentioning it. When flame equals best, repeating it is noise.
   */
  | { kind: 'streak'; flame: number; best: number | null }
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
  if (input.flame > 0) {
    return {
      kind: 'streak',
      flame: input.flame,
      best: input.bestFlame > input.flame ? input.bestFlame : null,
    };
  }
  if (input.bestFlame > 0) return { kind: 'reset', bestFlame: input.bestFlame };
  return { kind: 'first' };
}

/** The header's copy, per kind. Uppercased by the Micro that renders it. */
export const HEADER_FIRST_COPY = 'Streak starts today';
export const headerResetCopy = (bestFlame: number) =>
  `Streak reset · best ${bestFlame}`;
/** What follows the streak figure when the best is longer: "· best 29". */
export const headerBestCopy = (best: number) => `· best ${best}`;

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

// ---------------------------------------------------------------------------
// THE DAY-1 LINE (Phase 38D, D1)
// ---------------------------------------------------------------------------

/**
 * grace_deadline_hour(), supabase/migrations/0011_grace_window.sql:55-58:
 *
 *   create or replace function public.grace_deadline_hour()
 *   returns integer
 *   language sql immutable
 *   as $$ select 12 $$;
 *
 * A day stays completable until this hour on the FOLLOWING local day
 * (day_closes_at, 0011:75-81). The client has no RPC for the value, so it is
 * mirrored here with its source quoted, and the word in the copy is derived
 * from it rather than typed. If the server's hour ever moves, this constant
 * is the one place the client has to follow it.
 */
export const GRACE_DEADLINE_HOUR = 12;

/** The hour as a person would say it: 12 is noon, 0 is midnight. */
export function deadlineWord(hour: number): string {
  if (hour === 12) return 'noon';
  if (hour === 0 || hour === 24) return 'midnight';
  const h = hour % 12 || 12;
  return `${h} ${hour < 12 ? 'AM' : 'PM'}`;
}

export interface DayOneLineInput {
  /** The current day, from the server's day window. */
  day: number;
  /** challenges.restarted_from is set. */
  restarted: boolean;
  /** Days sealed complete on THIS challenge. */
  sealedDays: number;
}

/**
 * One sentence. It states the rule and stops.
 *
 * "Never counted as a miss" is true because the evaluator's floor for a
 * challenge with restarted_from null is 2 (0015:147), so its day 1 is never
 * judged. "Stay open until noon tomorrow" is true because day 1 closes at
 * day_closes_at(c, 1) — start_date + 1 at grace_deadline_hour() — and
 * earliest_open_day() never goes below 1, so day 1 is on offer for the whole
 * of that window.
 */
export const DAY_ONE_LINE =
  'Day 1 is never counted as a miss, and its tasks stay open until ' +
  `${deadlineWord(GRACE_DEADLINE_HOUR)} tomorrow.`;

/**
 * THE TRAP THIS FUNCTION EXISTS TO AVOID.
 *
 * Migration 0015 changed the evaluator's floor to
 *
 *   v_day := greatest(c.last_evaluated_day + 1,
 *              case when c.restarted_from is null then 2 else 1 end);
 *
 * so day 1 is skipped ONLY on a challenge that is not a restart. On a
 * restart, day 1 IS judged — that was the point of 0015. The sentence above
 * is therefore true for a new challenge and false for a restarted one, and
 * the person on a restarted day 1 is exactly the person the restart notice
 * just apologised to. Telling them day 1 is free and then sealing a miss on
 * it would be the worst thing this app could do, so `restarted` returns null
 * HERE, in the same function the screens render from — not by the component
 * happening to draw the restart notice first.
 *
 * "Today is the creation day" is not fetched separately: for a challenge
 * that is not a restart, day 1 IS start_date (challenge_day(), 0001:250-256)
 * and create_challenge() is always handed today (session.ts startDateFor),
 * so day === 1 && !restarted is that condition. The line is a property of
 * day 1 on a fresh challenge, not of the calendar — if a start date ever
 * becomes choosable it stays true, because the floor does not move.
 */
export function dayOneLine(input: DayOneLineInput): string | null {
  if (input.day !== 1) return null;
  if (input.restarted) return null;
  if (input.sealedDays > 0) return null;
  return DAY_ONE_LINE;
}

// ---------------------------------------------------------------------------
// THE RESTORE OFFER (Phase 38G, G2)
// ---------------------------------------------------------------------------

/** my_restorable_miss(): the day that can be reopened, and until when. */
export interface RestorableMiss {
  challengeId: string;
  day: number;
  /** YYYY-MM-DD, the missed day's date in the challenge's zone. */
  missedOn: string;
  /** YYYY-MM-DD, the last day the restore is accepted. */
  restoreBy: string;
  daysLeft: number;
}

export interface RestoreOfferInput {
  /** The challenge on screen is a restart (the notice is up). */
  restarted: boolean;
  /** The server's answer, or null when there is nothing to reopen. */
  restorable: RestorableMiss | null | undefined;
  /** `restoreBy` as a person reads it, e.g. "September 29". */
  restoreByLabel: string;
}

export interface RestoreOffer {
  day: number;
  /** One sentence. It says the day reopens and still has to be completed. */
  line: string;
  button: string;
}

/**
 * Shown inside the restart notice, only while the server says the miss can
 * be reopened. It is honest about what happens next: the day comes back and
 * still has to be completed. It is not a button that gives a streak back —
 * restore_missed_day() changes no flame; only sealing the day does.
 */
export function restoreOffer(input: RestoreOfferInput): RestoreOffer | null {
  if (!input.restarted || !input.restorable) return null;
  const { day } = input.restorable;
  return {
    day,
    line:
      `Day ${day} can be reopened until ${input.restoreByLabel}, and it still ` +
      'has to be completed for the run to continue.',
    button: `Reopen day ${day}`,
  };
}
