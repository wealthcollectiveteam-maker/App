// Regression test for the HealthKit environment gate.
// Run: npm run test:health-gate
// Guards against the Expo Go crash: NitroModules-based healthkit must never
// be require()d where the native side cannot exist, because Metro converts
// module-factory throws into fatal errors that try/catch cannot contain.
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

// Expo Go on iOS — the crash scenario. The gate must refuse.
expect(
  'iOS Expo Go (appOwnership=expo) → no require',
  canAttemptHealthKit({ platformOS: 'ios', appOwnership: 'expo', hasExpoGoConfig: true }),
  false,
);
expect(
  'iOS Expo Go detected via expoGoConfig alone → no require',
  canAttemptHealthKit({ platformOS: 'ios', appOwnership: null, hasExpoGoConfig: true }),
  false,
);
expect(
  'iOS Expo Go detected via appOwnership alone → no require',
  canAttemptHealthKit({ platformOS: 'ios', appOwnership: 'expo', hasExpoGoConfig: false }),
  false,
);

// Non-iOS platforms — HealthKit does not exist.
expect(
  'Android → no require',
  canAttemptHealthKit({ platformOS: 'android', appOwnership: null, hasExpoGoConfig: false }),
  false,
);
expect(
  'Web → no require',
  canAttemptHealthKit({ platformOS: 'web', appOwnership: null, hasExpoGoConfig: false }),
  false,
);

// iOS dev-client / standalone / bare — native modules can exist.
expect(
  'iOS dev build (appOwnership=null, no expoGoConfig) → require allowed',
  canAttemptHealthKit({ platformOS: 'ios', appOwnership: null, hasExpoGoConfig: false }),
  true,
);

// isExpoGo truth table.
expect('isExpoGo: appOwnership=expo', isExpoGo({ platformOS: 'ios', appOwnership: 'expo', hasExpoGoConfig: false }), true);
expect('isExpoGo: expoGoConfig set', isExpoGo({ platformOS: 'ios', appOwnership: null, hasExpoGoConfig: true }), true);
expect('isExpoGo: neither signal', isExpoGo({ platformOS: 'ios', appOwnership: null, hasExpoGoConfig: false }), false);

console.log(failures === 0 ? '\nAll gate checks passed.' : `\n${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
