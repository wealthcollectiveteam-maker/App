/**
 * Proofs for THE DAILY REMINDER'S DECISION (Phase 38I, I4; the rolling
 * window, Phase 38J, J3).
 *
 * The reminder exists for the person who does NOT open the app. As built
 * in 38I the plan was ONE notification, rescheduled on every open — so for
 * that person day two and day three were silent. The plan is now the next
 * seven days, rebuilt from the truth on every open and every seal, and only
 * the NEXT one names a day number.
 *
 * PROOF (f): `--old` runs the assertions against 38I's plan, transcribed:
 * one item, the next 20:00, always naming its day. The window cases fail
 * there; the guards (off, denied, web) pass before and after.
 *
 *   npm run test:reminder-schedule
 *   npm run test:reminder-schedule -- --old
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  planSignature,
  REMINDER_GENERIC_BODY,
  REMINDER_HOUR,
  REMINDER_MINUTE,
  REMINDER_WINDOW_DAYS,
  reminderBody,
  reminderIds,
  reminderPlan as fixedPlan,
} from '../src/lib/reminderSchedule.ts';

// 38I, transcribed: one notification, the next 20:00, named.
function oldPlan(i) {
  if (i.platform === 'web') return { action: 'none', reason: 'web' };
  if (!i.enabled) return { action: 'clear', reason: 'off' };
  if (i.permission !== 'granted') return { action: 'clear', reason: `permission ${i.permission}` };
  const before = i.now.hour < 20 || (i.now.hour === 20 && i.now.minute < 0);
  const today = !i.todaySealed && before;
  const day = today ? i.day : i.day + 1;
  return {
    action: 'schedule',
    zone: i.deviceZone,
    items: [{ id: 'daily-reminder', offsetDays: today ? 0 : 1, hour: 20, minute: 0, body: `Day ${day} is open until noon tomorrow.`, namesDay: day }],
    reason: 'one shot',
  };
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

// The owner at 18:10 on day 32, iOS, reminder on, permission granted — and
// then he never opens the app again.
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
const named = (p) => (p.items ?? []).filter((it) => it.namesDay != null);

check('the default time is 20:00 and the window is seven days', () => {
  assert.equal(REMINDER_HOUR, 20);
  assert.equal(REMINDER_MINUTE, 0);
  assert.equal(REMINDER_WINDOW_DAYS, 7);
  assert.equal(reminderIds().length, 7);
});

// ---- THE PERSON WHO NEVER OPENS THE APP AGAIN --------------------------------
check('never opened again: SEVEN reminders are pending, one per day, not one', () => {
  const p = reminderPlan(base);
  assert.equal(p.action, 'schedule', `plan is ${p.action}: ${p.reason}`);
  assert.equal(p.items.length, 7, `${p.items.length} reminder(s) — day two and three would be silent`);
  assert.deepEqual(p.items.map((it) => it.offsetDays), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(p.items.map((it) => it.id), reminderIds());
});

check('...with exactly ONE day number, on the next one', () => {
  const p = reminderPlan(base);
  assert.equal(named(p).length, 1, `${named(p).length} reminders name a day; a later number could be false after a restart`);
  assert.equal(p.items[0].namesDay, 32);
  assert.equal(p.items[0].body, 'Day 32 is open until noon tomorrow.');
  for (const it of p.items.slice(1)) assert.equal(it.body, REMINDER_GENERIC_BODY);
});

check('the two lines say nothing that can go stale', () => {
  for (const s of [reminderBody(32), REMINDER_GENERIC_BODY]) {
    assert.doesNotMatch(s, /!/, 'an exclamation mark');
    assert.doesNotMatch(s, /\d+ tasks?|left|remaining/i, 'a task count would be stale by eight');
    assert.doesNotMatch(s, /streak|lose|miss|restart/i, 'a threat');
    assert.doesNotMatch(s, /\p{Extended_Pictographic}/u, 'an emoji');
    assert.equal((s.match(/[.!?]/g) ?? []).length, 1, 'one line');
  }
  assert.match(reminderBody(32), /Day 32/);
  assert.doesNotMatch(REMINDER_GENERIC_BODY, /\d/, 'the generic line must carry no number');
});

// ---- the seal, the switch, the zone -------------------------------------------
check("today SEALED on this device: today's is gone and SIX remain, the next naming day 33", () => {
  const p = reminderPlan({ ...base, todaySealed: true });
  assert.equal(p.action, 'schedule');
  assert.equal(p.items.length, 6, `${p.items.length} remain`);
  assert.deepEqual(p.items.map((it) => it.offsetDays), [1, 2, 3, 4, 5, 6]);
  assert.equal(named(p).length, 1);
  assert.equal(p.items[0].namesDay, 33);
  assert.match(p.reason, /sealed/);
});

check("after eight with today still open: the window starts tomorrow, six items", () => {
  const p = reminderPlan({ ...base, now: { hour: 20, minute: 0 } });
  assert.equal(p.items.length, 6);
  assert.equal(p.items[0].offsetDays, 1);
  assert.equal(reminderPlan({ ...base, now: { hour: 19, minute: 59 } }).items.length, 7);
});

check('OFF: clear — every one of the seven ids is cancelled, none scheduled (guard)', () => {
  const p = reminderPlan({ ...base, enabled: false });
  assert.equal(p.action, 'clear');
  assert.equal((p.items ?? []).length, 0);
});

check('permission DENIED or not asked: clear, never schedule (guard)', () => {
  assert.equal(reminderPlan({ ...base, permission: 'denied' }).action, 'clear');
  assert.equal(reminderPlan({ ...base, permission: 'undetermined' }).action, 'clear');
});

check('WEB: nothing scheduled, nothing cleared (guard)', () => {
  assert.equal(reminderPlan({ ...base, platform: 'web' }).action, 'none');
});

check('the device zone MOVED: all seven rebuilt against the new zone', () => {
  const p = reminderPlan({ ...base, deviceZone: 'Europe/London', lastScheduledZone: 'America/Toronto' });
  assert.equal(p.action, 'schedule');
  assert.equal(p.items.length, 7);
  assert.equal(p.zone, 'Europe/London');
  assert.match(p.reason, /zone changed/);
  // ...and the pending set no longer matches, so the service replaces it.
  const before = planSignature(reminderPlan(base), '2026-09-25');
  assert.notEqual(planSignature(p, '2026-09-25'), before);
});

check('an unchanged plan keeps its signature; a new day, a seal, or a moved zone changes it', () => {
  const key = '2026-09-25';
  const a = planSignature(reminderPlan(base), key);
  assert.equal(planSignature(reminderPlan(base), key), a);
  assert.notEqual(planSignature(reminderPlan(base), '2026-09-26'), a);
  assert.notEqual(planSignature(reminderPlan({ ...base, todaySealed: true }), key), a);
  assert.equal(planSignature({ action: 'clear', reason: '' }, key), 'clear');
});

// ---- SOURCE ATTACHMENT ------------------------------------------------------
if (!USE_OLD) {
  const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  const read = (...p) => readFileSync(path.join(here, '..', ...p), 'utf8');
  const svc = read('src', 'services', 'reminder.ts');
  const settings = read('src', 'app', 'settings', 'index.tsx');
  const layout = read('src', 'app', '_layout.tsx');
  check('the service applies reminderPlan(), cancels by the seven ids, never cancel-all', () => {
    assert.match(svc, /reminderPlan\(\{/, 'reminder.ts never calls reminderPlan');
    assert.match(svc, /for \(const id of reminderIds\(\)\)/, 'not cancelling every id by name');
    assert.match(svc, /for \(const item of plan\.items\)/, 'not scheduling every item in the window');
    assert.doesNotMatch(svc, /cancelAllScheduledNotificationsAsync/, "cancel-all would kill the timer's");
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
