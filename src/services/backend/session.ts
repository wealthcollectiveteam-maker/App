import { getCalendars } from 'expo-localization';

import type { ChallengeLength, SetupCustomTask, Tier } from '@/data/types';
import { type AccountState, classifyAccountError } from '@/lib/accountState';
import { api, type ChallengeStatusRow } from '@/services/backend/api';
import { toBackendError } from '@/services/contract';

export type { AccountState };

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

/**
 * Whether this account already has a challenge, and whether it has started.
 *
 * The server answers through get_or_freeze_today(), and exactly two of its
 * refusals are states rather than errors: `no challenge for user` (a brand
 * new sign-up: setup) and, since 0017, `challenge not started` (a start-
 * tomorrow challenge, read the evening before: the waiting screen). The
 * reading lives in lib/accountState.ts so a test can pin it. Anything else
 * still throws, because treating a network or permission failure as "no
 * challenge" would create a second challenge for an existing account.
 */
export async function checkAccount(): Promise<AccountState> {
  try {
    await api.getOrFreezeToday();
    return 'ready';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const state = classifyAccountError(message);
    if (state) return state;
    throw error;
  }
}

/** The one read the waiting screen needs: when day 1 is. */
export async function readChallengeStatus(): Promise<ChallengeStatusRow | null> {
  return api.getChallengeStatus();
}

/**
 * What setup needs to know about the person in front of it (Phase 38F, F3):
 * how their last challenge ended, if one did. null for a genuinely new
 * account. Never throws into the setup path — a failed read here would turn
 * a new sign-up into an error screen, and the line it feeds is a courtesy.
 */
export async function readLastEndedChallenge(
  userId: string,
): Promise<{ lastEndedReason: string | null; bestFlame: number } | null> {
  try {
    const row = await api.getLastEndedChallenge(userId);
    return row ? { lastEndedReason: row.ended_reason, bestFlame: row.best_flame } : null;
  } catch {
    return null;
  }
}

/**
 * First challenge for a new account: create_challenge() writes the challenge
 * and its day-1 tier_history row, then get_or_freeze_today() freezes day 1's
 * task snapshot immediately — so the first screen the user sees is a real
 * day 1 with a real task list, not an empty projection.
 *
 * `startTomorrow` asks the server for a whole first day (0017). The server
 * computes the date on its own clock in the device's zone; the client no
 * longer sends one, so a phone with a wrong date cannot create a challenge
 * on it. A challenge that starts tomorrow has no day to freeze tonight.
 */
export async function createFirstChallenge(
  tier: Tier,
  durationDays: ChallengeLength,
  customTasks: SetupCustomTask[] = [],
  startTomorrow = false,
): Promise<void> {
  // Re-checked rather than assumed: an owner may hold at most one LIVE
  // challenge (0007's partial unique index), so a retry after a half-failed
  // setup — challenge written, snapshot not — would come back as a
  // duplicate-key error the user could do nothing about. A challenge that
  // exists but has not started reads as 'not-started' here and is likewise
  // not created twice.
  if ((await checkAccount()) === 'needs-challenge') {
    const timezone = deviceTimezone();
    await api.createChallenge(
      tier,
      timezone ?? 'UTC',
      durationDays,
      startTomorrow,
    );
  }

  // THE ORDERING IS THE FEATURE. Custom tasks go in BETWEEN creating the
  // challenge and freezing day 1, because compose_task_set() reads
  // custom_tasks at the moment the snapshot is taken. Freeze first and they
  // are not in day 1 — they would be a normal edit, live tomorrow, and the
  // user would spend their first day looking at a task list missing the
  // tasks they had just typed in.
  //
  // Sequential rather than Promise.all: the server caps the count, and a
  // parallel burst would race that check. Five writes at setup is nothing.
  for (const task of customTasks) {
    const name = task.name.trim();
    if (!name) continue;
    await api.addSetupCustomTask(name, task.timerMinutes);
  }

  // Freezes day 1 when there is one to freeze. For a start-tomorrow
  // challenge the server answers 'not-started' instead of a snapshot, and
  // that is the right answer, not a failure: day 1 is frozen when it opens,
  // with these custom tasks in it.
  await checkAccount();
}

/**
 * "Why I started", written to profile_private (owner-only RLS — no squadmate
 * can ever read it). Optional: an empty answer writes nothing rather than
 * storing a blank row.
 */
export async function saveWhy(userId: string, why: string): Promise<void> {
  const text = why.trim();
  if (!text) return;
  await must(api.setWhy(userId, text), 'save why');
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
