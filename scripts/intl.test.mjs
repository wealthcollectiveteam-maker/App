/**
 * Proofs for THE ONE DOOR TO `Intl` (Phase 38I, I1).
 *
 * The native build runs on Hermes. Whether Hermes on iOS ships the `Intl`
 * the day-boundary timer and the date labels lean on is unknown until the
 * app runs on a phone. So every capability is asked for through
 * src/lib/intl.ts, each with a pure fallback, and this file proves the
 * fallback path by handing the module an `Intl` that is ABSENT, and one that
 * refuses named zones — the two ways a Hermes without ICU data would fail.
 *
 * PROOF (f): `--old` runs the assertions against the old shape, transcribed:
 * `new Intl.DateTimeFormat(...).formatToParts(...)` called directly, which
 * THROWS when Intl is absent. Against it the no-Intl cases fail; the
 * with-Intl cases are guards and pass before and after.
 *
 *   npm run test:intl
 *   npm run test:intl -- --old
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  formatCalendar as fixedCalendar,
  formatClock as fixedClock,
  formatInteger as fixedInteger,
  probeIntl,
  wallClockIn as fixedWallClock,
  zoneIsUsable as fixedZoneUsable,
} from '../src/lib/intl.ts';

// ---- the OLD shape, transcribed from writeDay.ts / dayLabel.ts / labels ----
function oldWallClock(at, zone, intl) {
  const parts = new intl.DateTimeFormat('en-US', {
    timeZone: zone, hour12: false, year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(new Date(at));
  const get = (t) => Number(parts.find((p) => p.type === t)?.value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') % 24, minute: get('minute'), second: get('second') };
}
function oldZoneUsable(zone, intl) {
  try { new intl.DateTimeFormat('en-US', { timeZone: zone }); return true; } catch { return false; }
}
function oldClock(at, intl) {
  return new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
function oldCalendar(d, options, intl) {
  return new intl.DateTimeFormat(undefined, options).format(d);
}
function oldInteger(n) {
  return n.toLocaleString();
}

const USE_OLD = process.argv.includes('--old');
const wallClockIn = USE_OLD ? oldWallClock : fixedWallClock;
const zoneIsUsable = USE_OLD ? oldZoneUsable : fixedZoneUsable;
const formatClock = USE_OLD ? oldClock : fixedClock;
const formatCalendar = USE_OLD ? oldCalendar : fixedCalendar;
const formatInteger = USE_OLD ? oldInteger : fixedInteger;
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

// The two Hermes shapes. NONE: no Intl object at all. NO_ZONES: DateTimeFormat
// exists but throws on any named timeZone (no ICU zone data).
const NONE = null; // `null` is the module's spelling of "there is no Intl"; undefined would mean the real one
const NO_ZONES = {
  DateTimeFormat: class {
    constructor(locale, opts) {
      if (opts && opts.timeZone && opts.timeZone !== 'UTC') {
        throw new RangeError(`Invalid time zone specified: ${opts.timeZone}`);
      }
      this.real = new Intl.DateTimeFormat(locale, opts);
    }
    format(d) { return this.real.format(d); }
    formatToParts(d) { return this.real.formatToParts(d); }
  },
  NumberFormat: Intl.NumberFormat,
};

const AT = Date.UTC(2026, 8, 24, 23, 30, 0); // 2026-09-24 23:30Z = 19:30 New York

// ---- the capability probe ------------------------------------------------------
check('the probe reports a full Intl as full', () => {
  const c = probeIntl(Intl, 'America/New_York');
  assert.equal(c.dateTimeFormat, true);
  assert.equal(c.formatToParts, true);
  assert.equal(c.namedTimeZone, true);
  assert.equal(c.numberFormat, true);
  assert.match(c.sample, /\d/);
});
check('the probe reports an absent Intl as absent, without throwing', () => {
  const c = probeIntl(NONE);
  assert.deepEqual(
    [c.dateTimeFormat, c.formatToParts, c.namedTimeZone, c.numberFormat],
    [false, false, false, false],
  );
  assert.match(c.sample, /absent/);
});
check('the probe tells "no zone data" apart from "no Intl"', () => {
  const c = probeIntl(NO_ZONES, 'America/New_York');
  assert.equal(c.dateTimeFormat, true);
  assert.equal(c.namedTimeZone, false, 'a zone it rejected was reported usable');
  assert.match(c.sample, /error/);
});

// ---- the wall clock: the day-boundary timer's input ----------------------------
check('with Intl, the wall clock in New York is 19:30 on the 24th (guard)', () => {
  const w = wallClockIn(AT, 'America/New_York', Intl);
  assert.deepEqual([w.year, w.month, w.day, w.hour, w.minute], [2026, 9, 24, 19, 30]);
});
check('WITHOUT Intl, the wall clock still answers — the device clock, not a throw', () => {
  const w = wallClockIn(AT, 'America/New_York', NONE);
  const d = new Date(AT);
  assert.deepEqual(
    [w.year, w.month, w.day, w.hour, w.minute],
    [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()],
  );
});
check('with Intl but no zone data, the wall clock falls back instead of throwing', () => {
  const w = wallClockIn(AT, 'America/New_York', NO_ZONES);
  assert.ok(Number.isFinite(w.hour), 'no hour');
});
check('zoneIsUsable is false without zone data, so callers use the device zone', () => {
  assert.equal(zoneIsUsable('America/New_York', Intl), true);
  assert.equal(zoneIsUsable('America/New_York', NO_ZONES), false);
  assert.equal(zoneIsUsable('America/New_York', NONE), false);
  assert.equal(zoneIsUsable('Not/AZone', Intl), false);
});

// ---- the labels ------------------------------------------------------------------
check('the clock label without Intl reads like the one with it: "7:45 PM"', () => {
  const d = new Date(2026, 8, 24, 19, 45);
  assert.equal(formatClock(d, NONE), '7:45 PM');
  const m = new Date(2026, 8, 24, 0, 5);
  assert.equal(formatClock(m, NONE), '12:05 AM');
});
check('the calendar label without Intl: "Thursday 24 September", "Sep 24", "Sep 24 2026"', () => {
  const d = new Date(Date.UTC(2026, 8, 24, 12));
  assert.equal(formatCalendar(d, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }, NONE), 'Thursday 24 September');
  assert.equal(formatCalendar(d, { month: 'short', day: 'numeric', timeZone: 'UTC' }, NONE), '24 Sep');
  assert.equal(formatCalendar(d, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }, NONE), '24 Sep 2026');
});
check('the calendar label WITH Intl is still Intl\'s (guard)', () => {
  const d = new Date(Date.UTC(2026, 8, 24, 12));
  const s = formatCalendar(d, { month: 'short', day: 'numeric', timeZone: 'UTC' }, Intl);
  assert.match(s, /Sep/);
  assert.match(s, /24/);
});
check('integers group thousands with or without Intl', () => {
  assert.equal(formatInteger(12480, NONE), '12,480');
  assert.equal(formatInteger(999, NONE), '999');
  assert.equal(formatInteger(1234567, NONE), '1,234,567');
  assert.equal(formatInteger(-2500, NONE), '-2,500');
  assert.equal(formatInteger(12480, Intl), new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(12480));
});

// ---- SOURCE ATTACHMENT: no call site talks to Intl directly any more ---------
if (!USE_OLD) {
  const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  const read = (...p) => readFileSync(path.join(here, '..', ...p), 'utf8');
  const sites = [
    ['src', 'lib', 'dayLabel.ts'],
    ['src', 'lib', 'writeDay.ts'],
    ['src', 'services', 'timerEffects.ts'],
    ['src', 'services', 'backend', 'api.ts'],
    ['src', 'services', 'backend', 'SupabaseDataService.ts'],
    ['src', 'components', 'TodaysHealthCard.tsx'],
    ['src', 'components', 'WeeklyCheckinCard.tsx'],
    ['src', 'components', 'WorkoutSuggestion.tsx'],
    ['src', 'components', 'RestoreBlock.tsx'],
    ['src', 'app', 'metrics-history.tsx'],
    ['src', 'app', 'my-challenge.tsx'],
    ['src', 'app', '(tabs)', 'squad.tsx'],
    ['src', 'app', '(tabs)', 'track.tsx'],
    ['src', 'app', '(tabs)', 'you.tsx'],
  ];
  check('no call site constructs Intl or calls toLocale* directly any more', () => {
    const offenders = [];
    for (const p of sites) {
      const src = read(...p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      if (/new Intl\.|\.toLocale(Date|Time)?String\(/.test(src)) offenders.push(p.join('/'));
    }
    assert.deepEqual(offenders, [], `still talking to Intl directly: ${offenders.join(', ')}`);
  });
  check('the day-boundary timer and the date label go through the module', () => {
    assert.match(read('src', 'lib', 'writeDay.ts'), /from '\.\/intl(\.ts)?'/);
    assert.match(read('src', 'lib', 'dayLabel.ts'), /from '\.\/intl(\.ts)?'/);
  });
}

if (USE_OLD) {
  console.log(`\n${passes} passed, ${failures} failed against the old behaviour — they must fail; a suite that passes here would prove nothing.`);
  process.exit(failures > 0 ? 0 : 1);
}
console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
