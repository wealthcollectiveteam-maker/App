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
