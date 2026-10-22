/**
 * Proofs for src/lib/healthLinks.ts — link a task to Apple Health.
 *
 * Three things this file exists to hold:
 *   - a rule that is NOT met says nothing (null), never a grade;
 *   - a sealed day gets no suggestions at all, so nothing can complete it;
 *   - a default is only OFFERED from the wording; the stored blob is
 *     sanitised on the way in, so a link never carries anything but the
 *     rule the user confirmed.
 *
 *   node --experimental-strip-types scripts/health-links.test.mjs
 */
import assert from 'node:assert/strict';

import {
  LITRES_PER_GALLON,
  buildSuggestions,
  describeLink,
  evaluateLink,
  formatWater,
  parseClock,
  restoreLinks,
  sanitizeLink,
  suggestLinkForText,
} from '../src/lib/healthLinks.ts';
import { sleepNightFor } from '../src/lib/sleepNight.ts';

let passes = 0;
function ok(label) {
  passes += 1;
  console.log(`PASS: ${label}`);
}

const ZONE = 'America/Toronto';
const MIN = 60_000;
const H = 60 * MIN;
const toronto = (y, m, d, hh, mm) => Date.UTC(y, m - 1, d, hh + 4, mm); // EDT
const ctx = { zone: ZONE, unitPreference: 'metric', consumedWorkouts: [] };

/** Last night: 22:40 → 05:52, Oura and the watch both on it. */
const NIGHT = sleepNightFor(
  [
    { startMs: toronto(2026, 9, 26, 22, 40), endMs: toronto(2026, 9, 27, 5, 52), value: 1, source: 'Oura' },
    { startMs: toronto(2026, 9, 26, 22, 45), endMs: toronto(2026, 9, 27, 5, 50), value: 3, source: 'Apple Watch' },
  ],
  '2026-09-27',
  ZONE,
);
assert.equal(NIGHT.asleepMinutes, 7 * 60 + 12);

const NOTHING = { night: null, water: null, steps: null, mindful: null, workouts: null };
const FACTS = {
  night: NIGHT,
  water: { value: 3900, sources: ['iPhone'] },
  steps: { value: 10412, sources: ['Apple Watch'] },
  mindful: { value: 12, sources: ['Apple Watch'] },
  workouts: [
    { type: 'Functional Strength Training', minutes: 47, startISO: new Date(toronto(2026, 9, 27, 18, 12)).toISOString(), source: 'Apple Watch' },
  ],
};

// ---- the owner's tasks, offered as defaults -------------------------------
{
  assert.deepEqual(suggestLinkForText({ key: 'custom-1', label: 'Sleep 6-8 hours a day' }), { kind: 'sleep', minHours: 6, maxHours: 8 });
  assert.deepEqual(suggestLinkForText({ key: 'custom-2', label: 'Wake up at 6am' }), { kind: 'wake', byMinute: 360 });
  assert.deepEqual(suggestLinkForText({ key: 'custom-3', label: 'Wake up by 5:30 AM' }), { kind: 'wake', byMinute: 330 });
  assert.deepEqual(
    suggestLinkForText({ key: 'water', label: 'Gallon of water', target: { value: 1, unit: 'gallons' } }),
    { kind: 'water', minLitres: LITRES_PER_GALLON },
  );
  assert.deepEqual(suggestLinkForText({ key: 'custom-4', label: 'Drink 3 litres of water' }), { kind: 'water', minLitres: 3 });
  assert.deepEqual(suggestLinkForText({ key: 'custom-5', label: '10k steps' }), { kind: 'steps', minSteps: 10_000 });
  assert.deepEqual(suggestLinkForText({ key: 'custom-6', label: 'Walk 8,000 steps' }), { kind: 'steps', minSteps: 8000 });
  assert.deepEqual(suggestLinkForText({ key: 'custom-7', label: 'Meditate 10 min' }), { kind: 'mindful', minMinutes: 10 });
  assert.deepEqual(
    suggestLinkForText({ key: 'workout1', label: 'Workout 45 min', target: { value: 45, unit: 'minutes' } }),
    { kind: 'workout', minMinutes: 45 },
  );
  assert.equal(suggestLinkForText({ key: 'read', label: 'Read 10 pages' }), null);
  assert.equal(suggestLinkForText({ key: 'photo', label: 'Progress photo' }), null);
  assert.equal(suggestLinkForText({ key: 'custom-8', label: 'Call my mother' }), null);
  ok('wording that plainly matches gets a default; wording that does not gets none');
}

{
  assert.equal(parseClock('6am'), 360);
  assert.equal(parseClock('6:30 am'), 390);
  assert.equal(parseClock('12am'), 0);
  assert.equal(parseClock('12:15 pm'), 735);
  assert.equal(parseClock('17:45'), 1065);
  assert.equal(parseClock('25:00'), null);
  ok('clock times parse in both notations');
}

