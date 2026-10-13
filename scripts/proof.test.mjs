/**
 * Proofs for src/lib/proof — the challenge as an experiment on one person.
 *
 * Fixtures only; the model never touches HealthKit. The cases the brief
 * names, each its own block: the Day 1 date and a restored run; no Health
 * data at all; a baseline of 4 days (none) against 5 (shown); Oura and a
 * Watch writing the same nights; a phone in a different zone; the 1 Nov
 * 2026 clock change; the observation and pattern rules.
 *
 *   node --experimental-strip-types scripts/proof.test.mjs
 */
import assert from 'node:assert/strict';

import {
  BASELINE_DAYS,
  HRV_LOW_QUANTILE,
  MIN_BASELINE_DAYS,
  MIN_SIDE,
  OBSERVATION_NIGHTS,
  RHR_ABOVE_BPM,
  baselineOf,
  beforeNow,
  buildDailySeries,
  buildProof,
  clock,
  dateKeysBetween,
  day1DateKey,
  dayNumberOf,
  formatDiff,
  formatMetric,
  halfwayDay,
  median,
  observations,
  patterns,
  quantile,
  report,
  rollingLoad,
  shiftDateKey,
  spread,
} from '../src/lib/proof/index.ts';

let passes = 0;
function ok(label) {
  passes += 1;
  console.log(`PASS: ${label}`);
}

const ZONE = 'America/Toronto';
const MIN = 60_000;
const H = 60 * MIN;
/** An instant from a Toronto wall clock. EDT (−4) until 1 Nov 2026 02:00, then EST (−5). */
const toronto = (y, m, d, hh, mm, off = -4) => Date.UTC(y, m - 1, d, hh - off, mm);
const key = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

const EMPTY = {
  sleep: null, rhr: null, hrv: null, rr: null,
  stepsByDate: null, energyByDate: null, workouts: null, weights: null,
  checkins: [], completions: [], snapshots: [],
};

// ---- a. the Day 1 date, and a restored run --------------------------------
{
  assert.equal(day1DateKey('2026-09-27', 1), '2026-09-27', 'Day 1 is today on Day 1');
  assert.equal(day1DateKey('2026-09-27', 12), '2026-09-16');
  assert.equal(day1DateKey('2026-10-03', 7), '2026-09-27', 'counts back across a month end');
  // A restored run. The owner missed a day, restored it, and the run
  // CONTINUES from its original Day 1: on 2026-10-28 the app says Day 32.
  // Counting back 31 days lands on the original 2026-09-27 — not on the
  // restore date, and not on a Day 1 that shifted by the missed day.
  assert.equal(day1DateKey('2026-10-28', 32), '2026-09-27');
  assert.equal(dayNumberOf('2026-09-27', '2026-09-27'), 1);
  assert.equal(dayNumberOf('2026-09-26', '2026-09-27'), 0);
  assert.equal(dayNumberOf('2026-09-13', '2026-09-27'), -13, 'the first baseline day');
  assert.equal(shiftDateKey('2026-03-01', -1), '2026-02-28');
  assert.equal(dateKeysBetween('2026-09-13', '2026-09-27').length, 15);
  ok('Day 1 = today − (day − 1) in the challenge zone, and a restored run keeps its original Day 1');
}

// ---- the series shape -----------------------------------------------------
{
  const rows = buildDailySeries({ ...EMPTY, todayKey: '2026-09-27', currentDay: 12, durationDays: 75, zone: ZONE });
  assert.equal(rows.length, BASELINE_DAYS + 12, 'fourteen baseline days plus twelve challenge days');
  assert.equal(rows[0].dateKey, '2026-09-02');
  assert.equal(rows[0].dayNumber, -13);
  assert.equal(rows[BASELINE_DAYS].dayNumber, 1);
  assert.equal(rows[rows.length - 1].dateKey, '2026-09-27');
  ok('the series runs from Day 1 − 14 to today, day numbers 0 and below for the baseline');
}

