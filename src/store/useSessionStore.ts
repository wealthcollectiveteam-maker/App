import { create } from 'zustand';

import type { Tier } from '@/data/types';
import { isLiveBackend, supabaseService } from '@/services';
import { AuthService } from '@/services/backend/AuthService';
import {
  checkAccount,
  createFirstChallenge,
  ensureProfile,
} from '@/services/backend/session';
import { getSupabase } from '@/services/backend/supabaseClient';
import { toBackendError } from '@/services/contract';
import { useAppStore } from '@/store/useAppStore';

/**
 * Session state machine — the one thing that decides whether the app shows
 * the sign-in screen or the tabs.
 *
 *   loading   → resolving a stored session (splash stays up)
 *   signedOut → no session; the email/code screen
 *   setup     → authenticated, but the account has no challenge yet
 *   signedIn  → the mirror is hydrated and the tabs can render real data
 *   error     → signed in, but bootstrap failed; retry or sign out
 *
 * `setup` exists because a verified email is not an account: a user who
 * quits between verifying the code and creating a challenge comes back to a
 * valid session with no challenge row, and every RPC after that raises
 * "no challenge for user".
 *
 * MOCK MODE: with no backend configured there is nothing to sign in to, so
 * the gate opens immediately — a mock build must stay usable, and
 * MockModeBanner already says what it is running on.
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
  /** True once the first bootstrap has settled — the splash waits on this. */
  booted: boolean;
  /** Cold launch: restore a session, or fall through to the sign-in screen. */
  bootstrap: () => Promise<void>;
  /** After a verified code (or deep link): set the account up and hydrate. */
  completeSignIn: (userId: string) => Promise<void>;
  /** First run: name + tier, then a real day 1. Throws so the screen can show why. */
  finishSetup: (name: string, tier: Tier) => Promise<void>;
  signOut: () => Promise<void>;
  retry: () => Promise<void>;
}

function describe(error: unknown): string {
  return toBackendError(error).message;
}

let authSubscription: { unsubscribe: () => void } | null = null;

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
          supabaseService?.reset();
          useAppStore.getState().resetSession();
          set({ status: 'signedOut', userId: null, error: null });
        }
      }) ?? { data: null };
      authSubscription = data?.subscription ?? null;
    }
    try {
      const userId = await AuthService.getUserId();
      if (!userId) {
        set({ status: 'signedOut', userId: null, booted: true });
        return;
      }
      await get().completeSignIn(userId);
    } catch (error) {
      set({ status: 'error', error: describe(error) });
    } finally {
      set({ booted: true });
    }
  },

  completeSignIn: async (userId) => {
    const service = supabaseService;
    if (!service) {
      set({ status: 'signedIn', userId, error: null });
      return;
    }
    set({ userId, error: null });
    try {
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

  finishSetup: async (name, tier) => {
    const userId = get().userId;
    if (!userId) {
      set({ status: 'signedOut' });
      return;
    }
    await ensureProfile(userId, name);
    await createFirstChallenge(tier);
    await get().completeSignIn(userId);
  },

  signOut: async () => {
    // Local state goes first: nothing should be able to render the previous
    // account's day, streak or journal while the network call is in flight.
    supabaseService?.reset();
    useAppStore.getState().resetSession();
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
