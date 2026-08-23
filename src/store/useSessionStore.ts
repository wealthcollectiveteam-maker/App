import * as Linking from 'expo-linking';
import { create } from 'zustand';

import type { Tier } from '@/data/types';
import { isLiveBackend, supabaseService } from '@/services';
import { AuthService } from '@/services/backend/AuthService';
import { completeAuthFromUrl } from '@/services/backend/authLink';
import {
  checkAccount,
  createFirstChallenge,
  ensureProfile,
  saveWhy,
} from '@/services/backend/session';
import { getSupabase } from '@/services/backend/supabaseClient';
import { toBackendError } from '@/services/contract';
import { useAppStore } from '@/store/useAppStore';
import { toast } from '@/store/useToastStore';

/**
 * Session state machine — the one thing that decides whether the app shows
 * the sign-in screen or the tabs.
 *
 *   loading   → resolving a stored session (the gate overlay is up)
 *   signedOut → no session; the email/code screen
 *   setup     → authenticated, but the account has no challenge yet
 *   signedIn  → the mirror is hydrated and the tabs can render real data
 *   error     → signed in, but bootstrap failed; retry or sign out
 *
 * ONE FUNNEL. Every way into a session — a typed code, a tapped email link
 * on a warm app, a tapped email link that cold-launched it — ends in
 * completeSignIn(), which is the only function that decides between `setup`
 * and `signedIn`, and it decides it by asking the SERVER (checkAccount).
 * There is deliberately no second route to `signedIn`: a path that skips
 * that question lands a brand new account on a challenge nobody configured.
 *
 * MOCK MODE: with no live backend there are no accounts, so the gate opens
 * at boot and the auth subsystem is inert — see completeSignIn().
 */
export type SessionStatus =
  | 'loading'
  | 'signedOut'
  | 'setup'
  | 'signedIn'
  | 'error';

interface SessionState {
  status: SessionStatus;
  userId: string | null;
  error: string | null;
  /** True once the first bootstrap has settled. */
  booted: boolean;
  /** Cold launch: apply a sign-in link, restore a session, or show sign-in. */
  bootstrap: () => Promise<void>;
  /**
   * An inbound deep link. Returns true when it carried a session that was
   * applied, so the caller knows the link — not any stored session — is
   * what decided who is signed in.
   */
  handleAuthUrl: (url: string) => Promise<boolean>;
  /** The single entry to a signed-in app, whatever proved the identity. */
  completeSignIn: (userId: string) => Promise<void>;
  /**
   * First run, in this order: display name, then tier, then why, and only
   * then the challenge. Throws so the setup screen can show the reason.
   */
  finishSetup: (name: string, tier: Tier, why: string) => Promise<void>;
  signOut: () => Promise<void>;
  retry: () => Promise<void>;
}

function describe(error: unknown): string {
  return toBackendError(error).message;
}

let authSubscription: { unsubscribe: () => void } | null = null;

/** Ends a session that is not ours before another user's is hydrated. */
function clearLocalAccount(): void {
  supabaseService?.reset();
  useAppStore.getState().resetSession();
}