// ---- no Health data at all ------------------------------------------------
{
  const model = buildProof({ ...EMPTY, todayKey: '2026-09-27', currentDay: 12, durationDays: 75, zone: ZONE });
  for (const m of model.beforeNow) {
    assert.equal(m.baseline, null, `${m.key}: no baseline`);
    assert.equal(m.now, null);
    assert.equal(m.diff, null);
    assert.equal(m.baselineDays, 0);
  }
  assert.deepEqual(model.observations, []);
  assert.equal(model.recoveryHasBaseline, false);
  assert.deepEqual(model.patterns, []);
  assert.ok(model.load.every((p) => p.minutes === null && p.n === 0));
  assert.equal(model.halfway.empty, true);
  assert.equal(model.halfway.unlocked, false);
  assert.equal(model.halfway.unlockDay, 38);
  ok('no Health data: no baselines, no observations, no patterns, an empty report — never a zero');
}

// ---- fixture builders -----------------------------------------------------
/** One night per date, ending on the date. */
function nightSamples(dates, { bedH = 23, bedM = 0, wakeH = 6, wakeM = 30, source = 'Apple Watch', value = 1, offset = -4 } = {}) {
  return dates.map((k) => {
    const [y, m, d] = k.split('-').map(Number);
    const wake = toronto(y, m, d, wakeH, wakeM, offset);
    const bedDay = new Date(Date.UTC(y, m - 1, d) - 86_400_000);
    const bed = toronto(bedDay.getUTCFullYear(), bedDay.getUTCMonth() + 1, bedDay.getUTCDate(), bedH, bedM, offset);
    return { startMs: bed, endMs: wake, value, source };
  });
}
/** One discrete sample inside each night (at 04:00 on the date). */
function nightPoints(dates, valueFor) {
  return dates.map((k, i) => {
    const [y, m, d] = k.split('-').map(Number);
    return { value: valueFor(i, k), endMs: toronto(y, m, d, 4, 0) };
  });
}

const TODAY = '2026-09-27';
const DAY = 12;
const DAY1 = day1DateKey(TODAY, DAY); // 2026-09-16
const BASE_DATES = dateKeysBetween(shiftDateKey(DAY1, -14), shiftDateKey(DAY1, -1)); // 14 days
const CHAL_DATES = dateKeysBetween(DAY1, TODAY); // 12 days

// ---- c. baseline: 4 days is none, 5 is shown -------------------------------
{
  const four = buildDailySeries({
    ...EMPTY, todayKey: TODAY, currentDay: DAY, durationDays: 75, zone: ZONE,
    rhr: nightPoints(BASE_DATES.slice(-4), () => 52),
  });
  const b4 = baselineOf(four, 'rhr');
  assert.equal(b4.figure, null);
  assert.equal(b4.days, 4, 'the count of days it had is still reported');
  assert.equal(beforeNow(four, 'rhr').baseline, null);

  const five = buildDailySeries({
    ...EMPTY, todayKey: TODAY, currentDay: DAY, durationDays: 75, zone: ZONE,
    rhr: nightPoints(BASE_DATES.slice(-5), (i) => [50, 52, 51, 60, 53][i]),
  });
  const b5 = baselineOf(five, 'rhr');
  assert.deepEqual(b5.figure, { value: 52, n: 5 }, 'a MEDIAN — the 60 does not drag it');
  assert.equal(MIN_BASELINE_DAYS, 5);
  ok('a baseline needs at least 5 of the 14 days; 4 is "no baseline"; medians, not means');
}

