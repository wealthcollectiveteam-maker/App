/**
 * Proofs that the TODAY'S HEALTH CARD NEVER STATES WHAT IT DOES NOT KNOW.
 *
 * The defect these exist for: `requestAuthorization` is called from exactly
 * one place — the Health switch going ON — and `healthEnabled` defaulted to
 * true. On a fresh install the switch was already on, so nothing ever asked,
 * no grant ever existed, every reading came back null, and the card rendered
 *
 *     0 steps   0 active kcal   —   "No workouts recorded today."
 *
 * Zero is not "we were never allowed to look". That is the same
 * falsy-value-treated-as-data shape as f39b09b, and it would have shipped to
 * eleven people in the first native build.
 *
 * WHAT MAKES THIS UNFIXABLE BY GUESSING. HealthKit reports no authorization
 * status for READ types. A denied type returns no samples, identical to a
 * type with no data, and Apple provides no API to separate them — deliberately,
 * because "this app was denied heart rate" is itself a health disclosure. So
 * the card cannot say which it is. It can only stop pretending it knows, name
 * the ambiguity, and point at iOS Settings.
 *
 * The last block is a source read rather than a behaviour test, and that is on
 * purpose: `?? 0` on a reading is the single edit that would reintroduce the
 * whole defect, and it would not fail any of the assertions above it.
 *
 *   node --experimental-strip-types scripts/health-card.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { healthCardState } from '../src/lib/healthCardState.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, '..', 'src');

let passes = 0;
function ok(label) {
  passes += 1;
  console.log(`PASS: ${label}`);
}

/** Nothing read. Every field null, and workouts null — not []. */
const NOTHING = {
  dietaryKcal: null,
  steps: null,
  activeEnergyKcal: null,
  workouts: null,
  bodyMass: null,
};

// ---- the fresh-install case: the one that would have shipped --------------
{
  // Fresh install on a real iPhone. HealthKit is there, the sheet has never
  // been shown, so nothing is connected. The card must offer to connect —
  // never a data card, and never a data card full of zeroes.
  const state = healthCardState({
    available: true,
    connected: false,
    readings: NOTHING,
  });
  assert.deepEqual(state, { kind: 'connect' });
  ok('available but never asked renders the Connect prompt, not zeroes');
}

{
  // The exact state the old build reached: switch ON, permission never
  // granted, every read null. It must NOT become a readings card.
  const state = healthCardState({
    available: true,
    connected: true,
    readings: NOTHING,
  });
  assert.equal(state.kind, 'nothing-returned');
  ok('connected with nothing read says so — it does not draw a zero');
}

// ---- web, Android, Expo Go, simulator: no card at all ---------------------
{
  for (const connected of [false, true]) {
    const state = healthCardState({
      available: false,
      connected,
      readings: NOTHING,
    });
    assert.deepEqual(
      state,
      { kind: 'hidden' },
      'a card that cannot populate must not render',
    );
  }
  ok('no HealthKit source renders nothing — no prompt, no nag, no dead button');
}

// ---- null is not zero, and [] is not null --------------------------------
{
  // One real reading is enough to draw the card, and the fields that did not
  // come back are dashes. The footnote is what carries the ambiguity.
  const state = healthCardState({
    available: true,
    connected: true,
    readings: { ...NOTHING, steps: 4210 },
  });
  assert.equal(state.kind, 'readings');
  assert.equal(state.showAccessFootnote, true, 'dashes must be explained');
  ok('a partial read renders, with the missing values flagged as unknown');
}

{
  // A MEASURED zero is information about the day and stays visible. This is
  // the distinction the whole fix turns on: 0 read from real samples is a
  // fact; 0 standing in for "never allowed to look" is a claim.
  const state = healthCardState({
    available: true,
    connected: true,
    readings: {
      dietaryKcal: 0,
      steps: 0,
      activeEnergyKcal: 0,
      workouts: [],
      bodyMass: null,
    },
  });
  assert.equal(state.kind, 'readings', 'measured zeroes are not "nothing"');
  ok('zeroes read from real samples still render — they are measurements');
}

{
  // `workouts: []` is a completed query. On its own it is enough to say the
  // card has an answer, so it must not fall into 'nothing-returned'.
  const queried = healthCardState({
    available: true,
    connected: true,
    readings: { ...NOTHING, workouts: [] },
  });
  assert.equal(queried.kind, 'readings');

  // `workouts: null` is a query that never ran. With nothing else read, the
  // card knows nothing at all.
  const notQueried = healthCardState({
    available: true,
    connected: true,
    readings: { ...NOTHING, workouts: null },
  });
  assert.equal(notQueried.kind, 'nothing-returned');
  ok('an empty workout list is an answer; a null one is not');
}

{
  // A full read: nothing unknown, so nothing to explain.
  const state = healthCardState({
    available: true,
    connected: true,
    readings: {
      dietaryKcal: 1430,
      steps: 7412,
      activeEnergyKcal: 534,
      workouts: [{}],
      bodyMass: { kg: 82.5 },
    },
  });
  assert.equal(state.kind, 'readings');
  assert.equal(state.showAccessFootnote, false);
  ok('a complete read shows no access footnote — there is no dash to explain');
}

// ---- the source-level guards ---------------------------------------------
{
  // The one edit that would put the defect straight back, invisible to every
  // assertion above: a falsy-coalescing default on a reading.
  const card = readFileSync(
    path.join(src, 'components', 'TodaysHealthCard.tsx'),
    'utf8',
  );
  for (const banned of ['?? 0', '|| 0']) {
    assert.ok(
      !card.includes(banned),
      `TodaysHealthCard must never default a reading with "${banned}"`,
    );
  }
  assert.ok(
    !card.includes('No workouts recorded today'),
    'the card must not assert what was recorded — only what was returned',
  );
  ok('the card contains no zero-default and no "recorded today" claim');
}

{
  // The default itself. useAppStore imports react-native and cannot be
  // loaded here, so this reads the source — the same trade the column-map
  // check in server-prefs.test.mjs makes.
  const store = readFileSync(path.join(src, 'store', 'useAppStore.ts'), 'utf8');
  const defaults = store.slice(
    store.indexOf('const DEFAULT_HEALTH_PREFS'),
    store.indexOf('const DEFAULT_HEALTH_PREFS') + 400,
  );
  assert.ok(defaults.length > 0, 'DEFAULT_HEALTH_PREFS not found');
  assert.match(
    defaults,
    /healthEnabled:\s*false/,
    'healthEnabled must default false — ON with nothing having asked is the bug',
  );

  // And the readings that stand in for "we read nothing" must be null, not
  // an empty array that later reads as "queried and empty".
  const empty = store.slice(
    store.indexOf('const EMPTY_READINGS'),
    store.indexOf('const EMPTY_READINGS') + 300,
  );
  assert.match(
    empty,
    /workouts:\s*null/,
    'EMPTY_READINGS.workouts must be null, never []',
  );
  ok('healthEnabled defaults false and EMPTY_READINGS.workouts is null');
}

console.log(`\nAll ${passes} health-card truthfulness checks passed.`);
