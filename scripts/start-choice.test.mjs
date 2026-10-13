/**
 * Proofs for "START TOMORROW" at setup and THE DAY BEFORE (Phase 38F, F1),
 * and for THE RETURNING PERSON (F3).
 *
 * Production, 2026-09-24: nine of eleven sign-ups were between 20:38 and
 * 23:52; none of nine ever completed a full day. Setup now offers today or
 * tomorrow, preselected by the clock; the evening before a tomorrow start is
 * a defined screen rather than an error; and get_or_freeze_today's refusals
 * are classified by one pure function so an existing account can never be
 * read as new.
 *
 * WHERE THIS TEST STANDS. Every decision lives in src/lib/startChoice.ts and
 * src/lib/accountState.ts, and the screens render what they return, so this
 * file drives the SAME functions.
 *
 * PROOF (f): `--old` runs the assertions against the behaviour as it stood
 * through 38E, transcribed: no choice (always today), no waiting state (the
 * classifier knew one string), no returning-person line. The cases that
 * distinguish fail there; the guards pass before and after and are marked.
 *
 *   npm run test:start-choice
 *   npm run test:start-choice -- --old
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { classifyAccountError as fixedClassify } from '../src/lib/accountState.ts';
import {
  daysBetween,
  defaultStartChoice as fixedDefault,
  RETURNING_DORMANT_COPY,
  returningLine as fixedReturning,
  START_CHOICE_COPY,
  START_TOMORROW_FROM_HOUR,
  startButtonLabel,
  startChoiceLine,
  waitingLine,
  waitingTitle,
} from '../src/lib/startChoice.ts';

// ---- the OLD behaviour, transcribed --------------------------------------
// session.ts through 38E: `if (/no challenge/i.test(message)) return
// 'needs-challenge'; throw error;` — and setup had no start choice at all
// (session.ts always passed today's date), and nothing about a previous
// challenge was ever read or shown.
function oldClassify(message) {
  return /no challenge/i.test(message) ? 'needs-challenge' : null;
}
function oldDefault() {
  return 'today';
}
function oldReturning() {
  return null;
}

const USE_OLD = process.argv.includes('--old');
const classifyAccountError = USE_OLD ? oldClassify : fixedClassify;
const defaultStartChoice = USE_OLD ? oldDefault : fixedDefault;
const returningLine = USE_OLD ? oldReturning : fixedReturning;
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

const oneSentence = (s, what) => {
  assert.doesNotMatch(s, /!/, `${what}: an exclamation mark`);
  assert.equal((s.match(/[.!?]/g) ?? []).length, 1, `${what}: one sentence only`);
  assert.match(s, /\.$/, `${what}: ends with a full stop`);
  assert.doesNotMatch(s, /\p{Extended_Pictographic}/u, `${what}: an emoji`);
};

// ---- F1: the preselection --------------------------------------------------
check('a sign-up before the threshold hour preselects TODAY', () => {
  assert.equal(defaultStartChoice(9), 'today');
  assert.equal(defaultStartChoice(START_TOMORROW_FROM_HOUR - 1), 'today');
});

check('a sign-up from the threshold hour on preselects TOMORROW', () => {
  assert.equal(defaultStartChoice(START_TOMORROW_FROM_HOUR), 'tomorrow', 'the 18:00 sign-up was handed today');
  assert.equal(defaultStartChoice(21), 'tomorrow');
  assert.equal(defaultStartChoice(23), 'tomorrow', 'the 23:52 sign-up was handed today');
});

check('the threshold is 18:00, and not the grace deadline', () => {
  assert.equal(START_TOMORROW_FROM_HOUR, 18);
});

check('every hour of the day resolves, and the boundary is sharp (sweep)', () => {
  for (let h = 0; h < 24; h += 1) {
    const c = defaultStartChoice(h);
    assert.ok(c === 'today' || c === 'tomorrow', `hour ${h} gave ${c}`);
    if (!USE_OLD) {
      assert.equal(c, h >= 18 ? 'tomorrow' : 'today', `hour ${h}`);
    }
  }
});

// ---- F1: the copy -------------------------------------------------------------
check('each choice has one plain sentence that says what will happen', () => {
  oneSentence(START_CHOICE_COPY.today, 'today');
  oneSentence(START_CHOICE_COPY.tomorrow, 'tomorrow');
  assert.match(START_CHOICE_COPY.today, /noon tomorrow/, 'today names the grace window');
  assert.match(START_CHOICE_COPY.tomorrow, /no tasks today/, 'tomorrow says what today is');
  assert.equal(startChoiceLine('today'), START_CHOICE_COPY.today);
  assert.equal(startChoiceLine('tomorrow'), START_CHOICE_COPY.tomorrow);
});

check('the button names the day it will create', () => {
  assert.equal(startButtonLabel('today', false), 'Start day 01 →');
  assert.equal(startButtonLabel('tomorrow', false), 'Start tomorrow →');
  assert.equal(startButtonLabel('tomorrow', true), 'Starting…');
});

// ---- F1: the day before the start --------------------------------------------
check("get_or_freeze_today's 'challenge not started' reads as WAITING, not as a new account", () => {
  const s = classifyAccountError('challenge not started: day 1 is 2026-09-25');
  assert.equal(
    s,
    'not-started',
    `classified as ${s} — ${s === null ? 'the first evening is a thrown error' : 'setup would create a second challenge'}`,
  );
});

check("'no challenge for user' still reads as a new account (guard)", () => {
  assert.equal(classifyAccountError('no challenge for user'), 'needs-challenge');
});

check('anything else is still an error, never read as new (guard)', () => {
  assert.equal(classifyAccountError('permission denied for table challenges'), null);
  assert.equal(classifyAccountError('JWT expired'), null);
  assert.equal(classifyAccountError('day 0 is closed (open: 1 to 0)'), null, 'the unnamed refusal must not be widened into');
  assert.equal(classifyAccountError(''), null);
});

check('the waiting screen says when day 1 is, in one sentence', () => {
  assert.equal(daysBetween('2026-09-24', '2026-09-25'), 1);
  assert.equal(waitingTitle('2026-09-25', '2026-09-24'), 'Day 1 is tomorrow.');
  oneSentence(waitingLine('2026-09-25', '2026-09-24'), 'waiting');
  assert.match(waitingLine('2026-09-25', '2026-09-24'), /tomorrow/);
  assert.match(waitingLine('2026-09-27', '2026-09-24'), /2026-09-27/);
  assert.equal(waitingTitle('2026-09-24', '2026-09-24'), 'Day 1 is today.');
  // Across a month boundary too.
  assert.equal(daysBetween('2026-09-30', '2026-10-01'), 1);
});

// ---- F3: the returning person -----------------------------------------------
check('a dormant owner reaching setup sees the explanation', () => {
  const line = returningLine('dormant');
  assert.equal(line, RETURNING_DORMANT_COPY, 'no explanation — the returning person is treated as new');
});

check("...and it is two plain sentences that do not say 'runs' and do not scold", () => {
  assert.doesNotMatch(RETURNING_DORMANT_COPY, /!/, 'an exclamation mark');
  assert.doesNotMatch(RETURNING_DORMANT_COPY, /\bruns?\b/, "'run' is our word, not a user's");
  assert.match(RETURNING_DORMANT_COPY, /attempts/);
  assert.equal((RETURNING_DORMANT_COPY.match(/[.!?]/g) ?? []).length, 2, 'two sentences');
  assert.doesNotMatch(RETURNING_DORMANT_COPY, /sorry|unfortunately|disappoint|fail/i, 'no reproach');
});

check('a genuinely new account sees nothing about a previous challenge (guard)', () => {
  assert.equal(returningLine(null), null);
  assert.equal(returningLine(undefined), null);
});

check("a finished or restarted ending is not explained either — only dormant (guard)", () => {
  assert.equal(returningLine('completed'), null);
  assert.equal(returningLine('missed_day'), null);
});

// ---- SOURCE ATTACHMENT ------------------------------------------------------
if (!USE_OLD) {
  const here = path.dirname(
    new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  );
  const read = (...p) => readFileSync(path.join(here, '..', ...p), 'utf8');
  const auth = read('src', 'app', 'auth.tsx');
  const session = read('src', 'services', 'backend', 'session.ts');
  const gate = read('src', 'components', 'SessionGate.tsx');
  const store = read('src', 'store', 'useSessionStore.ts');

  check('setup preselects through defaultStartChoice() and renders startChoiceLine()', () => {
    assert.match(auth, /from '@\/lib\/startChoice'/, 'auth.tsx does not import startChoice');
    assert.match(auth, /defaultStartChoice\(/, 'auth.tsx never calls defaultStartChoice');
    assert.match(auth, /startChoiceLine\(startChoice\)/, 'the consequence line is not the module\'s');
    assert.match(auth, /startChoice === 'tomorrow'/, 'the choice never reaches finishSetup');
    assert.doesNotMatch(auth, /Day 1 starts/, 'the copy is hardcoded in the component');
  });
  check('both start options are always rendered — neither is hidden behind a condition', () => {
    assert.match(auth, /\(\['today', 'tomorrow'\] as const\)\.map/, 'the two options are not rendered together');
  });
  check('checkAccount classifies through classifyAccountError()', () => {
    assert.match(session, /from '@\/lib\/accountState'/, 'session.ts does not import accountState');
    assert.match(session, /classifyAccountError\(message\)/, 'session.ts never calls the classifier');
    assert.doesNotMatch(session, /\/no challenge\/i\.test/, 'session.ts still classifies on its own');
    assert.doesNotMatch(session, /startDateFor/, 'the client still sends a start date');
  });
  check('the waiting screen exists, renders the module\'s copy, and the store can reach it', () => {
    assert.match(gate, /SessionWaitingScreen/, 'no waiting screen');
    assert.match(gate, /waitingLine\(/, 'the waiting screen does not render waitingLine');
    assert.match(store, /'not-started'/, 'the session store never handles not-started');
    assert.match(store, /status: 'waiting'/, 'the session store never enters waiting');
  });
  check('setup renders the returning-person line through returningLine()', () => {
    assert.match(auth, /returningLine\(/, 'auth.tsx never calls returningLine');
    assert.doesNotMatch(auth, /two attempts/, 'the copy is hardcoded in the component');
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