// ---- d. before / now, with n on both sides and a weekly trend --------------
{
  const rows = buildDailySeries({
    ...EMPTY, todayKey: TODAY, currentDay: DAY, durationDays: 75, zone: ZONE,
    // Baseline nights 23:00 → 06:30 (7h30) on 10 of 14 days; challenge nights
    // 22:30 → 06:00 (7h30) for the first 5 days, then 22:00 → 06:00 (8h).
    sleep: [
      ...nightSamples(BASE_DATES.slice(0, 10)),
      ...nightSamples(CHAL_DATES.slice(0, 5), { bedH: 22, bedM: 30, wakeH: 6, wakeM: 0 }),
      ...nightSamples(CHAL_DATES.slice(5), { bedH: 22, bedM: 0, wakeH: 6, wakeM: 0 }),
    ],
  });
  const asleep = beforeNow(rows, 'asleepMinutes');
  assert.deepEqual(asleep.baseline, { value: 450, n: 10 });
  assert.deepEqual(asleep.now, { value: 480, n: 7 });
  assert.equal(asleep.diff, 30);
  assert.equal(asleep.weekly.length, 2, 'twelve challenge days make two (partial) weeks');
  assert.equal(asleep.weekly[0].n, 7);
  assert.equal(asleep.weekly[1].n, 5);
  assert.equal(asleep.weekly[1].value, 480);
  assert.equal(formatMetric('asleepMinutes', 450), '7h 30m');
  assert.equal(formatDiff('asleepMinutes', 30), '+30m');

  const bed = beforeNow(rows, 'bedtimeMinutes');
  assert.equal(formatMetric('bedtimeMinutes', bed.baseline.value), '11:00 PM');
  assert.equal(formatMetric('bedtimeMinutes', bed.now.value), '10:00 PM');
  assert.equal(formatDiff('bedtimeMinutes', bed.diff), '−1h', 'an hour earlier reads as −1h');
  const wake = beforeNow(rows, 'wakeMinutes');
  assert.equal(formatMetric('wakeMinutes', wake.baseline.value), '6:30 AM');
  assert.equal(clock(750), '12:30 PM');
  ok('before / now: baseline median, last-7 median, the difference, n on both sides, weekly points');
}

{
  // Weight: FIRST baseline value and LATEST value, from Health or a check-in.
  const rows = buildDailySeries({
    ...EMPTY, todayKey: TODAY, currentDay: DAY, durationDays: 75, zone: ZONE,
    weights: [
      { kg: 84.0, atMs: toronto(2026, 9, 3, 7, 0) },
      { kg: 83.6, atMs: toronto(2026, 9, 10, 7, 0) },
    ],
    checkins: [{ kg: 82.1, atMs: toronto(2026, 9, 26, 8, 0) }],
  });
  const w = beforeNow(rows, 'weightKg');
  assert.deepEqual(w.baseline, { value: 84.0, n: 2 }, 'first, not median');
  assert.deepEqual(w.now, { value: 82.1, n: 1 }, 'latest, from the user’s own check-in');
  assert.equal(formatDiff('weightKg', w.diff), '−1.9 kg');
  assert.equal(formatDiff('weightKg', w.diff, 'imperial'), '−4.2 lb');
  assert.equal(rows.find((r) => r.dateKey === '2026-09-26').weightFrom, 'checkin');
  ok('weight uses the first and latest values, from Health or the weekly check-in');
}

// ---- b. Oura and a Watch on the same nights: a union, once ----------------
{
  const rows = buildDailySeries({
    ...EMPTY, todayKey: TODAY, currentDay: DAY, durationDays: 75, zone: ZONE,
    sleep: [
      ...nightSamples(BASE_DATES, { source: 'Oura' }),
      ...nightSamples(BASE_DATES, { source: 'Apple Watch', bedM: 5, wakeM: 25, value: 3 }),
    ],
  });
  const b = baselineOf(rows, 'asleepMinutes');
  assert.deepEqual(b.figure, { value: 450, n: 14 }, '7h30 per night, not 14h50');
  assert.deepEqual(rows[0].sleepSources, ['Apple Watch', 'Oura']);
  ok('two writers on every night: the union, 7h30, never the sum');
}

