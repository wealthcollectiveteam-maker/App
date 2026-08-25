import { MockDataService } from '@/services/DataService';
import { SupabaseDataService } from '@/services/backend/SupabaseDataService';
import { isBackendConfigured } from '@/services/backend/supabaseClient';
import type { BackendError, BackendErrorKind, IDataService } from '@/services/contract';
import { toast } from '@/store/useToastStore';

/**
 * Implementation selection.
 *
 * The Supabase backend is the default. In a DEV build, EXPO_PUBLIC_USE_MOCK=1
 * forces the mock and a missing/incomplete .env falls back to it, so a broken
 * backend or no network can never block UI work. That fallback is not silent:
 * `isLiveBackend` is false and MockModeBanner says so on every screen.
 *
 * IN A PRODUCTION BUILD THE MOCK IS NOT AN OPTION. Neither switch is honoured:
 * EXPO_PUBLIC_USE_MOCK is ignored outright, and missing credentials set
 * `configurationError` instead, which the root layout turns into a blocking
 * screen — the app refuses to run rather than opening onto invented data.
 *
 * Why refuse rather than fall back with a banner: a shipped build on mock data
 * behaves EXACTLY like a working one — tasks tick off, streaks climb, the
 * squad fills in — all of it invented and none of it saved, right up to the
 * relaunch that loses 75 days. A banner asks the user to notice; refusing to
 * start cannot be missed, cannot be scrolled past, and cannot lose data. It
 * is a build-configuration fault, not a runtime condition: it is the same on
 * every launch, and the only fix is a rebuilt binary.
 */
const forceMock =
  __DEV__ &&
  ['1', 'true'].includes((process.env.EXPO_PUBLIC_USE_MOCK ?? '').toLowerCase());

const configured = isBackendConfigured();

/**
 * Non-null when a production build cannot reach a backend at all. The root
 * layout renders this instead of the app.
 */
export const configurationError: string | null =
  !__DEV__ && !configured
    ? 'This build has no Supabase credentials, so nothing it showed you could be saved.'
    : null;

// In production an unconfigured build still constructs the mock so that no
// import fails at module scope — but configurationError above means nothing
// ever renders on top of it.
const useMock = forceMock || !configured;

if (!__DEV__ && !configured) {
  console.error(
    'FATAL: Supabase credentials missing (EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY) in a production build — refusing to start.',
  );
} else if (!forceMock && !configured) {
  console.warn(
    'Supabase credentials missing (EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY) — running on mock data.',
  );
}

export const supabaseService = useMock ? null : new SupabaseDataService();

export const DataService: IDataService =
  supabaseService ?? new MockDataService();

/** True when the app is talking to a real backend. */
export const isLiveBackend = !useMock;

/** Why the app is on mock data — drives the banner's second line. */
export const mockReason: 'forced' | 'unconfigured' | null = useMock
  ? forceMock
    ? 'forced'
    : 'unconfigured'
  : null;

const GENERIC: Record<BackendErrorKind, string> = {
  network: 'Offline — that change didn’t save.',
  auth: 'Signed out — that change didn’t save.',
  conflict: 'The server refused that change.',
  unknown: 'That change didn’t save.',
};

/**
 * The line the user sees for a rejected write.
 *
 * The RPCs raise exceptions written to be read — "out of pings — resets at
 * midnight", "day is not complete: 4 of 6 tasks done", "custom task limit
 * reached (4)" — so a short message is shown as-is; anything longer is a
 * Postgres/PostgREST internal and gets the generic line. The full detail
 * always goes to the console regardless.
 *
 * A NETWORK failure is the exception to that: its message is fetch's, not
 * ours. "Network request failed" is 22 characters, so it passed the length
 * test and became the line the user read for every offline write — accurate
 * and useless, where what they need to know is that the thing they just
 * tapped is not saved.
 */
function describeBackendError(error: BackendError): string {
  if (error.kind === 'network') return GENERIC.network;
  const detail = error.message.trim();
  return detail.length > 0 && detail.length <= 70 ? detail : GENERIC[error.kind];
}

// A rejected optimistic write rolls the service mirror back. Without this it
// did so in complete silence — the screen kept showing the value the server
// had just refused, with nothing anywhere to say so.
if (supabaseService) {
  supabaseService.onError = (error) => {
    console.warn(`[backend:${error.kind}] ${error.message}`);
    toast(describeBackendError(error));
  };
}

export type { IDataService };
export { BackendError } from '@/services/contract';
