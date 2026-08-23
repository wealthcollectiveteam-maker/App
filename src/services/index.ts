import { MockDataService } from '@/services/DataService';
import { SupabaseDataService } from '@/services/backend/SupabaseDataService';
import { isBackendConfigured } from '@/services/backend/supabaseClient';
import type { BackendError, BackendErrorKind, IDataService } from '@/services/contract';
import { toast } from '@/store/useToastStore';

/**
 * Implementation selection. The Supabase backend is the default; setting
 * EXPO_PUBLIC_USE_MOCK=1 (or "true") forces the mock, so a broken backend or
 * a missing network can never block UI work.
 *
 * A missing/incomplete .env also falls back to the mock rather than crashing
 * on launch — an unconfigured build should show the app, not a white screen.
 * That fallback is NOT silent: `isLiveBackend` is false and MockModeBanner
 * says so on every screen, because a build quietly running on fake data is
 * indistinguishable from a working one until someone loses real data.
 */
const forceMock = ['1', 'true'].includes(
  (process.env.EXPO_PUBLIC_USE_MOCK ?? '').toLowerCase(),
);

const useMock = forceMock || !isBackendConfigured();

if (!forceMock && !isBackendConfigured()) {
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
 */
function describeBackendError(error: BackendError): string {
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