// ---- workouts: Health, else completed tasks, marked "from tasks" ----------
{
  const rows = buildDailySeries({
    ...EMPTY, todayKey: TODAY, currentDay: DAY, durationDays: 75, zone: ZONE,
    workouts: [{ startISO: new Date(toronto(2026, 9, 16, 18, 0)).toISOString(), minutes: 47, source: 'Apple Watch' }],
    snapshots: CHAL_DATES.map((_, i) => ({
      day: i + 1,
      tasks: [
        { key: 'workout1', target: { value: 45, unit: 'minutes' } },
        { key: 'workout2', target: { value: 45, unit: 'minutes' } },
        { key: 'water', target: { value: 1, unit: 'gallons' } },
      ],
    })),
    completions: [
      // Day 2: both workouts done as tasks, one with a timer's real duration.
      { day: 2, taskKey: 'workout1', completedAtMs: toronto(2026, 9, 17, 7, 10), durationSeconds: 50 * 60 },
      { day: 2, taskKey: 'workout2', completedAtMs: toronto(2026, 9, 17, 19, 40), durationSeconds: null },
      { day: 2, taskKey: 'water', completedAtMs: toronto(2026, 9, 17, 21, 0), durationSeconds: null },
      // Day 1 also has a task completion, but Health already has the workout.
      { day: 1, taskKey: 'workout1', completedAtMs: toronto(2026, 9, 16, 19, 0), durationSeconds: null },
    ],
  });
  const d1 = rows.find((r) => r.dayNumber === 1);
  assert.equal(d1.workoutMinutes, 47);
  assert.equal(d1.workoutsFrom, 'health', 'Health wins when it has the workout');
  assert.equal(d1.lastWorkoutEndMinutes, 18 * 60 + 47);
  const d2 = rows.find((r) => r.dayNumber === 2);
  assert.equal(d2.workoutMinutes, 95, '50 from the timer + 45 from the target');
  assert.equal(d2.workoutsFrom, 'tasks');
  assert.equal(d2.lastTaskDoneMinutes, 21 * 60, 'the day’s last completion, 9:00 PM');
  assert.equal(d2.waterDone, true);
  assert.equal(d2.tasksDone, 3);
  const d3 = rows.find((r) => r.dayNumber === 3);
  assert.equal(d3.workoutMinutes, 0, 'nothing in Health, nothing done: a rest day, zero from a query that ran');
  assert.equal(d3.waterDone, false);
  assert.equal(rows[0].waterDone, null, 'baseline days have no tasks');
  const load = rollingLoad(rows);
  assert.equal(load[1].minutes, 47 + 95);
  assert.equal(load[1].n, 7, 'seven days had a value: five baseline zeros, then 47 and 95');
  ok('a day with no Health workout takes the completed workout tasks; the timer’s duration when it has one');
}

// ---- e. observations: 3 nights in a row, against the OWN baseline ---------
{
  const base = (rhr) => ({
    ...EMPTY, todayKey: TODAY, currentDay: DAY, durationDays: 75, zone: ZONE,
    rhr: [...nightPoints(BASE_DATES, () => 52), ...nightPoints(CHAL_DATES, (i) => rhr[i])],
  });
  // Last three nights ≥ 57 (52 + 5): observed, and counted.
  const three = observations(buildDailySeries(base([52, 52, 52, 52, 52, 52, 52, 52, 52, 57, 58, 57])));
  assert.equal(three.length, 1);
  assert.equal(three[0].kind, 'rhr-above');
  assert.equal(three[0].nights, 3);
  assert.equal(three[0].text, 'Your resting heart rate has been above your pre-challenge normal for 3 nights in a row.');
  // Two nights: nothing.
  assert.deepEqual(observations(buildDailySeries(base([52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 58, 57]))), []);
  // Three high, then last night back to normal: nothing — the run is the TRAILING run.
  assert.deepEqual(observations(buildDailySeries(base([52, 52, 52, 52, 52, 52, 52, 52, 58, 58, 58, 52]))), []);
  // 4 bpm above is not 5.
  assert.deepEqual(observations(buildDailySeries(base([52, 52, 52, 52, 52, 52, 52, 52, 52, 56, 56, 56]))), []);
  // A missing night breaks the run.
  const gap = buildDailySeries({
    ...EMPTY, todayKey: TODAY, currentDay: DAY, durationDays: 75, zone: ZONE,
    rhr: [
      ...nightPoints(BASE_DATES, () => 52),
      ...nightPoints([CHAL_DATES[9], CHAL_DATES[11]], () => 58),
    ],
  });
  assert.deepEqual(observations(gap), [], 'two high nights around a missing one are not three in a row');
  // No baseline: never an observation, however high.
  const noBase = buildDailySeries({
    ...EMPTY, todayKey: TODAY, currentDay: DAY, durationDays: 75, zone: ZONE,
    rhr: nightPoints(CHAL_DATES, () => 80),
  });
  assert.deepEqual(observations(noBase), []);
  assert.equal(RHR_ABOVE_BPM, 5);
  assert.equal(OBSERVATION_NIGHTS, 3);
  ok('RHR observation: ≥ 5 bpm above the baseline median for 3 consecutive nights; never without a baseline');
}

