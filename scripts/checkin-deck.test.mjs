/**
 * Proofs for THE GRACE-WINDOW SEAL GAP (Phase 30, A1).
 *
 * Production, 2026-09-17: archive 7729ffa2, day 25. Yesterday (day 24) was
 * finished in the app at 03:33, inside the grace window — eleven of eleven —
 * and seal_day() was never called. The flame sat at 23 until an operator
 * sealed the day by hand, and seal_day sealed it on the first attempt.
 *
 * WHERE THIS TEST STANDS. Phase 20's suite was green over a live bug because
 * it stopped at writeDay(), a pure function that was correct, and never
 * reached the code that decided whether the seal happened. That decision now
 * lives in src/lib/checkinDeck.ts and the screen renders what it returns, so
 * this file drives the SAME function the screen calls, with production's
 * state, and asks the only question that matters:
 *
 *     WHEN YESTERDAY IS FINISHED, OPEN AND UNSEALED, DOES THE DECK OFFER THE
 *     SEAL?
 *
 * Against the old condition (`yesterday.open && !sealed && yDone < yTotal`)
 * the answer is no: the deck flips to today and the finished card for
 * yesterday never renders. Against the fixed one it is yes. Both runs are in
 * the Phase 30 report; the only difference between them is that one clause.
 *
 * A second block reads the screen's source and refuses to pass unless the
 * screen actually routes through checkinDeck() and takes its seal action from
 * the result — the property that keeps this test attached to the path it
 * claims to cover.
 *
 *   node --experimental-strip-types scripts/checkin-deck.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { checkinDeck } from '../src/lib/checkinDeck.ts';

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

// ---- production's task set, by shape: eleven tasks, none of it private ------
const KEYS = [
  'workout1', 'workout2', 'water', 'reading', 'diet', 'photo',
  'custom-a', 'custom-b', 'custom-c', 'custom-d', 'custom-e',
];
const tasks = KEYS.map((key) => ({ key }));
const done = (n) =>
  Object.fromEntries(KEYS.slice(0, n).map((k) => [k, '03:33']));

/** Archive 7729ffa2 as the store held it at 03:33 on 2026-09-17. */
const production = (overrides = {}) => ({
  today: 25,
  activeDay: 'yesterday',
  yesterday: {
    day: 24,
    open: true,           // closes at noon America/New_York
    sealed: false,
    tasks,
    tasksDone: done(11),  // eleven of eleven, the last at 03:33
  },
  todayTasks: tasks,
  todayDone: {},
  todayComplete: false,
  deferred: [],
  ...overrides,
});

// ---- THE BUG ----------------------------------------------------------------
check('yesterday finished, open, unsealed: the deck STAYS on yesterday', () => {
  const deck = checkinDeck(production());
  assert.equal(deck.mode, 'yesterday', `deck flipped to ${deck.mode}`);
  assert.equal(deck.target, 24, `target is ${deck.target}`);
});

check('...and its finished card OFFERS THE SEAL for day 24', () => {
  const deck = checkinDeck(production());
  assert.deepEqual(
    deck.finished,
    { kind: 'seal', day: 24 },
    `finished is ${JSON.stringify(deck.finished)} — the seal is unreachable`,
  );
});

check('...and yesterday is still on offer (switcher, notice) until it is sealed', () => {
  const deck = checkinDeck(production());
  assert.equal(deck.offerYesterday, true);
  assert.equal(deck.closedUnfinished, false);
  assert.equal(deck.yesterdayDone, 11);
  assert.equal(deck.yesterdayTotal, 11);
});

// The same state seen from today-mode: the user finished yesterday, then
// tapped TODAY. Yesterday must still be on offer so they can go back and seal.
check('yesterday finished and unsealed is still offered from today-mode', () => {
  const deck = checkinDeck(production({ activeDay: 'today' }));
  assert.equal(deck.mode, 'today');
  assert.equal(deck.offerYesterday, true, 'yesterday vanished from the switcher');
});

