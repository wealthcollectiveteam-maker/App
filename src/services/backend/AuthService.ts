import * as Linking from 'expo-linking';

import { getSupabase } from './supabaseClient';

/**
 * Email OTP auth ("Save your challenge"): request a 6-digit code, verify it.
 * All methods no-op safely when the backend isn't configured.
 */
export const AuthService = {
  async requestOtp(email: string): Promise<{ ok: boolean; error?: string }> {
    const supabase = getSupabase();
    if (!supabase) return { ok: false, error: 'Backend not configured' };
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        // WHERE THE EMAILED LINK LANDS. Without this, Supabase falls back to
        // the project's Site URL for every platform at once — one value, and
        // the app now runs on two. A phone needs `rankedfitness://`; a
        // browser cannot do anything with that scheme at all, so a web
        // visitor tapping the link got a dead tab.
        //
        // createURL resolves per platform — `rankedfitness://` in a device
        // build, the page's own origin on web — so each one asks for the
        // redirect it can actually receive and Site URL never has to pick a
        // side. Both must be in Authentication → URL Configuration →
        // Redirect URLs; Supabase quietly falls back to Site URL for a value
        // that is not on that allow-list, which is exactly today's behaviour,
        // so a missing entry costs the web link and breaks nothing else.
        emailRedirectTo: Linking.createURL('/'),
      },
    });
    return error ? { ok: false, error: error.message } : { ok: true };
  },

  async verifyOtp(
    email: string,
    code: string,
  ): Promise<{ ok: boolean; userId?: string; error?: string }> {
    const supabase = getSupabase();
    if (!supabase) return { ok: false, error: 'Backend not configured' };
    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: 'email',
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, userId: data.user?.id };
  },

  async getUserId(): Promise<string | null> {
    const supabase = getSupabase();
    if (!supabase) return null;
    const { data } = await supabase.auth.getSession();
    return data.session?.user.id ?? null;
  },

  async signOut(): Promise<void> {
    await getSupabase()?.auth.signOut();
  },
};
