/**
 * WHAT THE PRODUCTION BUILD WILL BE SIGNED WITH (Phase 38S, S2c + S4b).
 *
 * Reads the iOS config exactly as EAS will resolve it — `expo config --type
 * introspect`, which runs every config plugin — and asserts:
 *
 *   - the entitlements are HealthKit and nothing else. In particular no
 *     `aps-environment`: the reminder is a local notification and nothing
 *     in the app uses push, so the App Store profile must not need Push.
 *     expo-notifications adds it on SDK 54 whatever app.json says;
 *     plugins/withoutPushEntitlement.js takes it out, and only while it is
 *     listed FIRST. Move it and this fails.
 *   - HealthKit is read-only: a share string, no update string, no
 *     background delivery.
 *   - export compliance is pre-answered, iPhone only, bundle id unchanged.
 *   - no camera or photo string: the app never opens either, and a usage
 *     string for a permission never asked is something review asks about.
 *
 * FAIL-FIRST: before the plugin, `aps-environment: "development"` is there.
 *
 *   npm run test:entitlements
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const r = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['expo', 'config', '--type', 'introspect', '--json'], {
  cwd: root,
  encoding: 'utf8',
  shell: process.platform === 'win32',
  env: { ...process.env, EXPO_NO_TELEMETRY: '1' },
});
if (r.status !== 0) {
  console.log(`FAIL: expo config exited ${r.status}\n${r.stderr}`);
  process.exit(1);
}
const json = r.stdout.slice(r.stdout.indexOf('{'));
const config = JSON.parse(json);
const ios = config.ios ?? {};
const plist = ios.infoPlist ?? {};

let failures = 0;
let passes = 0;
function check(label, fn) {
  try {
    fn();
    passes += 1;
    console.log(`PASS: ${label}`);
  } catch (e) {
    failures += 1;
    console.log(`FAIL: ${label}`);
    console.log(`      ${String(e && e.message ? e.message : e).split('\n')[0]}`);
  }
}

check('entitlements are exactly HealthKit — no aps-environment', () => {
  assert.deepEqual(ios.entitlements, { 'com.apple.developer.healthkit': true });
});
check('bundle id is com.aly786.rankedfitness', () => {
  assert.equal(ios.bundleIdentifier, 'com.aly786.rankedfitness');
});
check('iPhone only', () => {
  assert.equal(ios.supportsTablet, false);
});
check('export compliance pre-answered: ITSAppUsesNonExemptEncryption false', () => {
  assert.equal(plist.ITSAppUsesNonExemptEncryption, false);
});
check('Health is read-only: a share string, no update string, no background delivery', () => {
  assert.ok(typeof plist.NSHealthShareUsageDescription === 'string' && plist.NSHealthShareUsageDescription.length > 40);
  assert.ok(/never uploaded/.test(plist.NSHealthShareUsageDescription), 'the share string no longer says the data stays on the phone');
  assert.equal(plist.NSHealthUpdateUsageDescription, undefined);
  assert.equal(ios.entitlements['com.apple.developer.healthkit.background-delivery'], undefined);
});
check('no camera, photo or microphone string: the app asks for none of them', () => {
  for (const k of ['NSCameraUsageDescription', 'NSPhotoLibraryUsageDescription', 'NSPhotoLibraryAddUsageDescription', 'NSMicrophoneUsageDescription']) {
    assert.equal(plist[k], undefined, `${k} is set`);
  }
});
check('no remote-notification background mode', () => {
  assert.ok(!(plist.UIBackgroundModes ?? []).includes('remote-notification'));
});

console.log(`\n${passes} passed, ${failures} failed.`);
if (failures) process.exit(1);