// ---- the moments around it --------------------------------------------------
check('one task short: yesterday-mode, target 24, nothing finished', () => {
  const deck = checkinDeck(production({
    yesterday: { ...production().yesterday, tasksDone: done(10) },
  }));
  assert.equal(deck.mode, 'yesterday');
  assert.equal(deck.target, 24);
  assert.equal(deck.queue.length, 1);
  assert.equal(deck.finished, null);
});

check('after the seal: the deck goes back to today, yesterday no longer offered', () => {
  const deck = checkinDeck(production({
    yesterday: { ...production().yesterday, sealed: true },
  }));
  assert.equal(deck.mode, 'today');
  assert.equal(deck.target, 25);
  assert.equal(deck.offerYesterday, false);
  assert.equal(deck.finished, null, 'today has eleven tasks left');
});

check('after noon, finished but unsealed: not offered, no seal — the evaluator owns it', () => {
  // seal_day() refuses a closed day (0011:289-292); evaluate_challenge seals
  // and pays it at the close (0011:446-454). The client must not pretend.
  const deck = checkinDeck(production({
    yesterday: { ...production().yesterday, open: false },
  }));
  assert.equal(deck.mode, 'today');
  assert.equal(deck.offerYesterday, false);
  assert.equal(deck.closedUnfinished, false, 'it was finished; it is not "closed unfinished"');
  assert.equal(deck.finished, null);
});

check('after noon, short: "closed unfinished" is said, nothing offered', () => {
  const deck = checkinDeck(production({
    yesterday: { ...production().yesterday, open: false, tasksDone: done(7) },
  }));
  assert.equal(deck.mode, 'today');
  assert.equal(deck.offerYesterday, false);
  assert.equal(deck.closedUnfinished, true);
});

// ---- parity with today, the path that already worked -------------------------
check('today finished and unsealed: the finished card goes to the celebration screen', () => {
  const deck = checkinDeck(production({
    activeDay: 'today',
    yesterday: null,
    todayDone: done(11),
  }));
  assert.equal(deck.mode, 'today');
  assert.deepEqual(deck.finished, { kind: 'celebrate', day: 25 });
});

check('today finished and sealed: a receipt, no button', () => {
  const deck = checkinDeck(production({
    activeDay: 'today',
    yesterday: null,
    todayDone: done(11),
    todayComplete: true,
  }));
  assert.deepEqual(deck.finished, { kind: 'sealed', day: 25 });
});

check('deferral orders today\'s queue and never applies to yesterday', () => {
  const t = checkinDeck(production({
    activeDay: 'today',
    yesterday: null,
    todayDone: done(2),
    deferred: ['water'],
  }));
  assert.equal(t.queue[t.queue.length - 1], 'water');
  const y = checkinDeck(production({
    yesterday: { ...production().yesterday, tasksDone: done(2) },
    deferred: ['water'],
  }));
  assert.equal(y.queue[0], 'water', 'yesterday must ignore today\'s deferrals');
});

// ---- THE SCREEN USES IT --------------------------------------------------------
// A pure function proves nothing about a screen that does not call it. These
// read the screen's source so the test cannot drift away from the path it
// covers — the same trade checkin-card.test.mjs and health-card.test.mjs make.
{
  const src = readFileSync(
    path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
      '..', 'src', 'app', '(tabs)', 'checkin.tsx'),
    'utf8',
  );
  check('the check-in screen builds its deck through checkinDeck()', () => {
    assert.match(src, /from '@\/lib\/checkinDeck'/, 'checkin.tsx does not import checkinDeck');
    assert.match(src, /checkinDeck\(\{/, 'checkin.tsx never calls checkinDeck');
  });
  check('the finished card takes its seal action from the deck, not from its own test', () => {
    assert.match(src, /finished\.kind === 'seal'/, 'the seal button is not driven by finished.kind');
    assert.doesNotMatch(src, /yDone < yTotal/, 'the screen still decides offerYesterday on its own');
  });
}

console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