{
  // HRV: below the baseline's 10th percentile for 3 nights.
  const baseHrv = [40, 42, 44, 45, 46, 47, 48, 50, 52, 55]; // p10 ≈ 41.8
  const p10 = quantile(baseHrv, HRV_LOW_QUANTILE);
  assert.ok(p10 > 41 && p10 < 42.5);
  const rows = buildDailySeries({
    ...EMPTY, todayKey: TODAY, currentDay: DAY, durationDays: 75, zone: ZONE,
    hrv: [...nightPoints(BASE_DATES.slice(0, 10), (i) => baseHrv[i]), ...nightPoints(CHAL_DATES, (i) => (i >= 9 ? 38 : 47))],
  });
  const obs = observations(rows);
  assert.equal(obs.length, 1);
  assert.equal(obs[0].kind, 'hrv-below');
  assert.equal(obs[0].text, 'Your HRV has been below the range it held before the challenge for 3 nights in a row.');
  ok('HRV observation: below the baseline’s 10th percentile for 3 consecutive nights');
}

// ---- f. patterns ------------------------------------------------------------
{
  // 7h+ vs under 7h → when the list was finished. Long-sleep days finish at
  // 7 PM, short-sleep days at 8:40 PM: 1h 40m earlier.
  const sleep = [];
  const completions = [];
  CHAL_DATES.forEach((k, i) => {
    const long = i % 2 === 0; // 6 long, 6 short
    sleep.push(...nightSamples([k], { bedH: 23, bedM: 0, wakeH: long ? 6 : 5, wakeM: long ? 30 : 30 })); // 7h30 vs 6h30
    const [y, m, d] = k.split('-').map(Number);
    const finish = long ? toronto(y, m, d, 19, 0) : toronto(y, m, d, 20, 40);
    completions.push({ day: i + 1, taskKey: 'read', completedAtMs: finish - 3 * H, durationSeconds: null });
    completions.push({ day: i + 1, taskKey: 'water', completedAtMs: finish, durationSeconds: null });
  });
  const rows = buildDailySeries({
    ...EMPTY, todayKey: TODAY, currentDay: DAY, durationDays: 75, zone: ZONE, sleep, completions,
    snapshots: CHAL_DATES.map((_, i) => ({ day: i + 1, tasks: [{ key: 'read', target: null }, { key: 'water', target: null }] })),
  });
  const ps = patterns(rows);
  const finish = ps.find((p) => p.key === 'sleep-finish');
  assert.ok(finish, 'the pair qualifies: 6 days vs 6 days');
  assert.equal(finish.diff, -100);
  assert.equal(finish.text, 'After 7h+ of sleep you finished your list 1h 40m earlier (6 days vs 6 days).');
  assert.ok(!ps.find((p) => p.key === 'water-sleep'), 'water done every day: no "not done" side, so no pair');
  ok('sleep → finish time: median difference, n on each side, the exact sentence; a side that never varies is not shown');
}

{
  // Each side needs 5 days: 4 vs 8 is not shown; 5 vs 7 is.
  const mk = (nLong) => {
    const sleep = [];
    const completions = [];
    CHAL_DATES.forEach((k, i) => {
      const long = i < nLong;
      sleep.push(...nightSamples([k], { wakeH: long ? 6 : 5 }));
      const [y, m, d] = k.split('-').map(Number);
      completions.push({ day: i + 1, taskKey: 'read', completedAtMs: toronto(y, m, d, long ? 19 : 21, i % 3), durationSeconds: null });
    });
    return patterns(buildDailySeries({ ...EMPTY, todayKey: TODAY, currentDay: DAY, durationDays: 75, zone: ZONE, sleep, completions }));
  };
  assert.ok(!mk(4).find((p) => p.key === 'sleep-finish'), '4 vs 8: not shown');
  assert.ok(mk(5).find((p) => p.key === 'sleep-finish'), '5 vs 7: shown');
  assert.equal(MIN_SIDE, 5);
  ok('each side of a pair needs at least 5 days');
}

