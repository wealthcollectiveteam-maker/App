/**
 * WHAT THE WEEKLY CHECK-IN CARD SHOWS — as data, not as JSX.
 *
 * WHY THIS MODULE EXISTS AT ALL.
 *
 * The card disappeared and a full green suite said nothing. It disappeared
 * because this decision lived inside the component as a run of early `return
 * null`s, and an early return inside a .tsx file is not reachable from a Node
 * test: there is nothing to import and nothing to call. Every test in the
 * repo could therefore prove that saving a check-in works while no user could
 * find the field to save one — which is the third time this project has shipped
 * exactly that shape of bug (the task editor nobody could reach, the RLS
 * proofs against a stub that did not reproduce real grants, the green build
 * with no credentials in the bundle).
 *
 * So the decision is a pure function, the component renders whatever it
 * returns, and scripts/checkin-card.test.mjs asserts the property that
 * actually matters: THE ENTRY PATH IS REACHABLE. Not that saving works —
 * that it can be reached.
 *
 * Kept free of react-native imports so it runs in plain Node.
 */

export interface CheckinCardInput {
  /** The permanent off switch in Settings. The ONE reason to render nothing. */
  enabled: boolean;
  /** localWeekKey() of the week already handled, or null. */
  handledWeek: string | null;
  /** localWeekKey() for right now. */
  thisWeek: string;
  /** Newest first. Only the newest one matters here. */
  checkins: { weightKg: number | null; timestamp: number }[];
}

export type CheckinCardState =
  /** The full card: weight field, mood row, Save. */
  | { mode: 'entry'; hasHistory: boolean }
  /**
   * This week is handled. One row, and it is never a dead end: `lastWeightKg`
   * is null when the handled check-in carried no weight, and the row says so
   * rather than vanishing.
   */
  | {
      mode: 'summary';
      lastWeightKg: number | null;
      lastAt: number | null;
      hasHistory: boolean;
    }
  /** Switched off in Settings. The only state that renders nothing. */
  | { mode: 'hidden' };

/**
 * THE INVARIANT THIS FUNCTION EXISTS TO HOLD:
 *
 *   enabled === true  =>  mode !== 'hidden'
 *
 * There is exactly one reason for the weekly check-in to be absent from the
 * screen, and it is the user having turned it off. Everything else — no
 * history, a mood-only entry, a week already handled, a check-in with no
 * weight in it — is a different card, never no card.
 *
 * The bug this replaces was `if (!last?.weightKg) return null` inside the
 * handled-this-week branch (f39b09b, Phase 9 Part 1). Save a mood with the
 * weight field blank and `weightKg` is null, so for the rest of that week the
 * component rendered nothing at all: no field, no history link, no dismiss X,
 * no way back until the week turned over.
 */
export function checkinCardState(input: CheckinCardInput): CheckinCardState {
  if (!input.enabled) return { mode: 'hidden' };

  const hasHistory = input.checkins.length > 0;
  if (input.handledWeek !== input.thisWeek) {
    return { mode: 'entry', hasHistory };
  }

  const last = input.checkins[0];
  return {
    mode: 'summary',
    // null is a real answer — "checked in, no weight recorded" — and the row
    // renders it. It is not a reason to render nothing.
    lastWeightKg: last?.weightKg ?? null,
    lastAt: last?.timestamp ?? null,
    hasHistory,
  };
}
