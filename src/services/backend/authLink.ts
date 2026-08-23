import type { EmailOtpType } from '@supabase/supabase-js';

import { getSupabase } from './supabaseClient';

/**
 * Inbound auth deep links (`rankedfitness://…`).
 *
 * The emailed sign-in message carries a 6-digit code AND a link. Typing the
 * code is the primary path (AuthService.verifyOtp); this is the other one —
 * tapping the link. Supabase can hand the session back in either of two
 * shapes depending on the project's flow, so both are handled:
 *
 *   …#access_token=…&refresh_token=…   → implicit flow, set the session
 *   …?token_hash=…&type=email          → verify the hash for a session
 *
 * The client is created with detectSessionInUrl:false (there is no browser
 * URL bar on a phone), so nothing does this automatically.
 *
 * NOTE: for the emailed LINK to open the app at all, the Supabase project's
 * URL configuration must allow `rankedfitness://` as a redirect. The code
 * path works regardless.
 */

/** Query string AND fragment, merged — Supabase uses both. */
function collectParams(url: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const part of url.split(/[?#]/).slice(1)) {
    for (const pair of part.split('&')) {
      if (!pair) continue;
      const [rawKey, rawValue = ''] = pair.split('=');
      try {
        params[decodeURIComponent(rawKey)] = decodeURIComponent(
          rawValue.replace(/\+/g, ' '),
        );
      } catch {
        params[rawKey] = rawValue;
      }
    }
  }
  return params;
}

export interface AuthLinkResult {
  ok: boolean;
  userId?: string;
  error?: string;
}

/**
 * Completes sign-in from a deep link. Returns null when the URL carries no
 * auth payload at all — every other deep link (a timer notification tap, an
 * invite link) reaches this function too, and must pass through untouched.
 */
export async function completeAuthFromUrl(
  url: string,
): Promise<AuthLinkResult | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  const params = collectParams(url);
  const failure = params.error_description ?? params.error;
  const accessToken = params.access_token;
  const refreshToken = params.refresh_token;
  const tokenHash = params.token_hash;

  if (!failure && !accessToken && !tokenHash) return null;
  // An expired or already-used link reports itself in the URL.
  if (failure) return { ok: false, error: failure };

  if (accessToken && refreshToken) {
    const { data, error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, userId: data.user?.id };
  }

  if (tokenHash) {
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: (params.type ?? 'email') as EmailOtpType,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, userId: data.user?.id };
  }

  // An access token with no refresh token is not a session we can persist.
  return { ok: false, error: 'That sign-in link was incomplete.' };
}
