/**
 * Proofs for the preference blobs that survive a relaunch.
 *
 * Every one of these settings used to be `set()` and nothing else, so it
 * reset on launch: you turned an alert off and the app turned it back on.
 * These assert the round trip AND the three ways a stored blob can be
 * hostile — corrupt, stale, or the wrong type.
 *
 *   node --experimental-strip-types scripts/prefs.test.mjs
 */
import assert from 'node:assert/strict';

import {
  PREF_KEYS,
  restoreFlag,
  restorePrefs,
  serializeFlag,
  serializePrefs,
} from '../src/lib/prefsStorage.ts';

const NOTIF_DEFAULTS = {
  pings: true,
  squadActivity: true,
  dailyReminder: false,
  timerAlerts: true,
};

let passes = 0;
function ok(label) {
  passes += 1;
  console.log(`PASS: ${label}`);
}

// ---- the round trip, which is the whole point -----------------------------
{
  const chosen = { ...NOTIF_DEFAULTS, timerAlerts: false, dailyReminder: true };
  const restored = restorePrefs(serializePrefs(chosen), NOTIF_DEFAULTS);
  assert.deepEqual(restored, chosen);
  ok('a preference set is written and read back exactly');
}

// ---- an OFF switch stays off, which is the bug this fixes -----------------
{
  const restored = restorePrefs(
    serializePrefs({ ...NOTIF_DEFAULTS, timerAlerts: false }),
    NOTIF_DEFAULTS,
  );
  assert.equal(restored.timerAlerts, false, 'timerAlerts came back on');
  ok('a switch turned OFF is still off after a relaunch');
}

// ---- nothing stored: leave the caller's state alone ------------------------
{
  assert.equal(restorePrefs(null, NOTIF_DEFAULTS), null);
  assert.equal(restorePrefs('', NOTIF_DEFAULTS), null);
  ok('no stored value returns null rather than overwriting with defaults');
}

// ---- hostile input must not throw during startup --------------------------
{
  for (const bad of ['{', 'null', '[]', '"a string"', '42', '{"}']) {
    assert.equal(
      restorePrefs(bad, NOTIF_DEFAULTS),
      null,
      `restorePrefs threw or accepted ${bad}`,
    );
  }
  ok('corrupt, non-object and truncated blobs return null and never throw');
}

// ---- a stale build must not reintroduce a retired setting -----------------
{
  const restored = restorePrefs(
    serializePrefs({ ...NOTIF_DEFAULTS, retiredSetting: true }),
    NOTIF_DEFAULTS,
  );
  assert.deepEqual(Object.keys(restored).sort(), Object.keys(NOTIF_DEFAULTS).sort());
  ok('keys the defaults do not define are dropped');
}

// ---- "false" the string is not false the boolean ---------------------------
{
  const restored = restorePrefs('{"timerAlerts":"false"}', NOTIF_DEFAULTS);
  assert.equal(restored, null, 'a wrong-typed value was accepted');
  ok('a value of the wrong type is ignored, not coerced');
}

// ---- the single-flag form --------------------------------------------------
{
  assert.equal(restoreFlag(serializeFlag(false)), false);
  assert.equal(restoreFlag(serializeFlag(true)), true);
  assert.equal(restoreFlag(null), null);
  assert.equal(restoreFlag('yes'), null);
  ok('the weekly check-in flag round-trips, and junk reads as null');
}

// ---- the keys themselves ---------------------------------------------------
{
  const keys = Object.values(PREF_KEYS);
  assert.equal(new Set(keys).size, keys.length, 'two preferences share a key');
  for (const k of keys) assert.match(k, /^ranked\..+\.v\d+$|^ranked\..+$/);
  ok('every preference key is distinct and namespaced');
}

console.log(`\nAll ${passes} preference-persistence checks passed.`);
