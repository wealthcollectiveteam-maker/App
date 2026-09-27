// Regression test for the HealthKit environment gate.
// Run: npm run test:health-gate
//
// Two failure modes, opposite directions, both real:
//
//   - THE CRASH (Phase 9). NitroModules-based healthkit must never be
//     require()d where the native side cannot exist, because Metro converts
//     module-factory throws into fatal errors that try/catch cannot contain.
//     Expo Go must be refused.
//
//   - THE FALSE POSITIVE (Phase 38M, seen on the owner's iPhone). A
//     development build served by `expo start --dev-client` loads the SAME
//     manifest the dev server hands Expo Go, and that manifest always carries
//     `extra.expoGo` (@expo/cli ManifestMiddleware.getExpoGoConfig builds it
//     for every client). expo-constants then reports `expoGoConfig != null`
//     on a phone that is NOT running Expo Go. The old gate read that as
//     Expo Go, refused the require, and Health was "unavailable" on real
//     hardware: no card, no Connect prompt, no Settings section.
//
// The discriminator that is actually about Expo Go is the ExpoGo NATIVE
// MODULE — `isRunningInExpoGo()` from the `expo` package
// (expo/src/environment/ExpoGo.ts) — plus `appOwnership === 'expo'`, which
// only Expo Go's own constants binding ever sets (expo-constants
// EXConstantsService.m has no appOwnership key at all).
import { canAttemptHealthKit, isExpoGo } from '../src/services/healthEnv.ts';

let failures = 0;
function expect(name, actual, expected) {
  const ok = actual === expected;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) {
    console.log(`       expected ${expected}, got ${actual}`);
    failures++;
  }
}

// What each runtime actually reports. `hasExpoGoConfig` is what
// expo-constants says; it is listed so the table stays honest about the
// signal the gate must NOT trust.
const EXPO_GO = { platformOS: 'ios', appOwnership: 'expo', runningInExpoGo: true, hasExpoGoConfig: true };
const DEV_CLIENT_ON_METRO = { platformOS: 'ios', appOwnership: null, runningInExpoGo: false, hasExpoGoConfig: true };
const STANDALONE = { platformOS: 'ios', appOwnership: null, runningInExpoGo: false, hasExpoGoConfig: false };

// Expo Go on iOS — the crash scenario. The gate must refuse.
expect('iOS Expo Go → no require', canAttemptHealthKit(EXPO_GO), false);
expect(
  'iOS Expo Go detected via the native module alone → no require',
  canAttemptHealthKit({ ...EXPO_GO, appOwnership: null }),
  false,
);
expect(
  'iOS Expo Go detected via appOwnership alone → no require',
  canAttemptHealthKit({ ...EXPO_GO, runningInExpoGo: false }),
  false,
);

// Non-iOS platforms — HealthKit does not exist.
expect('Android → no require', canAttemptHealthKit({ ...STANDALONE, platformOS: 'android' }), false);
expect('Web → no require', canAttemptHealthKit({ ...STANDALONE, platformOS: 'web' }), false);

// iOS builds where the native module CAN exist.
expect(
  'iOS DEVELOPMENT BUILD served by Metro (manifest carries extra.expoGo) → require allowed',
  canAttemptHealthKit(DEV_CLIENT_ON_METRO),
  true,
);
expect('iOS standalone / TestFlight build → require allowed', canAttemptHealthKit(STANDALONE), true);

// isExpoGo truth table.
expect('isExpoGo: native ExpoGo module present', isExpoGo({ ...STANDALONE, runningInExpoGo: true }), true);
expect('isExpoGo: appOwnership=expo', isExpoGo({ ...STANDALONE, appOwnership: 'expo' }), true);
expect('isExpoGo: dev client on Metro is NOT Expo Go', isExpoGo(DEV_CLIENT_ON_METRO), false);
expect('isExpoGo: neither signal', isExpoGo(STANDALONE), false);

console.log(failures === 0 ? '\nAll gate checks passed.' : `\n${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
