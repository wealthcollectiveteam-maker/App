/**
 * Proofs for THREE THINGS THE SQUAD SAW THAT WEREN'T TRUE (Phase 38S, S3):
 * the 0/0 grace line, "Squad starts today" 35 days in, and one person with
 * three sets of initials. See src/lib/squadCopy.ts.
 *
 * FAIL-FIRST: `--old` runs the same assertions against the expressions the
 * screens used at 8d54758, transcribed. The three defects fail there.
 *
 *   npm run test:squad-copy
 *   npm run test:squad-copy -- --old
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as fixed from '../src/lib/squadCopy.ts';

// 8d54758, transcribed from the screens.
const old = {
  // squad.tsx member row
  graceLine: (m) =>
    m.graceDay === null ? null : 'Still finishing Day ' + m.graceDay + ' · ' + m.graceDone + '/' + m.graceTasks + ' · until noon',
  // squad.tsx header / index.tsx strip
  squadStreakLabel: (streak, _members, short = false) =>
    streak > 0 ? (short ? `${streak}-day` : `${streak}-day squad streak`) : short ? 'Starts today' : 'Squad starts today',
  // you.tsx: the first two letters
  initialsOf: (name) => name.slice(0, 2).toUpperCase(),
};
// SupabaseDataService's roster formula at 8d54758 — what the Squad tab showed.
const rosterInitials = (name) =>
  name.trim().split(/\s+/).map((p) => p[0] ?? '').join('').slice(0, 2).toUpperCase() || 'YO';

const USE_OLD = process.argv.includes('--old');
const lib = USE_OLD ? old : fixed;
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

// ---- 1. the grace line -------------------------------------------------------
check('S3.1: a grace day the server has no snapshot for never reads 0/0', () => {
  const line = lib.graceLine({ graceDay: 34, graceDone: 0, graceTasks: 0 });
  assert.ok(line, 'the line disappeared — the member IS still finishing Day 34');
  assert.doesNotMatch(line, /0\/0/, `"${line}"`);
  assert.match(line, /Day 34/);
  assert.match(line, /until noon/);
});
check('S3.1: a known day still shows its count (guard)', () => {
  assert.equal(lib.graceLine({ graceDay: 34, graceDone: 3, graceTasks: 6 }), 'Still finishing Day 34 · 3/6 · until noon');
  assert.equal(lib.graceLine({ graceDay: null, graceDone: 0, graceTasks: 0 }), null);
});

// ---- 2. the squad streak ----------------------------------------------------------
const day35 = [{ day: 35 }, { day: 45 }, { day: 27 }];
check('S3.2: a squad 35 days in with a 0 streak does not "start today"', () => {
  for (const short of [false, true]) {
    const label = lib.squadStreakLabel(0, day35, short);
    assert.doesNotMatch(label, /starts today/i, `"${label}"`);
  }
});
check('S3.2: a squad all on day 1 still starts today; a running streak still counts (guard)', () => {
  assert.equal(lib.squadStreakLabel(0, [{ day: 1 }, { day: 1 }]), 'Squad starts today');
  assert.equal(lib.squadStreakLabel(0, [{ day: 1 }], true), 'Starts today');
  assert.equal(lib.squadStreakLabel(12, day35), '12-day squad streak');
  assert.equal(lib.squadStreakLabel(12, day35, true), '12-day');
});

// ---- 3. initials ----------------------------------------------------------------
check('S3.4: You and Squad give one person the same initials', () => {
  // What the Squad tab shows: the roster's formula then, the shared one now.
  const squadShows = USE_OLD ? rosterInitials : fixed.initialsOf;
  for (const name of ['Sam Rivera', 'Ana Lu Kim']) {
    assert.equal(lib.initialsOf(name), squadShows(name), `You shows "${lib.initialsOf(name)}", Squad shows "${squadShows(name)}"`);
  }
  assert.equal(lib.initialsOf('Sam Rivera'), 'SR', 'You showed "SA" where Squad showed "SR"');
});
check('S3.4: a one-word name gives its first two letters', () => {
  assert.equal(lib.initialsOf('Maya'), 'MA');
  assert.equal(lib.initialsOf('  '), 'YO');
});

// ---- SOURCE ATTACHMENT: every screen reads the one formula -------------------
if (!USE_OLD) {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const read = (...p) => readFileSync(path.join(root, ...p), 'utf8');
  const squad = read('src', 'app', '(tabs)', 'squad.tsx');
  const home = read('src', 'app', '(tabs)', 'index.tsx');
  const you = read('src', 'app', '(tabs)', 'you.tsx');
  const svc = read('src', 'services', 'backend', 'SupabaseDataService.ts');
  check('every screen uses squadCopy, none has its own formula', () => {
    assert.match(squad, /graceLine\(m\)/, 'squad.tsx builds its own grace line');
    assert.match(squad, /squadStreakLabel\(/, 'squad.tsx has its own streak label');
    assert.match(home, /squadStreakLabel\(/, 'index.tsx has its own streak label');
    assert.match(you, /initialsOf\(profileName\)/, 'you.tsx has its own initials');
    assert.match(svc, /initialsOf\(/, 'the roster has its own initials');
    for (const [f, src] of [['squad.tsx', squad], ['you.tsx', you]]) {
      assert.doesNotMatch(src, /\.slice\(0, 2\)\.toUpperCase\(\)/, `${f} still slices a name into initials`);
    }
    assert.doesNotMatch(squad, /'Squad starts today'/, 'squad.tsx still says it inline');
  });
}

if (USE_OLD) {
  console.log(`\n${passes} passed, ${failures} failed against the old behaviour — they must fail.`);
  process.exit(failures > 0 ? 0 : 1);
}
console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
