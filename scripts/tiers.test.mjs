// Guard for the tier defaults (constants/tiers.ts).
//
// Two things are worth a test rather than a screenshot:
//
//   1. HARD'S TASK SET IS UNCHANGED. The whole safety argument for shipping
//      new tier defaults to a live challenge is that Hard still carries the
//      same six keys at the same targets, so nothing is gained or lost at
//      the next rollover. (One LABEL moved — "Workout 2 — outdoors" now
//      reads "Workout 2 — 45 min", with "outdoors" carried by the
//      descriptor — which is wording, not a change to the task.) If the
//      keys or the targets ever move, this test is what says so first.
//
//   2. The label is DERIVED, and the derivation is unit-aware. taskLabel()
//      is called twice from different places — once locally from the tier
//      config, once from the server's frozen snapshot — and the two must
//      produce the identical string or the same task reads differently on
//      two screens.
//
// Run: npm run test:tiers
import {
  TIER_TASKS,
  TIERS,
  buildTierTask,
  hasPendingChanges,
  pendingChangeLine,
  taskLabel,
  tierStandardTarget,
} from '../src/constants/tiers.ts';

let failures = 0;
function expect(name, actual, expected) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  const ok = a === b;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` — expected ${b}, got ${a}`}`);
  if (!ok) failures++;
}

const shape = (tier) =>
  TIER_TASKS[tier].map((t) => [t.key, t.label, t.target?.value ?? null, t.target?.unit ?? null]);

// ---- 1. Hard is exactly what it was ----------------------------------------
expect('hard: the same six keys at the same targets as before this change', shape('hard'), [
  ['workout1', 'Workout 1 — 45 min', 45, 'minutes'],
  ['workout2', 'Workout 2 — 45 min', 45, 'minutes'],
  ['water', 'Gallon of water', 1, 'gallons'],
  ['read', 'Read 10 pages', 10, 'pages'],
  ['diet', 'Follow the diet', null, null],
  ['photo', 'Progress photo', null, null],
]);

// ---- 2. Medium and Soft differ in substance --------------------------------
expect('medium: five tasks, second movement task, litres, no photo', shape('medium'), [
  ['workout1', 'Workout — 45 min', 45, 'minutes'],
  ['workout2', 'Move again — 30 min', 30, 'minutes'],
  ['water', '3 litres of water', 3, 'litres'],
  ['read', 'Read 10 pages', 10, 'pages'],
  ['diet', 'Follow the diet', null, null],
]);

expect('soft: four tasks, litres, "Eat well"', shape('soft'), [
  ['workout1', 'Workout — 45 min', 45, 'minutes'],
  ['water', '3 litres of water', 3, 'litres'],
  ['read', 'Read 10 pages', 10, 'pages'],
  ['diet', 'Eat well', null, null],
]);

// ---- 3. The descriptor is what distinguishes the same key across tiers -----
const sub = (tier, key) => TIERS[tier].tasks.find((t) => t.key === key).sub;
expect('diet descriptor differs hard/medium', sub('hard', 'diet') !== sub('medium', 'diet'), true);
expect('diet descriptor differs medium/soft', sub('medium', 'diet') !== sub('soft', 'diet'), true);
expect('every tier task carries a descriptor',
  Object.keys(TIERS).every((t) => TIERS[t].tasks.every((x) => x.sub.length > 0)), true);

// ---- 4. Snapshot and local build render the SAME label ---------------------
// The server stores tier_standards.short_name + a resolved target; the app
// builds from the tier config. Both go through taskLabel().
for (const tier of Object.keys(TIERS)) {
  for (const t of TIERS[tier].tasks) {
    const local = buildTierTask(tier, t.key);
    const fromSnapshot = taskLabel(t.key, t.name, local.target ?? null);
    expect(`${tier}/${t.key}: snapshot label matches local label`, fromSnapshot, local.label);
  }
}

// ---- 5. Overrides keep the TIER's unit, only the value moves ---------------
expect('medium water raised to 4 stays litres', buildTierTask('medium', 'water', 4).label,
  '4 litres of water');
expect('hard water raised to 2 stays gallons', buildTierTask('hard', 'water', 2).label,
  '2 gallons of water');
expect('medium water standard is litres', tierStandardTarget('medium', 'water'),
  { value: 3, unit: 'litres' });

// ---- 6. Timed tasks still expose a timer ----------------------------------
expect('medium "Move again" is a 30-minute timer', buildTierTask('medium', 'workout2').timerMinutes, 30);
expect('read offers a user-set timer in every tier',
  Object.keys(TIERS).every((t) => buildTierTask(t, 'read').timerUserSet === true), true);

// ---- 7. The pending-change sentence ----------------------------------------
const none = {
  addedTomorrow: [], removedTomorrow: [], pendingTier: null,
  targetChanges: [], todayCount: 6, tomorrowCount: 6,
};
expect('no pending change: no predicate, no line', [hasPendingChanges(none), pendingChangeLine(none, 'hard')],
  [false, null]);

expect('hard → medium says both what starts and what is still true today',
  pendingChangeLine({ ...none, pendingTier: 'medium', tomorrowCount: 5 }, 'hard'),
  'Medium starts tomorrow — 5 tasks. Today is still Hard, 6.');

expect('a target edit names today’s value too',
  pendingChangeLine({
    ...none,
    targetChanges: [{ taskKey: 'read', name: 'Read', fromValue: 10, toValue: 15, unit: 'pages' }],
  }, 'hard'),
  'Read → 15 pages tomorrow (today: 10 pages).');

expect('an added task reports the new count',
  pendingChangeLine({ ...none, addedTomorrow: [{ id: 'x' }], tomorrowCount: 7 }, 'hard'),
  'Tomorrow: 7 tasks. Today is still 6.');

// An add and a removal on the same day cancel out in the COUNT but still
// change which tasks tomorrow holds — silence there would be a lie.
expect('add + remove with an unchanged count still says something',
  pendingChangeLine({
    ...none, addedTomorrow: [{ id: 'a' }], removedTomorrow: [{ id: 'b' }],
  }, 'hard'),
  'Your task list changes tomorrow — still 6 tasks.');

console.log(failures === 0 ? '\nAll tier guards passed.' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
