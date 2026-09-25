/**
 * Proofs for THE DAILY REMINDER'S DECISION (Phase 38I, I4).
 *
 * Nobody in the squad has ever been asked to come back. The native app can
 * ask, once a day, with a local notification. The decision — schedule what,
 * for when, or clear — lives in src/lib/reminderSchedule.ts and this drives
 * it with each state the brief names: on/off, sealed today, timezone moved,
 * permission denied, web.
 *
 * PROOF (f): `--old` runs the assertions against the app as it stood through
 * 38H, transcribed: nothing ever scheduled a reminder, so the plan was
 * always "none". The ON cases fail there; the guards pass before and after.
 *
 *   npm run test:reminder-schedule
 *   npm run test:reminder-schedule -- --old
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  REMINDER_HOUR,
  REMINDER_ID,
  REMINDER_MINUTE,
  reminderBody,
  reminderPlan as fixedPlan,
  scheduleMatches,
} from '../src/lib/reminderSchedule.ts';

function oldPlan() {
  return { action: 'none', reason: 'the app has never sent a reminder' };
}

const USE_OLD = process.argv.includes('--old');
const reminderPlan = USE_OLD ? oldPlan : fixedPlan;
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

// The owner at 18:10 on day 32, iOS, reminder on, permission granted.
const base = {
  platform: 'ios',
  enabled: true,
  permission: 'granted',
  day: 32,
  todaySealed: false,
  now: { hour: 18, minute: 10 },
  deviceZone: 'America/Toronto',
  lastScheduledZone: 'America/Toronto',
};

check('the default time is 20:00, there being no stored time in the preferences', () => {
  assert.equal(REMINDER_HOUR, 20);
  assert.equal(REMINDER_MINUTE, 0);
  assert.equal(REMINDER_ID, 'daily-reminder');
});

check("ON, today open, before eight: schedule TODAY's, naming day 32", () => {
  const p = reminderPlan(base);
  assert.equal(p.action, 'schedule', `plan is ${p.action}: ${p.reason}`);
  assert.equal(p.target, 'today');
  assert.equal(p.day, 32);
  assert.equal(p.hour, 20);
  assert.equal(p.body, 'Day 32 is open until noon tomorrow.');
});

check('the line names the day and nothing that can go stale', () => {
  const s = reminderBody(32);
  assert.doesNotMatch(s, /!/, 'an exclamation mark');
  assert.doesNotMatch(s, /\d+ tasks?|left|remaining/i, 'a task count would be stale by eight');
  assert.doesNotMatch(s, /streak|lose|miss|restart/i, 'a threat');
  assert.doesNotMatch(s, /\p{Extended_Pictographic}/u, 'an emoji');
  assert.equal((s.match(/[.!?]/g) ?? []).length, 1, 'one line');
  assert.match(s, /Day 32/);
});

check("today SEALED on this device: today's is cancelled and TOMORROW's scheduled, naming day 33", () => {
  const p = reminderPlan({ ...base, todaySealed: true });
  assert.equal(p.action, 'schedule');
  assert.equal(p.target, 'tomorrow');
  assert.equal(p.day, 33);
  assert.equal(p.body, 'Day 33 is open until noon tomorrow.');
  assert.match(p.reason, /sealed/);
});

check("after eight with today still open: tomorrow's", () => {
  const p = reminderPlan({ ...base, now: { hour: 20, minute: 0 } });
  assert.equal(p.action, 'schedule');
  assert.equal(p.target, 'tomorrow');
  const q = reminderPlan({ ...base, now: { hour: 19, minute: 59 } });
  assert.equal(q.target, 'today');
});

check('OFF: clear whatever is pending (guard)', () => {
  const p = reminderPlan({ ...base, enabled: false });
  assert.equal(p.action, 'clear');
});

check('permission DENIED: clear, never schedule, and the reason says so', () => {
  const p = reminderPlan({ ...base, permission: 'denied' });
  assert.equal(p.action, 'clear');
  assert.match(p.reason, /denied/);
  assert.equal(reminderPlan({ ...base, permission: 'undetermined' }).action, 'clear');
});

check('WEB: nothing, not even a clear (guard)', () => {
  const p = reminderPlan({ ...base, platform: 'web' });
  assert.equal(p.action, 'none');
});

check('the device zone MOVED: rescheduled against the new zone', () => {
  const p = reminderPlan({ ...base, deviceZone: 'Europe/London', lastScheduledZone: 'America/Toronto' });
  assert.equal(p.action, 'schedule');
  assert.equal(p.zone, 'Europe/London');
  assert.match(p.reason, /zone changed/);
  // ...and the pending one no longer matches, so the service replaces it.
  const last = { zone: 'America/Toronto', day: 32, target: 'today', dateKey: '2026-09-24' };
  assert.equal(scheduleMatches(last, p, '2026-09-24'), false);
});

check('an unchanged plan is left alone; a new day is not (scheduleMatches)', () => {
  const p = reminderPlan(base);
  const last = { zone: 'America/Toronto', day: 32, target: 'today', dateKey: '2026-09-24' };
  assert.equal(scheduleMatches(last, p, '2026-09-24'), true);
  assert.equal(scheduleMatches(last, p, '2026-09-25'), false);
  assert.equal(scheduleMatches(null, p, '2026-09-24'), false);
  assert.equal(scheduleMatches(last, { action: 'clear', reason: '' }, '2026-09-24'), false);
});

// ---- SOURCE ATTACHMENT ------------------------------------------------------
if (!USE_OLD) {
  const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  const read = (...p) => readFileSync(path.join(here, '..', ...p), 'utf8');
  const svc = read('src', 'services', 'reminder.ts');
  const settings = read('src', 'app', 'settings', 'index.tsx');
  const layout = read('src', 'app', '_layout.tsx');
  check('the service applies reminderPlan() and never cancels all notifications', () => {
    assert.match(svc, /reminderPlan\(\{/, 'reminder.ts never calls reminderPlan');
    assert.match(svc, /cancelScheduledNotificationAsync\(REMINDER_ID\)/, 'not cancelling by the stable id');
    assert.doesNotMatch(svc, /cancelAllScheduledNotificationsAsync/, 'cancel-all would kill the timer\'s');
  });
  check('permission is requested only when the reminder is turned on', () => {
    assert.match(svc, /export async function enableReminder/, 'no enableReminder');
    assert.match(svc, /requestPermissionsAsync/, 'never asks');
    assert.doesNotMatch(layout, /requestPermissionsAsync/, 'the root layout asks at launch');
    assert.match(settings, /enableReminder\(/, 'the Settings switch does not go through enableReminder');
  });
  check('the root layout installs the sync, and the 38A "coming soon" row is gone', () => {
    assert.match(layout, /installReminderSync\(\)/, 'installReminderSync is never called');
    assert.doesNotMatch(settings, /cannot send reminders yet/, 'the row still says coming soon');
  });
}

if (USE_OLD) {
  console.log(`\n${passes} passed, ${failures} failed against the old behaviour — they must fail; a suite that passes here would prove nothing.`);
  process.exit(failures > 0 ? 0 : 1);
}
console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
