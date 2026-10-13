// REACHABILITY of the weekly check-in card (Phase 16 Part A).
//
// WHAT THIS TEST IS FOR, stated plainly, because the last three suites did
// not catch this class of bug:
//
//   Every other test in this repo asserts that a THING WORKS. saveMetricCheckin
//   writes a row. The RLS proofs show the row is owner-scoped. units.test.mjs
//   shows the conversion round-trips. All of that stayed green while the card
//   containing the only input field rendered nothing at all, because "can the
//   user reach it" was never a property anything asserted.
//
//   So this suite asserts REACHABILITY and nothing else. It does not test that
//   a check-in saves. It tests that there is somewhere to save one from.
//
// Run: npm run test:checkin-card
import { checkinCardState as fixed } from '../src/lib/checkinCard.ts';

// ---------------------------------------------------------------------------
// PROOF (f): the same assertions, run against the BROKEN behaviour.
//
//   npm run test:checkin-card -- --old
//
// The old decision could not be imported — that is the whole point of the
// bug. It lived as early returns inside WeeklyCheckinCard.tsx, where no Node
// test could reach it. So it is TRANSCRIBED here, from the component as it
// stood at f39b09b (Phase 9 Part 1) through HEAD:
//
//     if (!weeklyCheckinEnabled) return null;
//     if (checkinHandledWeek === localWeekKey()) {
//       const last = metricCheckins[0];
//       if (!last?.weightKg) return null;      // <- the bug
//       return ( ...the "Last check-in" line... );
//     }
//     return ( ...the full card... );
//
// This is a transcription, not the original module, and it is worth saying so:
// it is faithful to the branch structure but it is not the file that shipped.
// What it demonstrates is that the assertions below have teeth — that they
// distinguish the two behaviours rather than passing against anything.
// ---------------------------------------------------------------------------
function brokenCheckinCardState(input) {
  if (!input.enabled) return { mode: 'hidden' };
  if (input.handledWeek === input.thisWeek) {
    const last = input.checkins[0];
    if (!last?.weightKg) return { mode: 'hidden' };
    return {
      mode: 'summary',
      lastWeightKg: last.weightKg,
      lastAt: last.timestamp,
      hasHistory: input.checkins.length > 0,
    };
  }
  return { mode: 'entry', hasHistory: input.checkins.length > 0 };
}

const USE_OLD = process.argv.includes('--old');
const checkinCardState = USE_OLD ? brokenCheckinCardState : fixed;
if (USE_OLD) {
  console.log('RUNNING AGAINST THE BROKEN BEHAVIOUR (transcribed) — failures expected.\n');
}

let failures = 0;
function expect(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}` +
      (ok ? '' : ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`),
  );
  if (!ok) failures++;
}
function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) failures++;
}

const WEEK = '2026-W35';
const LAST_WEEK = '2026-W34';
const AT = Date.parse('2026-08-27T09:00:00Z');

const base = { enabled: true, handledWeek: null, thisWeek: WEEK, checkins: [] };

// ---------------------------------------------------------------------------
// THE REGRESSION. This is the case that shipped.
//
// A mood-only check-in stores weightKg = null and marks the week handled. The
// old component ran `if (!last?.weightKg) return null` and the whole card —
// field, mood row, Save, dismiss X, history link — was gone until the week
// turned over. Against the broken code this assertion fails; that is the
// point of it.
// ---------------------------------------------------------------------------
const moodOnly = checkinCardState({
  ...base,
  handledWeek: WEEK,
  checkins: [{ weightKg: null, timestamp: AT }],
});
check(
  'a mood-only check-in does not make the card disappear',
  moodOnly.mode !== 'hidden',
);
expect('...it shows the summary row, with no weight in it', moodOnly, {
  mode: 'summary',
  lastWeightKg: null,
  lastAt: AT,
  hasHistory: true,
});

