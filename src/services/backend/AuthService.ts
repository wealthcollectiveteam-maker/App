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
      options: { shouldCreateUser: true },
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
