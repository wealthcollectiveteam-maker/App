/**
 * Proofs for src/lib/sleepNight.ts — what counts as last night and woke up.
 *
 * The brief's list, each as its own block: a night crossing midnight; Oura
 * and a Watch overlapping (must NOT double); an afternoon nap; no data; a
 * phone in a different zone from the challenge; and the US clock change on
 * Sunday 1 November 2026, when the night is an hour longer in real time.
 *
 *   node --experimental-strip-types scripts/health-sleep.test.mjs
 */
import assert from 'node:assert/strict';

import {
  SESSION_GAP_MS,
  asleepStage,
  dateKeyIn,
  formatHoursMinutes,
  sleepNightFor,
  wakeMinuteOfDay,
} from '../src/lib/sleepNight.ts';

let passes = 0;
function ok(label) {
  passes += 1;
  console.log(`PASS: ${label}`);
}

const ZONE = 'America/Toronto';
const MIN = 60_000;
const H = 60 * MIN;

/** An instant from a wall-clock time in ZONE (EDT until 1 Nov 2026 02:00). */
function toronto(y, m, d, hh, mm, offsetHours = -4) {
  return Date.UTC(y, m - 1, d, hh - offsetHours, mm);
}

// Stage values, from the library's CategoryValueSleepAnalysis.
const IN_BED = 0, ASLEEP = 1, AWAKE = 2, CORE = 3, DEEP = 4, REM = 5;

const sample = (startMs, endMs, value, source) => ({ startMs, endMs, value, source });

// ---- a night crossing midnight -------------------------------------------
{
  // Bed 22:40 Fri 25 Sep, up 06:10 Sat 26 Sep. One source, one stage.
  const start = toronto(2026, 9, 25, 22, 40);
  const end = toronto(2026, 9, 26, 6, 10);
  const night = sleepNightFor([sample(start, end, ASLEEP, 'Apple Watch')], '2026-09-26', ZONE);
  assert.ok(night, 'the night is found under the date it ENDED on');
  assert.equal(night.asleepMinutes, 7 * 60 + 30);
  assert.equal(night.bedtimeMs, start);
  assert.equal(night.wakeMs, end);
  assert.deepEqual(night.sources, ['Apple Watch']);
  assert.equal(sleepNightFor([sample(start, end, ASLEEP, 'Apple Watch')], '2026-09-25', ZONE), null,
    'it is NOT the night of the date it started on');
  ok('a night crossing midnight belongs to the morning it ended on');
}

// ---- Oura and Apple Watch overlapping: union, never sum -------------------
{
  const s = toronto(2026, 9, 25, 23, 0);
  const e = toronto(2026, 9, 26, 6, 30);
  const samples = [
    // The watch, in stages, with a short awake gap.
    sample(s, s + 3 * H, CORE, 'Apple Watch'),
    sample(s + 3 * H, s + 3 * H + 20 * MIN, AWAKE, 'Apple Watch'),
    sample(s + 3 * H + 20 * MIN, s + 5 * H, DEEP, 'Apple Watch'),
    sample(s + 5 * H, e, REM, 'Apple Watch'),
    // The ring, one unspecified block a few minutes different at each end.
    sample(s + 5 * MIN, e - 5 * MIN, ASLEEP, 'Oura'),
    // And an in-bed record that must not count as sleep.
    sample(s - 30 * MIN, e + 15 * MIN, IN_BED, 'Oura'),
  ];
  const night = sleepNightFor(samples, '2026-09-26', ZONE);
  assert.ok(night);
  // Union: 23:00–06:30 is 7h30, and the ring covers the watch's 20-min gap.
  assert.equal(night.asleepMinutes, 7 * 60 + 30, 'union of both, not 7h10 + 7h20');
  assert.deepEqual(night.sources, ['Apple Watch', 'Oura']);
  assert.deepEqual(night.perSource, [
    { source: 'Apple Watch', asleepMinutes: 7 * 60 + 10 },
    { source: 'Oura', asleepMinutes: 7 * 60 + 20 },
  ]);
  assert.equal(night.bedtimeMs, s, 'bedtime is the first asleep interval, not in-bed');
  assert.equal(night.wakeMs, e, 'wake is the last asleep interval');
  assert.deepEqual(night.stages, { core: 180, deep: 100, rem: 150 }, 'stages from the watch alone');
  ok('Oura and Apple Watch on the same night: a union of 7h30, per-source totals visible, stages from one source');
}

// ---- an afternoon nap -----------------------------------------------------
{
  const night = [sample(toronto(2026, 9, 25, 23, 0), toronto(2026, 9, 26, 6, 0), ASLEEP, 'Oura')];
  const nap = [sample(toronto(2026, 9, 26, 14, 0), toronto(2026, 9, 26, 14, 40), ASLEEP, 'Oura')];
  const both = sleepNightFor([...night, ...nap], '2026-09-26', ZONE);
  assert.equal(both.asleepMinutes, 7 * 60, 'the nap does not join the night');
  assert.equal(both.wakeMs, toronto(2026, 9, 26, 6, 0), 'wake time is the night’s, not the nap’s');
  assert.equal(both.napMinutes, 40, 'the nap is reported separately');
  // A day with ONLY a nap has no main sleep worth calling a night... but it
  // is the longest session ending that date, so it is what there is. The
  // rules decide whether 40 minutes meets "at least 6 h" — this file does
  // not grade.
  const onlyNap = sleepNightFor(nap, '2026-09-26', ZONE);
  assert.equal(onlyNap.asleepMinutes, 40);
  ok('an afternoon nap is a separate session and never counts toward the night');
}

