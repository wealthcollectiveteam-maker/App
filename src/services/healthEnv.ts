/**
 * Pure environment gate for HealthKit. Kept free of react-native/expo
 * imports so it is unit-testable in plain Node.
 *
 * WHY THIS EXISTS — a try/catch around `require()` is NOT a safe guard in
 * React Native: Metro's `guardedLoadModule` catches exceptions thrown while
 * a module factory executes and routes them to
 * `global.ErrorUtils.reportFatalError` WITHOUT rethrowing, so the caller's
 * catch never runs and the app shows a fatal error instead
 * (see metro-runtime/src/polyfills/require.js). Optional native modules must
 * therefore be gated by a positive environment check so the require is never
 * evaluated where the native side can't exist.
 *
 * Expo Go detection (verified against the SDK 54 expo-constants docs):
 * - `Constants.appOwnership === 'expo'` — returns 'expo' ONLY in Expo Go
 *   (deprecated but still the documented Expo Go discriminator).
 * - `Constants.expoGoConfig` — non-deprecated; "populated when running in
 *   Expo Go", null elsewhere.
 * - `Constants.executionEnvironment === 'storeClient'` is NOT usable: per
 *   the docs it covers Expo Go AND development builds made with
 *   expo-dev-client, which DO support native modules.
 * We treat the runtime as Expo Go when either reliable signal says so —
 * a false positive merely disables Health (safe); a crash is not possible
 * either way because the try/catch backstop also remains.
 */

export interface HealthRuntimeEnv {
  platformOS: string;
  /** `Constants.appOwnership` — 'expo' only inside Expo Go. */
  appOwnership: string | null;
  /** Whether `Constants.expoGoConfig` is populated (Expo Go only). */
  hasExpoGoConfig: boolean;
}

export function isExpoGo(env: HealthRuntimeEnv): boolean {
  return env.appOwnership === 'expo' || env.hasExpoGoConfig;
}

/** True only where the HealthKit native module can actually exist. */
export function canAttemptHealthKit(env: HealthRuntimeEnv): boolean {
  return env.platformOS === 'ios' && !isExpoGo(env);
}

/**
 * Whether this device has ever been ASKED for Health access. Not whether it
 * was granted — HealthKit deliberately refuses to say, because "this app was
 * denied heart-rate access" is itself a health disclosure. Apple's
 * `HKAuthorizationRequestStatus` answers only the question it is safe to
 * answer, and so does this:
 *
 *   'unavailable'    no HealthKit source here at all (web/Android/Expo Go)
 *   'not-requested'  the OS has never shown the sheet for our read types
 *   'requested'      the sheet has been shown; grant status is UNKNOWABLE
 *   'unknown'        the OS would not say. Treated as 'not-requested' by
 *                    callers, because the only cost of asking twice is that
 *                    iOS silently no-ops, while the cost of assuming we were
 *                    asked is a card claiming a connection it may not have.
 */
export type HealthAuthRequestStatus =
  | 'unavailable'
  | 'not-requested'
  | 'requested'
  | 'unknown';

/**
 * Turn whatever the native side returned into one of those four states.
 *
 * IT LIVES HERE, in the module with no react-native or expo imports, for the
 * reason the rest of this file does: it is the load-bearing decision in the
 * Health feature and it deserves a proof that runs in plain Node rather than
 * a code read. `getRequestStatusForAuthorization` is a Nitro native call, and
 * whether it marshals its enum as a number cannot be established without a
 * device — so the parse has to be right for every shape it might not be.
 *
 * TOLERANT IN ONE DIRECTION ONLY. The numeric enum is what is expected; the
 * numeric string and the enum spelled by name are accepted because a bridge
 * that serialises either way is a real possibility and there is no reason to
 * be broken by it. Everything else resolves 'unknown', which callers read as
 * not-asked. It NEVER invents 'requested': guessing "we were asked" from a
 * value nobody recognises is how a card ends up claiming a connection it
 * cannot back, which is the failure this phase exists to remove. Asking twice
 * costs a silent iOS no-op; claiming wrongly costs the truth.
 */
export function parseAuthRequestStatus(raw: unknown): HealthAuthRequestStatus {
  // HKAuthorizationRequestStatus: 0 unknown, 1 shouldRequest, 2 unnecessary.
  if (raw === 2 || raw === '2' || raw === 'unnecessary') return 'requested';
  if (raw === 1 || raw === '1' || raw === 'shouldRequest') return 'not-requested';
  return 'unknown';
}
