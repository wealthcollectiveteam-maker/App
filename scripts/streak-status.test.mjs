/**
 * Proofs for THE SILENT RESTART (Phase 38C).
 *
 * Production, September 2026: a Hard challenge restarted overnight. On the
 * judgement day the "Streak broken" banner showed. The next morning the
 * replacement was on day 2, the banner was gone — it rendered on
 * `missed_notice_day === currentDay`, which matches one day only — and the
 * header read "Streak starts today" to a person whose best_flame was 22.
 * Nothing on any screen said a restart had happened.
 *
 * WHERE THIS TEST STANDS. Both decisions now live in src/lib/streakStatus.ts
 * and the screens render what it returns, so this file drives the SAME
 * functions AppHeader.tsx and the Home StatusBanner call, with the restart's
 * state, and asks two questions:
 *
 *     ON A RESTARTED CHALLENGE WITH BEST_FLAME 22 AND NOTHING SEALED, DOES
 *     THE HEADER SAY "STREAK STARTS TODAY"?          (it must not)
 *
 *     ...AND IS THE RESTART NOTICE ON SCREEN — ON DAY 2, NOT JUST DAY 1?
 *                                                    (it must be)
 *
 * PROOF (f): `--old` runs the same assertions against the behaviour as it
 * stood through 38B, transcribed from the components (see below). Against
 * it the restart cases FAIL; that is what makes the assertions worth having.
 *
 * A last block reads the screens' source and refuses to pass unless they
 * actually route through streakStatus — the property that keeps this test
 * attached to the path it claims to cover.
 *
 *   npm run test:streak-status
 *   npm run test:streak-status -- --old
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  HEADER_FIRST_COPY,
  headerResetCopy,
  statusNotice as fixedNotice,
  streakHeader as fixedHeader,
} from '../src/lib/streakStatus.ts';

// ---------------------------------------------------------------------------
// The OLD behaviour, transcribed. It could not be imported — that is the
// bug: it lived as a ternary in AppHeader.tsx and an `if (missedDay)` in the
// Home StatusBanner, where no Node test could reach it.
//
//   AppHeader.tsx, 38B and earlier:
//     flame > 0 ? <figure> : "Streak starts today"
//   index.tsx StatusBanner, 38B and earlier:
//     if (missedDay) return <Streak broken banner />; return null;
//
// A transcription, not the shipped module — faithful to the branch
// structure, and enough to show the assertions distinguish the two.
// ---------------------------------------------------------------------------
function oldHeader({ flame }) {
  return flame > 0 ? { kind: 'streak', flame } : { kind: 'first' };
}
function oldNotice({ missedDay }) {
  return missedDay ? 'missed' : null;
}

const USE_OLD = process.argv.includes('--old');
const streakHeader = USE_OLD ? oldHeader : fixedHeader;
const statusNotice = USE_OLD ? oldNotice : fixedNotice;
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

/** What the header would print for a decision, uppercased by Micro later. */
const headerCopy = (h) =>
  h.kind === 'streak'
    ? String(h.flame).padStart(2, '0')
    : h.kind === 'reset'
      ? headerResetCopy(h.bestFlame)
      : HEADER_FIRST_COPY;

// ---- THE RESTART, as the store holds it -------------------------------------
// A Hard challenge that ran 22 days, missed day 23, and was restarted by the
// evaluator overnight. restart_challenge() carries best_flame across and
// sets missed_notice_day = 1 on the replacement.
const restartDay1 = {
  restarted: true,
  sealedDays: 0,
  missedDay: true, // missed_notice_day (1) === currentDay (1)
  dismissed: false,
  flame: 0,
  bestFlame: 22,
};
// The next morning. Nothing sealed yet; the server's one-day notice expired.
const restartDay2 = { ...restartDay1, missedDay: false };

// ---- THE BUG, C2: the header ------------------------------------------------
check('restart, best 22, nothing sealed: the header does NOT say "Streak starts today"', () => {
  const h = streakHeader(restartDay1);
  assert.notEqual(h.kind, 'first', `header kind is ${h.kind}`);
  assert.notEqual(headerCopy(h), HEADER_FIRST_COPY);
});

check('...it says something true instead: the streak was reset, and what the best was', () => {
  assert.deepEqual(streakHeader(restartDay2), { kind: 'reset', bestFlame: 22 });
  assert.equal(headerCopy(streakHeader(restartDay2)), 'Streak reset · best 22');
});

// ---- THE BUG, C1: the notice ------------------------------------------------
check('restart, day 1: the restart notice is on screen', () => {
  assert.equal(statusNotice(restartDay1), 'restart');
});

check('restart, DAY 2, judgement day over: the restart notice is STILL on screen', () => {
  assert.equal(
    statusNotice(restartDay2),
    'restart',
    'the notice expired with missed_notice_day — the restart went silent',
  );
});