// ---- met, and the exact line ---------------------------------------------
{
  const s = evaluateLink({ kind: 'sleep', minHours: 6, maxHours: 8 }, FACTS, ctx);
  assert.deepEqual(s, { text: 'Apple Health: 7h 12m asleep last night (Apple Watch, Oura).' });
  const w = evaluateLink({ kind: 'wake', byMinute: 360 }, FACTS, ctx);
  assert.deepEqual(w, { text: 'Apple Health: up at 5:52 AM (Apple Watch, Oura).' });
  const water = evaluateLink({ kind: 'water', minLitres: LITRES_PER_GALLON }, FACTS, ctx);
  assert.deepEqual(water, { text: 'Apple Health: 3.9 L of water today (iPhone).' });
  const imperial = evaluateLink({ kind: 'water', minLitres: LITRES_PER_GALLON }, FACTS, { ...ctx, unitPreference: 'imperial' });
  assert.deepEqual(imperial, { text: 'Apple Health: 1.03 gal of water today (iPhone).' });
  const steps = evaluateLink({ kind: 'steps', minSteps: 10_000 }, FACTS, ctx);
  assert.deepEqual(steps, { text: 'Apple Health: 10,412 steps today (Apple Watch).' });
  const mindful = evaluateLink({ kind: 'mindful', minMinutes: 10 }, FACTS, ctx);
  assert.deepEqual(mindful, { text: 'Apple Health: 12 mindful minutes today (Apple Watch).' });
  const workout = evaluateLink({ kind: 'workout', minMinutes: 45 }, FACTS, ctx);
  assert.equal(workout.workoutStartISO, FACTS.workouts[0].startISO);
  assert.match(workout.text, /^Apple Health saw a 47-min Functional Strength Training at .* \(Apple Watch\)\.$/);
  ok('each rule, when met, names what Apple Health saw and where it came from');
}

// ---- not met: silence -----------------------------------------------------
{
  assert.equal(evaluateLink({ kind: 'sleep', minHours: 8 }, FACTS, ctx), null, '7h12 is not 8 h — and nothing says so');
  assert.equal(evaluateLink({ kind: 'sleep', minHours: 6, maxHours: 7 }, FACTS, ctx), null, 'over the maximum is not met either');
  assert.equal(evaluateLink({ kind: 'wake', byMinute: 5 * 60 + 45 }, FACTS, ctx), null, '5:52 is after 5:45');
  assert.equal(evaluateLink({ kind: 'water', minLitres: 4 }, FACTS, ctx), null);
  assert.equal(evaluateLink({ kind: 'steps', minSteps: 12_000 }, FACTS, ctx), null);
  assert.equal(evaluateLink({ kind: 'mindful', minMinutes: 15 }, FACTS, ctx), null);
  assert.equal(evaluateLink({ kind: 'workout', minMinutes: 60 }, FACTS, ctx), null);
  for (const link of [
    { kind: 'sleep', minHours: 1 }, { kind: 'wake', byMinute: 720 }, { kind: 'water', minLitres: 0.1 },
    { kind: 'steps', minSteps: 1 }, { kind: 'mindful', minMinutes: 1 }, { kind: 'workout', minMinutes: 1 },
  ]) {
    assert.equal(evaluateLink(link, NOTHING, ctx), null, `${link.kind}: nothing read → nothing said`);
  }
  ok('a rule that is not met, or a fact that was not read, produces nothing at all');
}

// ---- the wake clock is the challenge zone's ------------------------------
{
  // The same instant is 2:52 AM in Los Angeles. The rule says "by 6:00",
  // in the challenge's zone, and the line prints that zone's clock.
  const la = evaluateLink({ kind: 'wake', byMinute: 360 }, FACTS, { ...ctx, zone: 'America/Los_Angeles' });
  assert.deepEqual(la, { text: 'Apple Health: up at 2:52 AM (Apple Watch, Oura).' });
  ok('the wake time is read on the challenge’s clock');
}

// ---- a day's suggestions --------------------------------------------------
const TASKS = [
  { key: 'workout1', label: 'Workout 45 min', target: { value: 45, unit: 'minutes' } },
  { key: 'workout2', label: 'Second workout 45 min', target: { value: 45, unit: 'minutes' } },
  { key: 'water', label: 'Gallon of water', target: { value: 1, unit: 'gallons' } },
  { key: 'custom-1', label: 'Sleep 6-8 hours a day' },
  { key: 'custom-2', label: 'Wake up at 6am' },
  { key: 'read', label: 'Read 10 pages' },
];
const LINKS = {
  water: { kind: 'water', minLitres: LITRES_PER_GALLON },
  'custom-1': { kind: 'sleep', minHours: 6, maxHours: 8 },
  'custom-2': { kind: 'wake', byMinute: 360 },
};
const base = {
  tasks: TASKS,
  tasksDone: {},
  links: LINKS,
  facts: FACTS,
  dismissed: {},
  dateKey: '2026-09-27',
  dayOpen: true,
  ctx,
};