{
  // Late workout → that NIGHT's sleep (the night ending the next date), and
  // early bedtime → HRV. Ranked by difference relative to spread, top 3.
  const sleep = [];
  const workouts = [];
  const hrv = [];
  CHAL_DATES.forEach((k, i) => {
    const [y, m, d] = k.split('-').map(Number);
    const late = i % 2 === 0;
    // The workout on date k; the night that follows ends on k+1.
    workouts.push({ startISO: new Date(toronto(y, m, d, late ? 19 : 12, 30)).toISOString(), minutes: 45, source: 'Apple Watch' });
    const next = shiftDateKey(k, 1);
    sleep.push(...nightSamples([next], { bedH: late ? 23 : 22, bedM: 30, wakeH: 6, wakeM: 0 })); // 6h30 vs 7h30
    const [ny, nm, nd] = next.split('-').map(Number);
    hrv.push({ value: late ? 40 : 50, endMs: toronto(ny, nm, nd, 4, 0) });
  });
  const rows = buildDailySeries({ ...EMPTY, todayKey: shiftDateKey(TODAY, 1), currentDay: DAY + 1, durationDays: 75, zone: ZONE, sleep, workouts, hrv });
  const ps = patterns(rows);
  const lw = ps.find((p) => p.key === 'late-workout-sleep');
  assert.ok(lw);
  assert.equal(lw.diff, -60);
  assert.equal(lw.text, 'After a workout that ended past 7 PM you slept 1h less that night (6 days vs 6 days).');
  const eb = ps.find((p) => p.key === 'early-bed-hrv');
  assert.ok(eb);
  assert.equal(eb.diff, 10);
  assert.match(eb.text, /^After a bedtime before 11 PM your HRV was 10 ms higher \(6 nights vs 6 nights\)\.$/);
  assert.ok(ps.length <= 3);
  assert.ok(ps[0].score >= ps[ps.length - 1].score, 'ranked by |diff| / spread');
  ok('late workout → that night’s sleep; bedtime → HRV; at most three, ranked');
}

// ---- a phone in a different zone --------------------------------------------
{
  // Same instants, two zones. The challenge is Toronto's; a phone in Los
  // Angeles reading the same Health samples must produce the same rows.
  const sleep = nightSamples(CHAL_DATES);
  const completions = CHAL_DATES.map((k, i) => {
    const [y, m, d] = k.split('-').map(Number);
    return { day: i + 1, taskKey: 'read', completedAtMs: toronto(y, m, d, 22, 30), durationSeconds: null };
  });
  const input = { ...EMPTY, todayKey: TODAY, currentDay: DAY, durationDays: 75, zone: ZONE, sleep, completions };
  const rows = buildDailySeries(input);
  const last = rows[rows.length - 1];
  assert.equal(last.wakeMinutes, 6 * 60 + 30, 'woke 6:30 Toronto');
  assert.equal(last.lastTaskDoneMinutes, 22 * 60 + 30, 'finished 10:30 PM Toronto');
  // The zone is an INPUT, from the challenge, not read off the device; the
  // same fixture under LA time would put 22:30 Toronto at 19:30 — and would
  // move a 01:00 completion onto the previous date. Passing the challenge
  // zone is what keeps the rows the challenge's.
  const la = buildDailySeries({ ...input, zone: 'America/Los_Angeles' });
  assert.equal(la[la.length - 1].lastTaskDoneMinutes, 19 * 60 + 30);
  ok('the zone is the challenge’s, passed in; the device clock never enters');
}