export const useSessionStore = create<SessionState>((set, get) => ({
  status: 'loading',
  userId: null,
  error: null,
  booted: false,

  bootstrap: async () => {
    if (!isLiveBackend) {
      set({ status: 'signedIn', userId: null, booted: true });
      return;
    }
    set({ status: 'loading', error: null });
    // A session can also end without the app asking — an expired refresh
    // token, or the sign-out delete_account() performs after wiping the
    // rows. Either way the gate has to close.
    if (!authSubscription) {
      const client = getSupabase();
      const { data } = client?.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT' && get().status !== 'signedOut') {
          clearLocalAccount();
          set({ status: 'signedOut', userId: null, error: null });
        }
      }) ?? { data: null };
      authSubscription = data?.subscription ?? null;
    }
    try {
      // A launch FROM a sign-in link settles who is signed in BEFORE any
      // stored session gets a vote. Read the other way round, the previous
      // account on this device wins the race and the tapped link silently
      // does nothing — the app shows someone else's Day 1 and the tester
      // reasonably reads that as "the link signed me in".
      const initialUrl = await Linking.getInitialURL();
      if (initialUrl && (await get().handleAuthUrl(initialUrl))) return;

      const userId = await AuthService.getUserId();
      if (!userId) {
        set({ status: 'signedOut', userId: null });
        return;
      }
      await get().completeSignIn(userId);
    } catch (error) {
      set({ status: 'error', error: describe(error) });
    } finally {
      set({ booted: true });
    }
  },

  handleAuthUrl: async (url) => {
    // Mock builds have no accounts to sign in to; a link must not conjure
    // one. Every other deep link (a timer notification, an invite) returns
    // null from completeAuthFromUrl and passes through untouched.
    if (!isLiveBackend) return false;
    let result;
    try {
      result = await completeAuthFromUrl(url);
    } catch (error) {
      toast(describe(error));
      return false;
    }
    if (!result) return false;
    if (!result.ok || !result.userId) {
      // Never silent: an expired link that left the PREVIOUS account signed
      // in looks exactly like a successful sign-in from the outside.
      toast(result.error ?? 'That sign-in link has expired.');
      return false;
    }
    await get().completeSignIn(result.userId);
    return true;
  },

  completeSignIn: async (userId) => {
    const service = supabaseService;
    if (!service) {
      // Auth is configured by URL + anon key; the data service is ALSO
      // gated on EXPO_PUBLIC_USE_MOCK, so these two can disagree. When they
      // do, a real sign-in used to fall through to `signedIn` without ever
      // asking the server whether this account has a challenge — landing a
      // new user on the mock's invented Day 1, with a tier nobody chose and
      // no setup. Refuse instead: there is no account here to sign in to.
      toast('Mock data build — sign-in is disabled.');
      return;
    }
    const previousUserId = get().userId;
    set({ userId, error: null });
    try {
      // Switching accounts on one device: the mirror still holds the last
      // user's day, streak and journal, and hydrate() does not clear every
      // field it does not set.
      if (previousUserId && previousUserId !== userId) clearLocalAccount();

      // The ONLY thing that decides setup vs. signed-in, and the server
      // owns the answer. Anything other than "no challenge for user"
      // (offline, permission, expired JWT) throws instead of being read as
      // "new account" — that misread sends an EXISTING account to setup.
      if ((await checkAccount()) === 'needs-challenge') {
        set({ status: 'setup' });
        return;
      }
      const name = await ensureProfile(userId);
      // Hydrate BEFORE the tabs mount: the mirror answers every read, and
      // without this the whole app renders an empty day 1 for a real account.
      await service.hydrate(userId);
      useAppStore.getState().adoptSession({ name });
      set({ status: 'signedIn', error: null });
    } catch (error) {
      set({ status: 'error', error: describe(error) });
    }
  },

  finishSetup: async (name, tier, why) => {
    const userId = get().userId;
    if (!userId) {
      set({ status: 'signedOut' });
      return;
    }
    // Belt and braces behind the screen's own check: no caller gets to
    // create a challenge on a defaulted tier. The tier picks the task set
    // and the missed-day penalty — a wrong one is a wrong challenge, and
    // it cannot be edited retroactively (edits start tomorrow).
    if (!tier) throw new Error('Choose a tier before starting.');
    await ensureProfile(userId, name);
    await saveWhy(userId, why);
    await createFirstChallenge(tier);
    await get().completeSignIn(userId);
  },

  signOut: async () => {
    // Local state goes first: nothing should be able to render the previous
    // account's day, streak or journal while the network call is in flight.
    clearLocalAccount();
    set({ status: 'signedOut', userId: null, error: null });
    await AuthService.signOut();
  },

  retry: async () => {
    const userId = get().userId;
    // 'loading' so the error screen gives way to the gate's spinner instead
    // of sitting there looking like the retry did nothing.
    set({ error: null, status: 'loading' });
    if (userId) await get().completeSignIn(userId);
    else await get().bootstrap();
  },
}));
