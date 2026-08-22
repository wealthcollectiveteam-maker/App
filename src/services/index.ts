import { MockDataService } from '@/services/DataService';
import { SupabaseDataService } from '@/services/backend/SupabaseDataService';
import { isBackendConfigured } from '@/services/backend/supabaseClient';
import type { IDataService } from '@/services/contract';

/**
 * Implementation selection. The Supabase backend is the default; setting
 * EXPO_PUBLIC_USE_MOCK=1 (or "true") forces the mock, so a broken backend or
 * a missing network can never block UI work.
 *
 * A missing/incomplete .env also falls back to the mock rather than crashing
 * on launch — an unconfigured build should show the app, not a white screen.
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

export type { IDataService };
export { BackendError } from '@/services/contract';
