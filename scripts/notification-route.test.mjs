/**
 * Proofs for WHERE A NOTIFICATION TAP GOES (Phase 38S, S2).
 *
 * The reminder has carried `data: { url: '/checkin' }` since 38I, and the
 * tap handler only ever read '/timer'. Tapping "Day 56 is still open for
 * three more hours" opened the app wherever it last was. The decision is
 * now lib/notificationRoute.ts, used by both the live listener and the
 * cold-launch path.
 *
 * FAIL-FIRST: `--old` runs the same assertions against 8d54758's handlers,
 * transcribed: only '/timer' routes.
 *
 *   npm run test:notification-route
 *   npm run test:notification-route -- --old
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { notificationRoute as fixedRoute } from '../src/lib/notificationRoute.ts';

// 8d54758: the live listener routed '/timer' always; the cold-launch path
// routed '/timer' only with an active timer. Nothing else.
function oldRoute(url, { coldLaunch, hasActiveTimer }) {
  if (url === '/timer') return !coldLaunch || hasActiveTimer ? '/timer' : null;
  return null;
}

const USE_OLD = process.argv.includes('--old');
const route = USE_OLD ? oldRoute : fixedRoute;
if (USE_OLD) console.log('RUNNING AGAINST THE OLD BEHAVIOUR (transcribed) — failures expected.\n');

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

check('a reminder tap, app running: check-in', () => {
  assert.equal(route('/checkin', { coldLaunch: false, hasActiveTimer: false }), '/checkin');
});
check('a reminder tap that launched the app: check-in', () => {
  assert.equal(route('/checkin', { coldLaunch: true, hasActiveTimer: false }), '/checkin');
});
check('a timer tap still opens the timer; a cold one only with a timer running (guard)', () => {
  assert.equal(route('/timer', { coldLaunch: false, hasActiveTimer: false }), '/timer');
  assert.equal(route('/timer', { coldLaunch: true, hasActiveTimer: true }), '/timer');
  assert.equal(route('/timer', { coldLaunch: true, hasActiveTimer: false }), null);
});
check('anything else goes nowhere (guard)', () => {
  for (const url of [undefined, null, '', '/settings', 'https://x.test', 42]) {
    assert.equal(route(url, { coldLaunch: false, hasActiveTimer: true }), null);
  }
});

if (!USE_OLD) {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const fx = readFileSync(path.join(root, 'src', 'services', 'timerEffects.ts'), 'utf8');
  const layout = readFileSync(path.join(root, 'src', 'app', '_layout.tsx'), 'utf8');
  const reminder = readFileSync(path.join(root, 'src', 'services', 'reminder.ts'), 'utf8');
  check('both tap paths use notificationRoute(); the cold one clears what it handled', () => {
    assert.equal((fx.match(/notificationRoute\(/g) ?? []).length, 2, 'live and cold paths do not both decide through it');
    assert.match(fx, /clearLastNotificationResponseAsync\(\)/, 'a handled cold-launch tap is not cleared and would route again');
    assert.match(layout, /router\.push\(route\)/, '_layout does not navigate to the decided route');
  });
  check("the reminder's payload is the url the router knows", () => {
    assert.match(reminder, /data: \{ url: '\/checkin' \}/);
  });
}

if (USE_OLD) {
  console.log(`\n${passes} passed, ${failures} failed against the old behaviour — they must fail.`);
  process.exit(failures > 0 ? 0 : 1);
}
console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
