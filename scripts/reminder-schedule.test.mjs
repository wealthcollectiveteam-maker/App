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
// 38S adds the morning last call beside the 20:00 reminder; the 38I/38J
// window assertions are about the 20:00 ones.
const evening = (p) => (p.items ?? []).filter((it) => it.kind !== 'lastCall');
const lastCalls = (p) => (p.items ?? []).filter((it) => it.kind === 'lastCall');
const eveningIds = () => reminderIds().filter((id) => id.startsWith('daily-reminder-'));

check('the default time is 20:00 and the window is seven days', () => {
  assert.equal(REMINDER_HOUR, 20);
  assert.equal(REMINDER_MINUTE, 0);
  assert.equal(REMINDER_WINDOW_DAYS, 7);
  assert.equal(eveningIds().length, 7);
});

// ---- THE PERSON WHO NEVER OPENS THE APP AGAIN --------------------------------
check('never opened again: SEVEN reminders are pending, one per day, not one', () => {
  const p = reminderPlan(base);
  assert.equal(p.action, 'schedule', `plan is ${p.action}: ${p.reason}`);
  assert.equal(evening(p).length, 7, `${evening(p).length} reminder(s) — day two and three would be silent`);
  assert.deepEqual(evening(p).map((it) => it.offsetDays), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(evening(p).map((it) => it.id), eveningIds());
});

check('...naming only TODAY, never a later day', () => {
  const p = reminderPlan(base);
  assert.ok(named(p).length >= 1);
  for (const it of named(p)) assert.equal(it.namesDay, 32, `a reminder names Day ${it.namesDay}; a later number could be false after a restart`);
  assert.equal(evening(p)[0].body, 'Day 32 is open until noon tomorrow.');
  for (const it of evening(p).slice(1)) assert.equal(it.body, REMINDER_GENERIC_BODY);
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
  assert.equal(evening(p).length, 6, `${evening(p).length} remain`);
  assert.deepEqual(evening(p).map((it) => it.offsetDays), [1, 2, 3, 4, 5, 6]);
  assert.equal(named(p).length, 1);
  assert.equal(evening(p)[0].namesDay, 33);
  assert.match(p.reason, /sealed/);
});

check("after eight with today still open: the window starts tomorrow, six items", () => {
  const p = reminderPlan({ ...base, now: { hour: 20, minute: 0 } });
  assert.equal(evening(p).length, 6);
  assert.equal(evening(p)[0].offsetDays, 1);
  assert.equal(evening(reminderPlan({ ...base, now: { hour: 19, minute: 59 } })).length, 7);
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
  assert.equal(p.zone, 'Europe/London');
  assert.equal(evening(p).length, 7);
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

// ---- 38S: THE LAST CALL, BEFORE NOON ----------------------------------------
// Every miss since Day 30 had the same cause: the work was done and nothing
// asked for it to be logged before the noon deadline. The 20:00 reminder
// fires the evening before; by the morning nothing is pending. These cases
// fix a morning reminder against the SERVER's close instant, and hold every
// reminder to two rules: it fires only while the day it is about is open
// and unsealed, and it names a day only when that number cannot be undone.
if (!USE_OLD) {
  const HOUR = 3_600_000;
  // Device-local wall clock; the device is in the challenge's zone.
  const at = (d, h, m = 0) => new Date(2026, 9, d, h, m).getTime();
  const morning = {
    ...base,
    durationDays: 75,
    now: { hour: 8, minute: 0 },
    nowMs: at(14, 8),
    todayClosesAtMs: at(15, 12),
    // Day 31, still open until noon today, not locked in.
    pending: { day: 31, lastDay: 31, closesAtMs: at(14, 12) },
  };
  const evening1810 = { ...morning, now: { hour: 18, minute: 10 }, nowMs: at(14, 18, 10), pending: null };

  check('38S: an open, unsealed day gets a LAST CALL three hours before its close', () => {
    const lc = lastCalls(reminderPlan(evening1810));
    const today = lc.find((it) => it.aboutDay === 32);
    assert.ok(today, 'nothing reminds him on the morning of the deadline');
    assert.equal(today.at, at(15, 12) - 3 * HOUR, 'not three hours before the server close');
    assert.equal(today.namesDay, 32);
    assert.equal(today.body, 'Day 32 is still open for three more hours.');
  });

  check("38S: yesterday still open at 08:00: a last call at 09:00 TODAY names it", () => {
    const lc = lastCalls(reminderPlan(morning));
    const y = lc.find((it) => it.aboutDay === 31);
    assert.ok(y, 'the morning with a day still open has no reminder before noon');
    assert.equal(y.at, at(14, 9));
    assert.equal(y.namesDay, 31);
  });

  check("38S: while yesterday is unjudged, nothing names TODAY's number — a miss at noon restarts it", () => {
    const p = reminderPlan(morning);
    for (const it of named(p)) assert.equal(it.namesDay, 31, `"${it.body}" names a day that may not exist after noon`);
    assert.equal(evening(p)[0].body, REMINDER_GENERIC_BODY);
  });

  check('38S: yesterday SEALED: its last call is gone and today is named again', () => {
    const p = reminderPlan({ ...morning, pending: null });
    assert.ok(!lastCalls(p).some((it) => it.aboutDay === 31), 'a sealed day is still being chased');
    assert.equal(evening(p)[0].namesDay, 32);
  });

  check("38S: past the last call's time (10:30), no last call is scheduled into the past", () => {
    const p = reminderPlan({ ...morning, now: { hour: 10, minute: 30 }, nowMs: at(14, 10, 30) });
    for (const it of lastCalls(p)) assert.ok(it.at > at(14, 10, 30), `a last call at ${new Date(it.at).toString()}`);
    assert.ok(!lastCalls(p).some((it) => it.aboutDay === 31));
  });

  check('38S: today SEALED: no last call about today', () => {
    const p = reminderPlan({ ...evening1810, todaySealed: true });
    assert.ok(!lastCalls(p).some((it) => it.aboutDay === 32), 'a sealed day is still being chased');
  });

  check('38S: after 20:00 with today open, no reminder names TOMORROW (it depends on tonight)', () => {
    const p = reminderPlan({ ...evening1810, now: { hour: 21, minute: 0 }, nowMs: at(14, 21) });
    for (const it of named(p)) assert.equal(it.namesDay, 32, `"${it.body}" names Day ${it.namesDay}`);
    assert.ok(lastCalls(p).some((it) => it.namesDay === 32), 'the morning last call is the one that matters here');
  });

  check('38S: a catch-up range: one last call for the range, before its one close', () => {
    const p = reminderPlan({
      ...evening1810,
      now: { hour: 16, minute: 0 },
      nowMs: at(14, 16),
      pending: { day: 43, lastDay: 50, closesAtMs: at(15, 12) },
    });
    const r = lastCalls(p).filter((it) => it.aboutDay === 43);
    assert.equal(r.length, 1);
    assert.equal(r[0].at, at(15, 9));
    assert.equal(r[0].body, 'Days 43 to 50 are still open for three more hours.');
  });

  check('38S: every last call fires inside the window of the day it is about', () => {
    for (const input of [morning, evening1810, { ...evening1810, todaySealed: true }]) {
      const p = reminderPlan(input);
      for (const it of lastCalls(p)) {
        assert.ok(it.at > input.nowMs, 'in the past');
        if (it.aboutDay === 31) assert.ok(it.at < morning.pending.closesAtMs);
        if (it.aboutDay === 32) assert.ok(it.at < input.todayClosesAtMs);
      }
    }
  });

  check('38S: later last calls are generic and carry no number', () => {
    const p = reminderPlan(evening1810);
    const later = lastCalls(p).filter((it) => it.namesDay == null);
    assert.ok(later.length >= 4, `${later.length} later last calls`);
    for (const it of later) assert.doesNotMatch(it.body, /\d/);
  });

  check('38S: the challenge ends — nothing about a day past the last one', () => {
    const p = reminderPlan({ ...evening1810, day: 75, now: { hour: 21, minute: 0 }, nowMs: at(14, 21) });
    for (const it of p.items) assert.ok((it.aboutDay ?? 75) <= 75, `a reminder about Day ${it.aboutDay}`);
    assert.ok(lastCalls(p).some((it) => it.aboutDay === 75), 'Day 75 itself still gets its last call');
    const done = reminderPlan({ ...evening1810, day: 75, todaySealed: true });
    assert.equal(done.items.length, 0, `${done.items.length} reminders after the final day was sealed`);
  });

  check('38S: the new lines say nothing that can go stale either', () => {
    for (const it of [...lastCalls(reminderPlan(morning)), ...lastCalls(reminderPlan(evening1810))]) {
      assert.doesNotMatch(it.body, /!|\p{Extended_Pictographic}/u);
      assert.doesNotMatch(it.body, /\d+ tasks?|left|remaining|noon/i, 'a task count, or a clock time in a zone the phone may not be in');
      assert.doesNotMatch(it.body, /streak|lose|miss|restart/i, 'a threat');
      assert.equal((it.body.match(/[.!?]/g) ?? []).length, 1, 'one line');
    }
  });

  check('38S: the last-call ids are cancelled with the rest', () => {
    const ids = new Set(reminderIds());
    for (const it of [...reminderPlan(morning).items, ...reminderPlan(evening1810).items]) assert.ok(ids.has(it.id), `${it.id} would never be cancelled`);
  });

  check('38S: a moved last call changes the signature', () => {
    const key = '2026-10-14';
    assert.notEqual(
      planSignature(reminderPlan(evening1810), key),
      planSignature(reminderPlan({ ...evening1810, todayClosesAtMs: at(15, 13) }), key),
    );
  });
}

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
  check('38S: the service feeds the plan the server close instants and re-plans on a seal of yesterday', () => {
    assert.match(svc, /todayClosesAtMs:/, 'the plan is not given the server close');
    assert.match(svc, /pending:/, 'the plan is not told about an open earlier day');
    assert.match(svc, /s\.yesterday !== prev\.yesterday/, 'sealing yesterday does not re-plan');
    assert.match(svc, /item\.at/, 'a last call is not scheduled at its instant');
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
