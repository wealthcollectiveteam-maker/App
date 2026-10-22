/**
 * Proofs for CATCH-UP on the client (Phase 38Q, Q3).
 *
 * The server (0020) reopens a RANGE of days — 43 to 50 on 2026-10-13 — and
 * get_day_window() returns every one of them, open, with one close. The
 * client's whole check-in path was built around ONE non-today open day
 * (`yesterday`): the deck ticks it, the finished card seals it, and the
 * store drops back to today the moment it is sealed. Fed eight reopened days
 * that code would show one, seal it, land on today, and leave seven days
 * open on the server with no screen to reach them.
 *
 * WHAT THIS PINS. The decision of WHICH reopened day the deck is on, and
 * where it goes after a lock-in, is one pure function in src/lib/catchUp.ts:
 * oldest open unsealed day first, the next one after each seal, today when
 * none is left. The offer copy for a range is in src/lib/restoreOffer.ts.
 * Both run in plain Node here, with the owner's state.
 *
 * FAIL-FIRST. Before Q3 the module did not exist and restoreOffer() knew no
 * range: this file failed to import, and the single-day copy ("Reopen day
 * 43") was wrong for a range. The run before the code is in the report.
 *
 *   npm run test:catch-up
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { currentOpenDay, nextAfterSeal, catchUpProgress } from '../src/lib/catchUp.ts';
import { restoreOffer, returnDayToday } from '../src/lib/restoreOffer.ts';

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

// ---- THE OWNER'S STATE, 2026-10-13 --------------------------------------------
// Run 7729ffa2: sealed through day 42, day 43 missed, ended 6 Oct. Nothing
// alive. The server offers days 43-50 (first 5 Oct, last 12 Oct, reopen by
// 19 Oct, six days left), kind 'catchup'.
const offerRow = {
  challengeId: '7729ffa2',
  day: 43,
  lastDay: 50,
  missedOn: '2026-10-05',
  lastOn: '2026-10-12',
  restoreBy: '2026-10-19',
  daysLeft: 6,
  kind: 'catchup',
};

const KEYS = ['workout1', 'workout2', 'water', 'reading', 'diet', 'photo', 'custom-a'];
const tasks = KEYS.map((key) => ({ key }));
const openDay = (day, overrides = {}) => ({
  day,
  isToday: false,
  open: true,
  closesAt: `2026-10-${String(day - 43 + 6).padStart(2, '0')}T16:00:00.000Z`,
  reopenedUntil: '2026-10-14T16:00:00.000Z',
  tasks,
  tasksDone: {},
  sealed: false,
  ...overrides,
});
// After the catch-up: eight reopened days, oldest first, as applyDayWindow
// hands them to the store.
const reopened = [43, 44, 45, 46, 47, 48, 49, 50].map((d) => openDay(d));

// ---- THE OFFER: a range, in the same plain register ---------------------------
check('the owner is offered days 43 to 50, continuing at day 51', () => {
  const o = restoreOffer({ restorable: offerRow, currentDay: 1, restoreByLabel: 'October 19' });
  assert.ok(o, 'no offer');
  assert.equal(o.day, 43);
  assert.equal(o.lastDay, 50);
  assert.equal(o.returnDay, 51);
  assert.equal(o.button, 'Reopen Days 43 to 50');
  assert.equal(o.deadline, 'Reopen by October 19');
  assert.equal(
    o.explainer,
    "Days 43 to 50 weren't logged. Reopen them and tick each day you did. " +
      'Your run continues at Day 51 today. Open until noon tomorrow.',
  );
});

check('...the day it continues at comes from the row alone', () => {
  assert.equal(returnDayToday(offerRow), 51);
  // Read the next morning: five days left -> day 52.
  assert.equal(returnDayToday({ ...offerRow, daysLeft: 5 }), 52);
});

check('...and the copy is plain: no exclamation, no reassurance, no "late"', () => {
  const o = restoreOffer({ restorable: offerRow, currentDay: 1, restoreByLabel: 'October 19' });
  const s = `${o.explainer} ${o.button} ${o.deadline}`;
  assert.doesNotMatch(s, /!/, 'an exclamation mark');
  assert.doesNotMatch(s, /\blate\b/i, 'labels the days late');
  assert.doesNotMatch(s, /sorry|unfortunately|don'?t worry|you'?ve got this|well done/i, 'reassurance');
  assert.doesNotMatch(s, /\p{Extended_Pictographic}/u, 'an emoji');
});

check('a one-day catch-up reads as one day; a 0019 single restore is unchanged', () => {
  const one = restoreOffer({
    restorable: { ...offerRow, lastDay: 43, lastOn: '2026-10-05', daysLeft: 13 },
    currentDay: 1,
    restoreByLabel: 'October 19',
  });
  assert.equal(one.button, 'Reopen day 43');
  assert.match(one.explainer, /^This is day 1 because day 43 /);
  const single = restoreOffer({
    restorable: { challengeId: 'x', day: 37, lastDay: 37, missedOn: '2026-09-29', lastOn: '2026-09-29', restoreBy: '2026-10-13', daysLeft: 13, kind: 'single' },
    currentDay: 2,
    restoreByLabel: 'October 13',
  });
  assert.equal(single.button, 'Reopen day 37');
  assert.equal(single.returnDay, 38);
});

// ---- THE DECK: oldest first, one at a time, then today ------------------------
check('the deck starts on the OLDEST reopened day, 43', () => {
  const cur = currentOpenDay(reopened);
  assert.ok(cur, 'no current day');
  assert.equal(cur.day, 43);
});

check('after locking in 43 the deck moves to 44, not to today', () => {
  const after = nextAfterSeal(reopened, 43);
  assert.equal(after.days.find((d) => d.day === 43).sealed, true, '43 not marked sealed');
  assert.equal(after.current?.day, 44);
  assert.equal(after.activeDay, 'yesterday');
});

check('...and so on through 50; after 50 it lands on today', () => {
  let days = reopened;
  for (let d = 43; d <= 49; d += 1) {
    const after = nextAfterSeal(days, d);
    assert.equal(after.current?.day, d + 1, `after ${d}`);
    assert.equal(after.activeDay, 'yesterday', `after ${d}`);
    days = after.days;
  }
  const last = nextAfterSeal(days, 50);
  assert.equal(last.current, null);
  assert.equal(last.activeDay, 'today');
});

check('a day already sealed on the server is skipped on the way in', () => {
  const half = reopened.map((d) => (d.day <= 46 ? { ...d, sealed: true } : d));
  assert.equal(currentOpenDay(half)?.day, 47);
  assert.deepEqual(catchUpProgress(half), { total: 8, done: 4, remaining: 4 });
});

check('a closed, unsealed day is still handed over, so the screen can say it closed', () => {
  // The deadline passed with 47 undone: nothing is open. The deck shows the
  // oldest unsealed day, closed, and the existing "CLOSED AT NOON" notice
  // renders for it. It never pretends a closed day is tickable.
  const closed = reopened.map((d) => ({ ...d, open: false, sealed: d.day <= 46 }));
  const cur = currentOpenDay(closed);
  assert.equal(cur?.day, 47);
  assert.equal(cur?.open, false);
});

check('an ordinary yesterday is the same path: one day, then today', () => {
  const y = [openDay(50, { reopenedUntil: null })];
  assert.equal(currentOpenDay(y)?.day, 50);
  assert.equal(nextAfterSeal(y, 50).activeDay, 'today');
  assert.deepEqual(catchUpProgress(y), { total: 1, done: 0, remaining: 1 });
  assert.equal(currentOpenDay([]), null);
});

check('the deck never ticks anything by itself', () => {
  const after = nextAfterSeal(reopened, 43);
  for (const d of after.days) {
    assert.deepEqual(d.tasksDone, {}, `day ${d.day} gained ticks`);
  }
});

// ---- SOURCE ATTACHMENT --------------------------------------------------------------
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const read = (...p) => readFileSync(path.join(here, '..', ...p), 'utf8');
const service = read('src', 'services', 'backend', 'SupabaseDataService.ts');
const store = read('src', 'store', 'useAppStore.ts');
const apiSrc = read('src', 'services', 'backend', 'api.ts');
const checkin = read('src', 'app', '(tabs)', 'checkin.tsx');
const auth = read('src', 'app', 'auth.tsx');
const session = read('src', 'store', 'useSessionStore.ts');

check('the service and the store walk the range through lib/catchUp, not their own rule', () => {
  assert.match(service, /from '@\/lib\/catchUp'/, 'the service does not import catchUp');
  assert.match(service, /currentOpenDay\(/, 'the service does not pick the current day through it');
  assert.match(store, /from '@\/lib\/catchUp'/, 'the store does not import catchUp');
  assert.match(store, /nextAfterSeal\(/, 'the store does not advance through it');
  assert.doesNotMatch(store, /activeDay: 'today',\s*\n\s*\}\)\);\s*\n\s*DataService\.sealDay\(y\.day\)/, 'the store still drops to today on every grace seal');
});

check('the tap calls the RPC the offer named; the offer is read from my_reopen_offer', () => {
  assert.match(apiSrc, /rpc\('my_reopen_offer'\)/, 'api.ts does not read my_reopen_offer');
  assert.match(apiSrc, /rpc\('catch_up_missed_days'\)/, 'api.ts has no catch-up call');
  assert.match(service, /kind === 'catchup'/, 'the service does not branch on the offer kind');
});

check('the screen names the reopened day with its date and the days left to lock in', () => {
  assert.match(checkin, /catchUpProgress\(/, 'check-in does not show catch-up progress');
  // Copy, not code: `interpolate` and `translateX` are not the word "late".
  assert.doesNotMatch(checkin, /tick all|\blate\b/i, 'the screen offers tick-all or says late');
});

check('with nothing alive, setup shows the offer first and keeps starting fresh as the second action', () => {
  assert.match(session, /readReopenOffer\(\)/, 'completeSignIn does not read the offer on needs-challenge');
  assert.match(session, /useAppStore\.setState\(\{ restorable: offer \}\)/, 'the offer never reaches the app store');
  assert.match(auth, /<RestoreBlock/, 'the setup screen does not render the offer');
  assert.match(auth, /Or start a new challenge/i, 'starting fresh is not named as the second action');
});

console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