{
  const out = buildSuggestions(base);
  assert.deepEqual(Object.keys(out).sort(), ['custom-1', 'custom-2', 'water', 'workout1']);
  assert.equal(out.workout1.workoutStartISO, FACTS.workouts[0].startISO);
  assert.ok(!out.workout2, 'one recorded workout vouches for ONE task');
  assert.ok(!out.read, 'an unlinked task with no default gets nothing');
  ok('linked tasks whose rules are met get a suggestion; one workout is spent once');
}

{
  // THE SEALED DAY. Nothing. Not for the linked tasks, not for the implicit
  // workout link, whatever the facts say.
  const out = buildSuggestions({ ...base, dayOpen: false });
  assert.deepEqual(out, {});
  ok('a sealed day gets no suggestions — nothing can offer to complete it');
}

{
  const done = buildSuggestions({ ...base, tasksDone: { 'custom-1': '6:10 AM', workout1: '7:00 PM' } });
  assert.ok(!done['custom-1'] && !done.workout1, 'done tasks are not suggested');
  assert.ok(done.workout2, 'with workout1 done, the recording vouches for workout2');
  ok('a completed task is left alone, and its workout frees up for the next');
}

{
  const today = buildSuggestions({ ...base, dismissed: { 'custom-1': '2026-09-27', water: '2026-09-26' } });
  assert.ok(!today['custom-1'], 'dismissed today stays dismissed');
  assert.ok(today.water, 'dismissed yesterday is back today');
  ok('a dismissal holds for the day it was made and no longer');
}

{
  // A saved link OVERRIDES the implicit workout rule: the owner links
  // workout2 to steps instead.
  const out = buildSuggestions({ ...base, links: { ...LINKS, workout2: { kind: 'steps', minSteps: 10_000 } } });
  assert.match(out.workout2.text, /10,412 steps/);
  assert.equal(out.workout2.workoutStartISO, undefined);
  ok('a saved link replaces a tier task’s implicit workout rule');
}

{
  const consumed = buildSuggestions({ ...base, ctx: { ...ctx, consumedWorkouts: [FACTS.workouts[0].startISO] } });
  assert.ok(!consumed.workout1 && !consumed.workout2, 'a recording spent earlier is not offered again');
  ok('a workout already used to confirm a task is never reused');
}

// ---- storage: configuration only, sanitised -------------------------------
{
  const raw = JSON.stringify({
    'custom-1': { kind: 'sleep', minHours: 6, maxHours: 8, asleepMinutes: 432, source: 'Oura' },
    'custom-2': { kind: 'wake', byMinute: 360 },
    water: { kind: 'water', minLitres: '3.785' },
    steps: { kind: 'steps', minSteps: -5 },
    bogus: { kind: 'heartRate', min: 1 },
    junk: 'not an object',
  });
  const links = restoreLinks(raw);
  assert.deepEqual(links, {
    'custom-1': { kind: 'sleep', minHours: 6, maxHours: 8 },
    'custom-2': { kind: 'wake', byMinute: 360 },
  });
  assert.deepEqual(restoreLinks('{not json'), {});
  assert.deepEqual(restoreLinks(null), {});
  assert.deepEqual(restoreLinks('[1,2]'), {});
  assert.equal(sanitizeLink({ kind: 'wake', byMinute: 1500 }), null, 'a minute past midnight is not a time');
  ok('the stored blob keeps only the rule fields of known kinds — nothing from HealthKit can ride along');
}

{
  assert.equal(describeLink({ kind: 'sleep', minHours: 6, maxHours: 8 }, 'metric'), 'Asleep 6 h to 8 h last night');
  assert.equal(describeLink({ kind: 'wake', byMinute: 352 }, 'metric'), 'Woke up by 5:52 AM');
  assert.equal(describeLink({ kind: 'water', minLitres: LITRES_PER_GALLON }, 'imperial'), 'At least 1.00 gal of water today');
  assert.equal(describeLink({ kind: 'steps', minSteps: 10000 }, 'metric'), 'At least 10,000 steps today');
  assert.equal(formatWater(500, 'metric'), '0.5 L');
  ok('a saved link reads back in words, in the user’s unit');
}

console.log(`\nAll ${passes} health-link checks passed.`);