// ---- when it should go ------------------------------------------------------
check('the notice goes once a day is sealed on the new challenge', () => {
  assert.equal(statusNotice({ ...restartDay2, sealedDays: 1 }), null);
});

check('...and the header shows the new streak then, not the reset', () => {
  assert.deepEqual(streakHeader({ flame: 1, bestFlame: 22 }), { kind: 'streak', flame: 1 });
});

check('the notice goes when the user dismisses it', () => {
  assert.equal(statusNotice({ ...restartDay2, dismissed: true }), null);
});

check('...but the header still does not claim a fresh start after a dismissal', () => {
  assert.notEqual(streakHeader({ ...restartDay2, dismissed: true }).kind, 'first');
});

// ---- the cases that must NOT change -----------------------------------------
check('a fresh challenge, no streak ever: "Streak starts today" is true and stays', () => {
  assert.deepEqual(streakHeader({ flame: 0, bestFlame: 0 }), { kind: 'first' });
  assert.equal(headerCopy(streakHeader({ flame: 0, bestFlame: 0 })), HEADER_FIRST_COPY);
});

check('a fresh challenge shows no notice at all', () => {
  assert.equal(
    statusNotice({ restarted: false, sealedDays: 0, missedDay: false, dismissed: false }),
    null,
  );
});

check('a live streak shows its figure', () => {
  assert.deepEqual(streakHeader({ flame: 11, bestFlame: 11 }), { kind: 'streak', flame: 11 });
});

check('a Medium/Soft reset (same challenge) keeps its one-day "Streak broken" banner', () => {
  assert.equal(
    statusNotice({ restarted: false, sealedDays: 12, missedDay: true, dismissed: false }),
    'missed',
  );
});

check('...and the day after, as before, nothing (the day count went on; the challenge did not end)', () => {
  assert.equal(
    statusNotice({ restarted: false, sealedDays: 12, missedDay: false, dismissed: false }),
    null,
  );
});

check('a Medium reset with best 12 does not claim "Streak starts today" either', () => {
  assert.deepEqual(streakHeader({ flame: 0, bestFlame: 12 }), { kind: 'reset', bestFlame: 12 });
});

// ---- the invariants, over the input space -----------------------------------
check('bestFlame > 0 => the header never says "Streak starts today" (sweep)', () => {
  let bad = 0;
  let n = 0;
  for (const flame of [0, 1, 5]) {
    for (const bestFlame of [1, 5, 22, 75]) {
      n += 1;
      if (streakHeader({ flame, bestFlame }).kind === 'first') bad += 1;
    }
  }
  assert.equal(bad, 0, `${bad} of ${n} combinations said "starts today" over a lost streak`);
});

check('restarted && nothing sealed && not dismissed => notice, whatever the day (sweep)', () => {
  let bad = 0;
  let n = 0;
  for (const missedDay of [true, false]) {
    n += 1;
    if (statusNotice({ restarted: true, sealedDays: 0, missedDay, dismissed: false }) !== 'restart') {
      bad += 1;
    }
  }
  assert.equal(bad, 0, `${bad} of ${n} cases lost the restart notice`);
});

// ---- SOURCE ATTACHMENT ------------------------------------------------------
// Read the screens' source so the test cannot drift away from the path it
// covers — the same trade checkin-card.test.mjs and checkin-deck.test.mjs make.
if (!USE_OLD) {
  const here = path.dirname(
    new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  );
  const header = readFileSync(
    path.join(here, '..', 'src', 'components', 'AppHeader.tsx'),
    'utf8',
  );
  const home = readFileSync(
    path.join(here, '..', 'src', 'app', '(tabs)', 'index.tsx'),
    'utf8',
  );
  check('AppHeader decides its copy through streakHeader()', () => {
    assert.match(header, /from '@\/lib\/streakStatus'/, 'AppHeader.tsx does not import streakStatus');
    assert.match(header, /streakHeader\(\{/, 'AppHeader.tsx never calls streakHeader');
    assert.doesNotMatch(header, /Streak starts today/, 'the copy is hardcoded in the component again');
    assert.doesNotMatch(header, /flame > 0 \?/, 'the header still decides on flame alone');
  });
  check('the Home banner decides through statusNotice()', () => {
    assert.match(home, /from '@\/lib\/streakStatus'/, 'index.tsx does not import streakStatus');
    assert.match(home, /statusNotice\(\{/, 'index.tsx never calls statusNotice');
    assert.match(home, /notice === 'restart'/, 'the restart banner is not driven by the notice');
    assert.doesNotMatch(home, /if \(missedDay\)/, 'the screen still decides the banner on missedDay alone');
  });
}

if (USE_OLD) {
  console.log(
    `\n${passes} passed, ${failures} failed against the old behaviour — ` +
      'they must fail; a suite that passes here would prove nothing.',
  );
  // Inverted on purpose: against the old behaviour, FAILING is the pass.
  process.exit(failures > 0 ? 0 : 1);
}
console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