// A weightless check-in with NO history at all — the same null read, one step
// worse, because there is not even a row to describe.
const dismissedEmpty = checkinCardState({ ...base, handledWeek: WEEK });
check(
  'a handled week with no check-ins at all still renders something',
  dismissedEmpty.mode !== 'hidden',
);
expect('...summary, empty, and it knows there is no history to link to', dismissedEmpty, {
  mode: 'summary',
  lastWeightKg: null,
  lastAt: null,
  hasHistory: false,
});

// ---------------------------------------------------------------------------
// THE INVARIANT, over the whole input space rather than a handful of cases:
// enabled === true implies the card is on screen in SOME form.
// ---------------------------------------------------------------------------
let hiddenWhileEnabled = 0;
let cases = 0;
for (const handledWeek of [null, WEEK, LAST_WEEK]) {
  for (const checkins of [
    [],
    [{ weightKg: null, timestamp: AT }],
    [{ weightKg: 0, timestamp: AT }],
    [{ weightKg: 92.1, timestamp: AT }],
    [{ weightKg: 92.1, timestamp: AT }, { weightKg: null, timestamp: AT - 1e9 }],
  ]) {
    cases++;
    const s = checkinCardState({ enabled: true, handledWeek, thisWeek: WEEK, checkins });
    if (s.mode === 'hidden') hiddenWhileEnabled++;
  }
}
check(
  `enabled => never hidden, across all ${cases} state combinations ` +
    `(${hiddenWhileEnabled} hid)`,
  hiddenWhileEnabled === 0,
);

// weightKg = 0 is the same falsy trap as null and must not hide the card
// either. `!last?.weightKg` was true for both.
const zero = checkinCardState({
  ...base,
  handledWeek: WEEK,
  checkins: [{ weightKg: 0, timestamp: AT }],
});
check('a zero weight does not hide the card either', zero.mode !== 'hidden');

// ---------------------------------------------------------------------------
// The entry path specifically. "Reachable" means the mode that carries the
// input field, not merely "something rendered".
// ---------------------------------------------------------------------------
expect('a fresh week offers the entry form', checkinCardState(base), {
  mode: 'entry',
  hasHistory: false,
});
expect(
  'last week handled is not this week — entry again, history intact',
  checkinCardState({
    ...base,
    handledWeek: LAST_WEEK,
    checkins: [{ weightKg: 92.1, timestamp: AT }],
  }),
  { mode: 'entry', hasHistory: true },
);

// ---------------------------------------------------------------------------
// History reachability, reported separately from entry — losing one is not
// the same failure as losing the other.
// ---------------------------------------------------------------------------
const withHistory = [{ weightKg: 92.1, timestamp: AT }];
check(
  'history is reachable from the entry form when rows exist',
  checkinCardState({ ...base, checkins: withHistory }).hasHistory === true,
);
check(
  'history is reachable from the summary row when rows exist',
  checkinCardState({ ...base, handledWeek: WEEK, checkins: withHistory })
    .hasHistory === true,
);
check(
  'and is not advertised when there is nothing to show',
  checkinCardState(base).hasHistory === false,
);

// ---------------------------------------------------------------------------
// The one legitimate way to render nothing.
// ---------------------------------------------------------------------------
expect(
  'switched off in Settings is the ONLY hidden state',
  checkinCardState({ ...base, enabled: false, checkins: withHistory }),
  { mode: 'hidden' },
);

// The normal week: handled, with a weight, reads back the stored value.
expect(
  'a handled week with a weight shows it',
  checkinCardState({ ...base, handledWeek: WEEK, checkins: withHistory }),
  { mode: 'summary', lastWeightKg: 92.1, lastAt: AT, hasHistory: true },
);

if (USE_OLD) {
  console.log(
    `\n${failures} check(s) failed against the broken behaviour, as they must. ` +
      'A suite that passes here would prove nothing.',
  );
  // Inverted on purpose: against the old behaviour, FAILING is the pass.
  process.exit(failures > 0 ? 0 : 1);
}
console.log(
  failures
    ? `\n${failures} reachability check(s) FAILED.`
    : '\nThe check-in card is reachable in every state but "switched off".',
);
process.exit(failures ? 1 : 0);
