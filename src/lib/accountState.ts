/**
 * WHAT get_or_freeze_today's REFUSAL MEANS — as a pure function.
 *
 * checkAccount() (services/backend/session.ts) asks the server for today and
 * reads the answer three ways. This is the reading, extracted so a Node test
 * can pin it (Phase 38F): the wrong classification here is the failure the
 * start-tomorrow estimate named as the most likely — an existing account read
 * as new and sent to create a second challenge into the unique index, or a
 * waiting account read as an error and locked out on its first evening.
 *
 *   'no challenge for user'        -> needs-challenge  (new account: setup)
 *   'challenge not started: …'     -> not-started      (0017: the waiting screen)
 *   anything else                  -> null             (a real error; rethrow)
 *
 * Both strings are raised by get_or_freeze_today (0011:172, 0017 §5) and by
 * nothing else. Matched on their fixed prefixes, never widened.
 */
export type AccountState = 'ready' | 'needs-challenge' | 'not-started';

export function classifyAccountError(message: string): AccountState | null {
  if (/no challenge for user/i.test(message)) return 'needs-challenge';
  if (/challenge not started/i.test(message)) return 'not-started';
  return null;
}
