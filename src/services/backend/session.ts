import { getCalendars } from 'expo-localization';

import type { Tier } from '@/data/types';
import { api } from '@/services/backend/api';
import { toBackendError } from '@/services/contract';

/**
 * Account bootstrap: everything that has to be true before the app can
 * render a signed-in user.
 *
 * A verified email is not yet an account. Supabase creates the auth.users
 * row; the rest — the `profiles` row squadmates read a name from, the
 * `challenges` row every RPC keys off, and day 1's frozen snapshot — is the
 * app's job. Without the challenge row, get_or_freeze_today() raises
 * "no challenge for user" and every read after it fails, which is why a new
 * account goes through createFirstChallenge() before it ever reaches tabs.
 */

/** Awaits a write and raises its error, instead of dropping it on the floor. */
async function must(
  op: PromiseLike<{ error: unknown }>,
  context: string,
): Promise<void> {
  const { error } = await op;
  if (error) throw toBackendError(error, context);
}

/** The device's IANA zone, or null when it cannot be determined. */
function deviceTimezone(): string | null {
  try {
    return getCalendars()[0]?.timeZone ?? null;
  } catch {
    return null;
  }
}

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${`${month}`.padStart(2, '0')}-${`${day}`.padStart(2, '0')}`;
}

/**
 * The start date, read on the SAME clock as the timezone we send with it.
 *
 * challenge_day() computes `(now() at time zone tz)::date - start_date + 1`.
 * Pairing a local date with a fallback zone of UTC would put a user in
 * UTC-5 on day 2 the moment they signed up after 19:00 — day 1's snapshot
 * would never exist. So the date follows whichever clock the zone names.
 */
function startDateFor(timezone: string | null): string {
  const now = new Date();
  if (!timezone) {
    return isoDate(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate());
  }
  return isoDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export type AccountState = 'ready' | 'needs-challenge';

/**
 * Whether this account already has a challenge. `no challenge for user` is
 * the expected answer for a brand new sign-up and is the ONLY error swallowed
 * here — a network or permission failure still throws, because treating it as
 * "no challenge" would create a second challenge for an existing account.
 */
export async function checkAccount(): Promise<AccountState> {
  try {
    await api.getOrFreezeToday();
    return 'ready';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/no challenge/i.test(message)) return 'needs-challenge';
    throw error;
  }
}

/**
 * First challenge for a new account: create_challenge() writes the challenge
 * and its day-1 tier_history row, then get_or_freeze_today() freezes day 1's
 * task snapshot immediately — so the first screen the user sees is a real
 * day 1 with a real task list, not an empty projection.
 */
export async function createFirstChallenge(tier: Tier): Promise<void> {
  // Re-checked rather than assumed: challenges.owner is UNIQUE, so a retry
  // after a half-failed setup (challenge written, snapshot not) would come
  // back as a duplicate-key error the user could do nothing about.
  if ((await checkAccount()) === 'needs-challenge') {
    const timezone = deviceTimezone();
    await api.createChallenge(tier, startDateFor(timezone), timezone ?? 'UTC');
  }
  await api.getOrFreezeToday();
}

/**
 * The `profiles` row. Squadmates read the name from it and get_squad_status()
 * inner-joins it, so a member with no profile row is invisible in their own
 * squad. Returns the name now in force.
 */
export async function ensureProfile(userId: string, name?: string): Promise<string> {
  const profile = await api.getProfile(userId);
  const desired = name?.trim() || profile?.name?.trim() || 'You';
  if (!profile || profile.name !== desired) {
    await must(api.upsertProfile(userId, desired), 'save profile');
  }
  return desired;
}