// ---- the clock change, Sun 1 Nov 2026 -------------------------------------
{
  // Day 1 = 20 Oct, today = 2 Nov (Day 14). The night of 31 Oct → 1 Nov is
  // 22:00 EDT → 06:00 EST: nine real hours. A workout ending 19:30 EDT on
  // 31 Oct is "past 7 PM"; a completion at 06:30 EST on 1 Nov is 6:30 AM.
  const today = '2026-11-02';
  const day1 = day1DateKey(today, 14);
  assert.equal(day1, '2026-10-20');
  const sleep = [{ startMs: toronto(2026, 10, 31, 22, 0, -4), endMs: toronto(2026, 11, 1, 6, 0, -5), value: 1, source: 'Oura' }];
  const workouts = [{ startISO: new Date(toronto(2026, 10, 31, 18, 45, -4)).toISOString(), minutes: 45, source: 'Apple Watch' }];
  const completions = [{ day: 13, taskKey: 'read', completedAtMs: toronto(2026, 11, 1, 6, 30, -5), durationSeconds: null }];
  const rows = buildDailySeries({ ...EMPTY, todayKey: today, currentDay: 14, durationDays: 75, zone: ZONE, sleep, workouts, completions });
  const nov1 = rows.find((r) => r.dateKey === '2026-11-01');
  assert.equal(nov1.dayNumber, 13);
  assert.equal(nov1.asleepMinutes, 9 * 60, 'the extra hour is slept and counted');
  assert.equal(nov1.wakeMinutes, 6 * 60, 'up at 6:00 on the new clock');
  assert.equal(nov1.bedtimeMinutes, 10 * 60, 'bed at 22:00 = 600 minutes after noon');
  assert.equal(nov1.lastTaskDoneMinutes, 6 * 60 + 30);
  const oct31 = rows.find((r) => r.dateKey === '2026-10-31');
  assert.equal(oct31.lastWorkoutEndMinutes, 19 * 60 + 30, 'ended 7:30 PM EDT — past 7 PM');
  ok('1 Nov 2026: the nine-hour night, the 6:00 wake and the 7:30 PM workout all read on the right clock');
}

// ---- reports ----------------------------------------------------------------
{
  assert.equal(halfwayDay(75), 38, 'the HALFWAY badge day');
  assert.equal(halfwayDay(30), 15);
  // A Day 38 run: Day 1 is 21 Aug, the baseline 7–20 Aug. Nights on every
  // baseline day and on the last 30 of the 38 challenge days.
  const day1_38 = day1DateKey(TODAY, 38);
  const base38 = dateKeysBetween(shiftDateKey(day1_38, -14), shiftDateKey(day1_38, -1));
  const chal38 = dateKeysBetween(day1_38, TODAY);
  const sleep = [...nightSamples(base38), ...nightSamples(chal38.slice(-30), { bedH: 22, bedM: 30 })];
  const rows37 = buildDailySeries({ ...EMPTY, todayKey: TODAY, currentDay: 37, durationDays: 75, zone: ZONE, sleep });
  const locked = report('halfway', rows37, 37, 75);
  assert.equal(locked.unlocked, false);
  assert.equal(locked.unlockDay, 38);
  const rows38 = buildDailySeries({ ...EMPTY, todayKey: TODAY, currentDay: 38, durationDays: 75, zone: ZONE, sleep, workouts: [] });
  const open = report('halfway', rows38, 38, 75);
  assert.equal(open.unlocked, true);
  assert.equal(open.nightsLogged, 30, 'only the challenge nights that had data');
  assert.equal(open.beforeNow.map((m) => m.key).includes('asleepMinutes'), true);
  assert.ok(open.withoutBaseline.includes('Steps'), 'metrics without a baseline are named, not rowed');
  assert.equal(clock(open.medianBedtimeMinutes + 12 * 60), '10:30 PM');
  assert.equal(open.totalWorkoutMinutes, 0, 'a workout query that ran and found none is zero, and shown');
  assert.equal(open.empty, false);
  assert.equal(report('final', rows38, 38, 75).unlocked, false);
  assert.equal(report('final', rows38, 75, 75).unlocked, true);
  ok('halfway unlocks on Day 38 and the final report on Day 75; only what exists is in them');
}

// ---- stats ------------------------------------------------------------------
{
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
  assert.equal(quantile([1, 2, 3, 4, 5], 0.5), 3);
  assert.equal(quantile([10, 20], 0.1), 11);
  assert.equal(spread([5, 5, 5, 5]), 0, 'nothing varies');
  assert.ok(spread([1, 2, 3, 4, 100]) > 0);
  ok('medians, quantiles and spread behave');
}

console.log(`\nAll ${passes} proof checks passed.`);
