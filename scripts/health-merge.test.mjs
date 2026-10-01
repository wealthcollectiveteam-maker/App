/**
 * Proofs for src/lib/healthMerge.ts — one activity, many writers.
 *
 * An Oura ring and an Apple Watch both write the same workout. Read raw,
 * that is two workouts, two suggestions, and one gym session offering to
 * complete two tasks. Overlaps must collapse to one, the longer one wins,
 * and the writer is named.
 *
 *   node --experimental-strip-types scripts/health-merge.test.mjs
 */
import assert from 'node:assert/strict';

import {
  dedupeWorkouts,
  overlaps,
  sourceLabel,
  unionMinutes,
} from '../src/lib/healthMerge.ts';

let passes = 0;
function ok(label) {
  passes += 1;
  console.log(`PASS: ${label}`);
}

const MIN = 60_000;
const T0 = Date.UTC(2026, 8, 27, 18, 0); // 18:00

// ---- the case the phase names -------------------------------------------
{
  const watch = { startMs: T0, endMs: T0 + 47 * MIN, source: 'Apple Watch', id: 'w' };
  const oura = { startMs: T0 + 2 * MIN, endMs: T0 + 44 * MIN, source: 'Oura', id: 'o' };
  const out = dedupeWorkouts([oura, watch]);
  assert.equal(out.length, 1, 'two recordings of one session are one workout');
  assert.equal(out[0].id, 'w', 'the LONGER recording is kept');
  assert.equal(out[0].source, 'Apple Watch');
  ok('Oura and Apple Watch overlapping → one workout, the longer one, source named');
}

{
  // The ring saw more of it than the watch this time. Longer still wins,
  // whoever wrote it — the rule is about the recording, not the brand.
  const watch = { startMs: T0, endMs: T0 + 30 * MIN, source: 'Apple Watch' };
  const oura = { startMs: T0 - 5 * MIN, endMs: T0 + 40 * MIN, source: 'Oura' };
  const out = dedupeWorkouts([watch, oura]);
  assert.equal(out.length, 1);
  assert.equal(out[0].source, 'Oura');
  ok('the longer recording wins regardless of which device wrote it');
}

{
  // Two real workouts an hour apart stay two. The dedupe must not eat a
  // genuine second session — the owner's day has two 45-minute workouts.
  const am = { startMs: T0 - 10 * 60 * MIN, endMs: T0 - 9 * 60 * MIN, source: 'Apple Watch' };
  const pm = { startMs: T0, endMs: T0 + 45 * MIN, source: 'Apple Watch' };
  const out = dedupeWorkouts([pm, am]);
  assert.equal(out.length, 2);
  assert.ok(out[0].startMs < out[1].startMs, 'chronological on the way out');
  ok('two separate workouts stay two, in time order');
}

{
  // Back to back is not overlapping. A run that ends at 7:00 and a lift
  // that starts at 7:00 are two workouts.
  const a = { startMs: T0, endMs: T0 + 30 * MIN, source: 'Apple Watch' };
  const b = { startMs: T0 + 30 * MIN, endMs: T0 + 60 * MIN, source: 'Apple Watch' };
  assert.equal(overlaps(a, b), false);
  assert.equal(dedupeWorkouts([a, b]).length, 2);
  ok('touching ends do not overlap');
}

{
  // Three writers, one session. Still one.
  const w = { startMs: T0, endMs: T0 + 47 * MIN, source: 'Apple Watch' };
  const o = { startMs: T0 + 1 * MIN, endMs: T0 + 46 * MIN, source: 'Oura' };
  const u = { startMs: T0 + 3 * MIN, endMs: T0 + 50 * MIN, source: 'Ultrahuman' };
  const out = dedupeWorkouts([w, o, u]);
  assert.equal(out.length, 1);
  assert.equal(out[0].source, 'Apple Watch', '47 min beats 45 and 47 — ties break on start');
  ok('three overlapping writers collapse to one');
}

{
  assert.deepEqual(dedupeWorkouts([]), []);
  const zero = { startMs: T0, endMs: T0, source: 'Apple Watch' };
  assert.deepEqual(dedupeWorkouts([zero]), [], 'a zero-length recording is not a workout');
  ok('empty in, empty out; zero-length recordings are dropped');
}

// ---- source names ---------------------------------------------------------
{
  assert.equal(sourceLabel('Aly’s Apple Watch'), 'Apple Watch');
  assert.equal(sourceLabel("Someone's Apple Watch"), 'Apple Watch');
  assert.equal(sourceLabel('iPhone'), 'iPhone');
  assert.equal(sourceLabel('Oura'), 'Oura');
  assert.equal(sourceLabel('Ultrahuman'), 'Ultrahuman');
  assert.equal(sourceLabel(''), 'Apple Health');
  assert.equal(sourceLabel(undefined), 'Apple Health');
  ok('source names are shortened to the device, never to a person');
}

// ---- union, never sum -----------------------------------------------------
{
  const H = 60;
  // 22:00–06:00 from the ring and 22:10–05:50 from the watch: eight hours,
  // not fifteen and a half.
  const ring = { startMs: T0, endMs: T0 + 8 * H * MIN };
  const watch = { startMs: T0 + 10 * MIN, endMs: T0 + 8 * H * MIN - 10 * MIN };
  assert.equal(unionMinutes([ring, watch]), 8 * H);
  // Two separate naps add.
  assert.equal(unionMinutes([{ startMs: T0, endMs: T0 + 20 * MIN }, { startMs: T0 + 60 * MIN, endMs: T0 + 90 * MIN }]), 50);
  assert.equal(unionMinutes([]), 0);
  ok('overlapping intervals are counted once; separate ones add');
}

console.log(`\nAll ${passes} health-merge checks passed.`);