// ---- no data --------------------------------------------------------------
{
  assert.equal(sleepNightFor([], '2026-09-26', ZONE), null);
  assert.equal(
    sleepNightFor([sample(toronto(2026, 9, 25, 23, 0), toronto(2026, 9, 26, 6, 0), IN_BED, 'Oura')], '2026-09-26', ZONE),
    null,
    'in-bed alone is not sleep',
  );
  assert.equal(
    sleepNightFor([sample(toronto(2026, 9, 25, 23, 0), toronto(2026, 9, 26, 6, 0), ASLEEP, 'Oura')], '2026-09-27', ZONE),
    null,
    'a night that ended yesterday is not last night',
  );
  ok('no data, in-bed only, or the wrong date → null, never a zero night');
}

// ---- a phone in a different zone from the challenge -----------------------
{
  // Challenge in Toronto; the phone is in Los Angeles. Bed 23:30 Toronto,
  // up 07:00 Toronto (04:00 in LA). In the CHALLENGE zone that is the 26th.
  const start = toronto(2026, 9, 25, 23, 30);
  const end = toronto(2026, 9, 26, 7, 0);
  const s = [sample(start, end, ASLEEP, 'Apple Watch')];
  assert.ok(sleepNightFor(s, '2026-09-26', 'America/Toronto'));
  // Read in the phone's zone the same instants would ALSO be the 26th, so
  // pick a wake that differs: up at 01:30 Toronto = 22:30 LA on the 25th.
  const lateStart = toronto(2026, 9, 25, 17, 0);
  const lateEnd = toronto(2026, 9, 26, 1, 30);
  const s2 = [sample(lateStart, lateEnd, ASLEEP, 'Apple Watch')];
  assert.ok(sleepNightFor(s2, '2026-09-26', 'America/Toronto'), 'ends on the 26th in Toronto');
  assert.equal(sleepNightFor(s2, '2026-09-26', 'America/Los_Angeles'), null, 'but on the 25th in LA');
  assert.equal(dateKeyIn(lateEnd, 'America/Toronto'), '2026-09-26');
  assert.equal(dateKeyIn(lateEnd, 'America/Los_Angeles'), '2026-09-25');
  // And the wake clock reads in the challenge zone.
  assert.equal(wakeMinuteOfDay(end, 'America/Toronto'), 7 * 60);
  assert.equal(wakeMinuteOfDay(end, 'America/Los_Angeles'), 4 * 60);
  ok('the challenge zone decides the date and the wake clock, not the phone’s');
}

// ---- the US clock change, Sunday 1 November 2026 --------------------------
{
  // Bed 22:00 EDT Sat 31 Oct; clocks fall back 02:00 → 01:00; up 06:00 EST
  // Sun 1 Nov. Nine real hours of sleep, eight on a wall clock.
  const start = toronto(2026, 10, 31, 22, 0, -4);
  const end = toronto(2026, 11, 1, 6, 0, -5);
  assert.equal(end - start, 9 * H, 'the test fixture itself spans nine real hours');
  const night = sleepNightFor([sample(start, end, ASLEEP, 'Oura')], '2026-11-01', ZONE);
  assert.ok(night);
  assert.equal(night.asleepMinutes, 9 * 60, 'the extra hour is slept, and counted');
  assert.equal(wakeMinuteOfDay(end, ZONE), 6 * 60, 'up at 06:00 on the new clock');
  assert.equal(dateKeyIn(end, ZONE), '2026-11-01');
  ok('the night of the clock change is nine hours, woke at 06:00 EST');
}

// ---- sessions and stages ---------------------------------------------------
{
  // A 40-minute awake gap at 3am is inside the night; a 3-hour gap is not.
  const s = toronto(2026, 9, 25, 23, 0);
  const inside = sleepNightFor([
    sample(s, s + 4 * H, ASLEEP, 'Oura'),
    sample(s + 4 * H + 40 * MIN, s + 7 * H, ASLEEP, 'Oura'),
  ], '2026-09-26', ZONE);
  assert.equal(inside.asleepMinutes, 7 * 60 - 40);
  assert.equal(inside.wakeMs, s + 7 * H);
  assert.ok(SESSION_GAP_MS > 40 * MIN && SESSION_GAP_MS < 3 * H);
  ok('a short awakening stays inside the night; the session gap is between 40 min and 3 h');

  assert.equal(asleepStage(CORE), 'core');
  assert.equal(asleepStage(DEEP), 'deep');
  assert.equal(asleepStage(REM), 'rem');
  assert.equal(asleepStage(ASLEEP), 'unspecified');
  assert.equal(asleepStage(IN_BED), null);
  assert.equal(asleepStage(AWAKE), null);
  assert.equal(asleepStage('3'), null, 'a string is not a stage — the enum is numeric');
  ok('only the four asleep values are sleep');

  assert.equal(formatHoursMinutes(432), '7h 12m');
  assert.equal(formatHoursMinutes(420), '7h');
  assert.equal(formatHoursMinutes(40), '40m');
  ok('durations read as hours and minutes');
}

console.log(`\nAll ${passes} sleep-night checks passed.`);
