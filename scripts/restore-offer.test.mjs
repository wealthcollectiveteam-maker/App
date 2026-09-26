/**
 * Proofs for THE DOOR (Phase 38H, H1 + H2).
 *
 * 0018 is live and two owners can reopen a day. Neither could find the
 * button: 38G put it inside the 38C restart notice, which goes the moment a
 * day is sealed on the replacement — so the person who saved their day 1
 * was exactly the person who could not reach the restore. And the Home
 * screen read "02 OF 75 DAYS" to someone on day 32 of one continuous run,
 * with nothing on the screen saying why.
 *
 * WHERE THIS TEST STANDS. The decision is one line in src/lib/restoreOffer.ts
 * — offered if and only if my_restorable_miss() returned a row — and the
 * RestoreBlock component renders what it returns on Home and on check-in.
 * This file drives the same function with the owner's exact state.
 *
 * PROOF (f): `--old` runs the assertions against 38G's decision, transcribed:
 * the offer rendered only inside the restart notice, so it needed
 * `restarted && sealedDays === 0 && !dismissed`, and it named no day to
 * return to. Against it the owner's state fails; the guards pass before
 * and after.
 *
 *   npm run test:restore-offer
 *   npm run test:restore-offer -- --old
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { restoreOffer as fixedOffer, returnDayToday } from '../src/lib/restoreOffer.ts';

// 38G, transcribed: streakStatus.restoreOffer gated on `restarted`, and the
// component rendered it inside the notice, which statusNotice() showed only
// while restarted && sealedDays === 0 && !dismissed.
function oldOffer({ restorable, restarted, sealedDays, dismissed }) {
  const noticeUp = restarted && sealedDays === 0 && !dismissed;
  if (!noticeUp || !restorable) return null;
  return { day: restorable.day, returnDay: null, explainer: null, button: `Reopen day ${restorable.day}` };
}

const USE_OLD = process.argv.includes('--old');
const restoreOffer = USE_OLD ? oldOffer : (i) => fixedOffer(i);
if (USE_OLD) {
  console.log('RUNNING AGAINST THE OLD BEHAVIOUR (transcribed) — failures expected.\n');
}

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

// ---- THE OWNER'S EXACT STATE, 2026-09-24 -------------------------------------
// 29 days, day 30 (09-22) judged missed at noon on 09-23, restarted; day 1
// of the replacement sealed this morning; on its day 2. The server's row:
// missed_on 09-22, restore_by 09-29, days_left 5.
const row = {
  challengeId: '573dabe6', day: 30, missedOn: '2026-09-22', restoreBy: '2026-09-29', daysLeft: 5,
};
const owner = {
  restorable: row,
  currentDay: 2,
  restoreByLabel: 'September 29',
  // what 38G's gate looked at
  restarted: true,
  sealedDays: 1,
  dismissed: false,
};

// ---- H1: the rule is one line ---------------------------------------------------
check('the owner — replacement alive, its day 1 SEALED — is offered the restore', () => {
  const o = restoreOffer(owner);
  assert.ok(o, 'no offer: the sealed day 1 took the door with it');
  assert.equal(o.day, 30);
  assert.equal(o.button, 'Reopen day 30');
});

check('the same state with the restart notice DISMISSED is still offered', () => {
  const o = restoreOffer({ ...owner, dismissed: true });
  assert.ok(o, 'no offer: dismissing the notice hid the door');
});

check('offered on day 2, day 5, day 9 — the day number is not a gate (sweep)', () => {
  for (const d of [1, 2, 5, 9, 40]) {
    assert.ok(restoreOffer({ ...owner, currentDay: d }), `day ${d}: no offer`);
  }
});

check('a person with no restorable miss sees nothing (guard)', () => {
  assert.equal(restoreOffer({ ...owner, restorable: null }), null);
  assert.equal(restoreOffer({ ...owner, restorable: undefined }), null);
});

// ---- H2: the screen explains the number -----------------------------------------
check('the explainer names the REAL day the person would be back on: 32', () => {
  const o = restoreOffer(owner);
  assert.equal(o.returnDay, 32, `returnDay is ${o && o.returnDay}`);
  assert.match(o.explainer ?? '', /day 32/, 'the copy does not say 32');
});

check('...the day is computed from the row alone, never the device clock', () => {
  assert.equal(returnDayToday(row), 32);
  // The same miss read the next morning: days_left 4 -> day 33.
  assert.equal(returnDayToday({ ...row, daysLeft: 4 }), 33);
  // Read on the missed day's own date (impossible in practice; the clamp).
  assert.equal(returnDayToday({ ...row, daysLeft: 7 }), 30);
  assert.equal(returnDayToday({ ...row, daysLeft: 9 }), 30);
});

check('...and the copy is two plain sentences: a fact and an action', () => {
  const o = restoreOffer(owner);
  const s = o.explainer ?? '';
  assert.equal(
    s,
    'This is day 2 because day 30 of the run before it was judged missed. ' +
      'Reopen day 30 and complete it to continue that run, at day 32 today.',
  );
  assert.doesNotMatch(s, /!/, 'an exclamation mark');
  assert.equal((s.match(/[.!?]/g) ?? []).length, 2, 'two sentences');
  assert.doesNotMatch(s, /sorry|unfortunately|don'?t worry|you'?ve got this/i, 'reassurance or apology');
  assert.doesNotMatch(s, /\p{Extended_Pictographic}/u, 'an emoji');
  assert.doesNotMatch(s, /previous run|your last run/i, 'vague where a number is owed');
  assert.match(s, /^This is day 2 /, 'it must say what the number on screen is');
});

check('the deadline label carries the window', () => {
  assert.equal(restoreOffer(owner).deadline, 'Reopen by September 29');
});

// ---- SOURCE ATTACHMENT --------------------------------------------------------------
if (!USE_OLD) {
  const here = path.dirname(
    new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  );
  const read = (...p) => readFileSync(path.join(here, '..', ...p), 'utf8');
  const block = read('src', 'components', 'RestoreBlock.tsx');
  const home = read('src', 'app', '(tabs)', 'index.tsx');
  const checkin = read('src', 'app', '(tabs)', 'checkin.tsx');
  const streak = read('src', 'lib', 'streakStatus.ts');

  check('RestoreBlock decides through restoreOffer() and nothing else', () => {
    assert.match(block, /from '@\/lib\/restoreOffer'/, 'RestoreBlock does not import the module');
    assert.match(block, /restoreOffer\(\{/, 'RestoreBlock never calls restoreOffer');
    assert.doesNotMatch(block, /restarted|statusNotice|Dismissed/, 'RestoreBlock is gated on the notice');
    assert.doesNotMatch(block, /judged missed/, 'the copy is hardcoded in the component');
  });
  check('Home renders the block under the day number, and check-in renders it too', () => {
    assert.match(home, /<RestoreBlock \/>/, 'Home does not render RestoreBlock');
    assert.ok(home.indexOf('testID="home-day-number"') < home.indexOf('<RestoreBlock />'), 'the block is not under the day number');
    assert.ok(home.indexOf('<RestoreBlock />') < home.indexOf('testID="home-task-list"'), 'the block is not above the task list');
    assert.match(checkin, /<RestoreBlock compact \/>/, 'check-in does not render RestoreBlock');
  });
  check('streakStatus.ts no longer owns the restore', () => {
    assert.doesNotMatch(streak, /export function restoreOffer/, 'the gated version survives in streakStatus');
  });
}

if (USE_OLD) {
  console.log(
    `\n${passes} passed, ${failures} failed against the old behaviour — ` +
      'they must fail; a suite that passes here would prove nothing.',
  );
  process.exit(failures > 0 ? 0 : 1);
}
console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
