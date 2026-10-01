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
 * WHAT COUNTS AS EXPO GO — corrected in Phase 38M, after the owner's iPhone.
 *
 * The signal that is actually about Expo Go is Expo Go's own NATIVE MODULE:
 * `isRunningInExpoGo()` from the `expo` package
 * (expo/src/environment/ExpoGo.ts) is `requireNativeModule('ExpoGo') != null`,
 * and that module exists in exactly one binary. `Constants.appOwnership ===
 * 'expo'` is kept as a second signal: only Expo Go's constants binding sets
 * it (expo-constants/ios/EXConstantsService.m, the one every other build
 * uses, has no appOwnership key).
 *
 * `Constants.expoGoConfig` is NOT a signal and is no longer read. A
 * development build served by `npx expo start --dev-client` loads the same
 * manifest the dev server hands Expo Go, and @expo/cli builds `extra.expoGo`
 * into it for every client (ManifestMiddleware.getExpoGoConfig →
 * ExpoGoManifestHandlerMiddleware, `extra: { expoGo: expoGoConfig }`).
 * expo-constants then reports `expoGoConfig != null` on a real iPhone running
 * a real build. The old gate read that as Expo Go, never required the
 * module, and Health was "unavailable" on hardware: no card, no Connect
 * prompt, no Settings section — the symptom Phase 38M opened with.
 *
 * A false positive here merely disables Health (safe); a crash is not
 * possible either way because the try/catch backstop also remains.
 */

export interface HealthRuntimeEnv {
  platformOS: string;
  /** `Constants.appOwnership` — 'expo' only inside Expo Go. */
  appOwnership: string | null;
  /** `isRunningInExpoGo()` from `expo` — the ExpoGo native module exists. */
  runningInExpoGo: boolean;
}

export function isExpoGo(env: HealthRuntimeEnv): boolean {
  return env.runningInExpoGo || env.appOwnership === 'expo';
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
 * a code read.
 *
 * WHAT THE NATIVE SIDE ACTUALLY RETURNS (read in Phase 38M from the installed
 * @kingstinct/react-native-healthkit 14.0.2, not guessed): the Swift
 * `getRequestStatusForAuthorization` resolves a Nitro enum
 * (ios/CoreModule.swift), and the generated converter marshals it with
 * `JSIConverter<int>::toJSI(static_cast<int>(arg))`
 * (nitrogen/generated/shared/c++/AuthorizationRequestStatus.hpp) — a JS
 * NUMBER, 0/1/2. A raw value Swift does not recognise is not returned at
 * all: it THROWS ("Unrecognized authStatus returned"), which the service
 * catches and records as 'unknown' with the message in the diagnostic.
 *
 * TOLERANT IN ONE DIRECTION ONLY. The numeric enum is what is expected; the
 * numeric string and the enum spelled by name are accepted because a bridge
 * that serialises either way is a real possibility and there is no reason to
 * be broken by it. Everything else resolves 'unknown', which callers read as
 * not-asked. It NEVER invents 'requested': guessing "we were asked" from a
 * value nobody recognises is how a card ends up claiming a connection it
 * cannot back. Asking twice costs a silent iOS no-op; claiming wrongly costs
 * the truth.
 */
export function parseAuthRequestStatus(raw: unknown): HealthAuthRequestStatus {
  // HKAuthorizationRequestStatus: 0 unknown, 1 shouldRequest, 2 unnecessary.
  if (raw === 2 || raw === '2' || raw === 'unnecessary') return 'requested';
  if (raw === 1 || raw === '1' || raw === 'shouldRequest') return 'not-requested';
  return 'unknown';
}
