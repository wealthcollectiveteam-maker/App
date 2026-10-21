/**
 * THE DAILY REMINDER'S ONE DECISION (Phase 38I, I4; rolling window 38J, J3;
 * the last call, 38S) — as data, not as a side effect. services/reminder.ts
 * applies whatever this returns; this decides.
 *
 * WHY THE REMINDER EXISTS. Nobody in the squad has ever been asked to come
 * back (38E). Web push needs a service worker and a Home Screen install this
 * squad will not do; a local notification in the native app needs neither.
 *
 * WHY A WINDOW (38J). As built in 38I the plan was ONE notification, the
 * next 20:00, rescheduled on every app open. The reminder exists for the
 * person who does NOT open the app — and for that person 38I meant one
 * reminder, then nothing: day two and day three were silent. So the plan is
 * now the next REMINDER_WINDOW_DAYS days, rebuilt from the truth on every
 * open and every seal.
 *
 * THE LAST CALL (38S). The 20:00 reminder fires the evening before the
 * deadline. Every miss since Day 30 was work done and never logged by noon
 * the NEXT day — after the evening reminder, with nothing after it. So each
 * open day also gets one reminder LAST_CALL_LEAD_MS before the SERVER's
 * close instant (closes_at, or reopened_until on a reopened day): 09:00 for
 * a noon close. It is timed from the server's instant, never from the
 * device's idea of noon, and says "three more hours" rather than a clock
 * time, so a phone in another zone is never told the wrong hour.
 *
 * WHICH REMINDER MAY NAME A DAY (38S, replacing 38J's "only the next one").
 * A reminder names the day it is about only when that number cannot change
 * before it fires: the pending earlier day itself; today, when nothing
 * earlier is still unjudged; tomorrow, once today is sealed. While yesterday
 * is open and unsealed, today's number depends on it — a miss at noon
 * restarts the count on Hard — so today's reminders go generic. The 38J rule
 * named "the next one" even then, and named tomorrow after 20:00 with today
 * still open: both could fire carrying a number that no longer existed.
 * The generic lines say something true of every day. None names a task count.
 *
 * WHAT IT CANNOT KNOW. A day sealed on ANOTHER device (the web app) is not
 * seen here until this app next comes to the foreground; until then that
 * day's last call stays pending. It is not false — the server's window
 * keeps the day open for those three hours — but it chases a day already done.
 *
 * THE TIME. The preferences hold one boolean, `dailyReminder`
 * (`notify_daily_reminder` on the server, 0013). There is no stored time, so
 * 20:00 device-local is used for everyone.
 *
 * Kept free of react-native imports so scripts/reminder-schedule.test.mjs
 * runs it in plain Node.
 */

export const REMINDER_HOUR = 20;
export const REMINDER_MINUTE = 0;
/** How many days ahead are kept scheduled for a person who stops opening the app. */
export const REMINDER_WINDOW_DAYS = 7;
/** The last call fires this long before the server's close instant: 09:00 for a noon close. */
export const LAST_CALL_LEAD_MS = 3 * 3_600_000;
/** Stable identifiers, one per offset from today, so cancel is precise and never "cancel all". */
export const REMINDER_ID_PREFIX = 'daily-reminder-';
/** `daily-lastcall-<k>` fires on the morning of day offset k, about the day before it. */
export const LAST_CALL_ID_PREFIX = 'daily-lastcall-';
export const reminderIds = (): string[] => [
  ...Array.from({ length: REMINDER_WINDOW_DAYS }, (_, i) => `${REMINDER_ID_PREFIX}${i}`),
  ...Array.from({ length: REMINDER_WINDOW_DAYS }, (_, i) => `${LAST_CALL_ID_PREFIX}${i}`),
];

export type ReminderPermission = 'granted' | 'denied' | 'undetermined' | 'unavailable';

/** The oldest non-today day that is open and not sealed: an ordinary yesterday, or a reopened range. */
export interface PendingDay {
  day: number;
  /** The last open, unsealed day of a reopened range; `day` itself otherwise. */
  lastDay: number;
  /** The server's close for it: reopened_until on a reopened day, else closes_at. */
  closesAtMs: number;
}

export interface ReminderInput {
  /** react-native's Platform.OS. 'web' must do nothing. */
  platform: string;
  /** The stored preference. */
  enabled: boolean;
  /** The system grant as read right now, never assumed. */
  permission: ReminderPermission;
  /** Today's day number on the challenge. */
  day: number;
  /** Today was sealed on THIS device. */
  todaySealed: boolean;
  /** The device's local wall clock now. */
  now: { hour: number; minute: number };
  /** The device's IANA zone now, if known. */
  deviceZone: string | null;
  /** The zone the last schedule was made against, if any. */
  lastScheduledZone: string | null;
  /** 38S. The instant now. Without it no last call is planned. */
  nowMs?: number;
  /** 38S. The challenge's length; nothing is planned about a day past it. */
  durationDays?: number;
  /** 38S. The server's close for TODAY. Null (the mock): noon tomorrow on the device. */
  todayClosesAtMs?: number | null;
  /** 38S. An earlier day still open and unsealed, if any. */
  pending?: PendingDay | null;
}

export interface ReminderItem {
  /** `daily-reminder-<offsetDays>` or `daily-lastcall-<offsetDays>` */
  id: string;
  /** 'evening' is the 20:00 one; 'lastCall' the one before the close (38S). */
  kind: 'evening' | 'lastCall';
  /** 0 = today, 1 = tomorrow, … — the day it FIRES on. */
  offsetDays: number;
  hour: number;
  minute: number;
  /** A last call's exact instant (epoch ms). Evening items use offset/hour/minute. */
  at?: number;
  body: string;
  /** The day number this reminder is about, named or not. */
  aboutDay: number;
  /** The day it names, else null. */
  namesDay: number | null;
}

export type ReminderPlan =
  /** Nothing to do and nothing to undo: web, where there is no such thing. */
  | { action: 'none'; reason: string }
  /** Cancel every pending reminder: the switch is off, or none may fire. */
  | { action: 'clear'; reason: string }
  /** Cancel every pending reminder and schedule exactly these. */
  | { action: 'schedule'; items: ReminderItem[]; zone: string | null; reason: string };

/** The evening reminder that may name its day. */
export function reminderBody(day: number): string {
  return `Day ${day} is open until noon tomorrow.`;
}

/** Every other evening reminder: true of any day, so it cannot go stale. */
export const REMINDER_GENERIC_BODY = "Today's tasks stay open until noon tomorrow.";

/** The last call that may name its day, or a reopened range. */
export function lastCallBody(day: number, lastDay = day): string {
  return lastDay > day
    ? `Days ${day} to ${lastDay} are still open for three more hours.`
    : `Day ${day} is still open for three more hours.`;
}

/** Every other last call: conditional, so it is true whether or not the day was done. */
export const LAST_CALL_GENERIC_BODY = "If yesterday isn't locked in, it is open for three more hours.";

/** `ms` moved by whole calendar days on the device's clock (keeps the wall time across DST). */
function addLocalDays(ms: number, days: number): number {
  const d = new Date(ms);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

function lastCallItem(
  offset: number,
  at: number,
  aboutDay: number,
  name: boolean,
  lastDay = aboutDay,
): ReminderItem {
  const d = new Date(at);
  return {
    id: `${LAST_CALL_ID_PREFIX}${offset}`,
    kind: 'lastCall',
    offsetDays: offset,
    hour: d.getHours(),
    minute: d.getMinutes(),
    at,
    body: name ? lastCallBody(aboutDay, lastDay) : LAST_CALL_GENERIC_BODY,
    aboutDay,
    namesDay: name ? aboutDay : null,
  };
}

export function reminderPlan(i: ReminderInput): ReminderPlan {
  if (i.platform === 'web') {
    return { action: 'none', reason: 'web has no local notifications' };
  }
  if (!i.enabled) {
    return { action: 'clear', reason: 'reminder is off' };
  }
  if (i.permission !== 'granted') {
    // Denied, not asked, or unavailable: nothing may be scheduled, and the
    // Settings row says so instead of showing an ON switch.
    return { action: 'clear', reason: `notification permission is ${i.permission}` };
  }
  const zoneMoved =
    i.lastScheduledZone != null && i.deviceZone != null && i.lastScheduledZone !== i.deviceZone;
  const beforeTime =
    i.now.hour < REMINDER_HOUR || (i.now.hour === REMINDER_HOUR && i.now.minute < REMINDER_MINUTE);
  // Today's reminder exists only while today is open and eight has not passed.
  const todayQualifies = !i.todaySealed && beforeTime;
  const lastDayOfRun = i.durationDays ?? Number.POSITIVE_INFINITY;
  const pending = i.pending ?? null;
  // Today's number is settled only when no earlier day is still unjudged.
  const todayCertain = pending == null;
  // Tomorrow's number is settled only once today is met.
  const tomorrowCertain = todayCertain && i.todaySealed;

  const items: ReminderItem[] = [];
  for (let offset = 0; offset < REMINDER_WINDOW_DAYS; offset += 1) {
    const about = i.day + offset;
    if (about > lastDayOfRun) break;
    if (offset === 0 && !todayQualifies) continue;
    const name = (offset === 0 && todayCertain) || (offset === 1 && tomorrowCertain);
    items.push({
      id: `${REMINDER_ID_PREFIX}${offset}`,
      kind: 'evening',
      offsetDays: offset,
      hour: REMINDER_HOUR,
      minute: REMINDER_MINUTE,
      body: name ? reminderBody(about) : REMINDER_GENERIC_BODY,
      aboutDay: about,
      namesDay: name ? about : null,
    });
  }

  if (i.nowMs != null) {
    const nowMs = i.nowMs;
    // k = 0: the earlier day still open, on its own close.
    if (pending) {
      const fire = pending.closesAtMs - LAST_CALL_LEAD_MS;
      if (fire > nowMs) items.push(lastCallItem(0, fire, pending.day, true, pending.lastDay));
    }
    // k >= 1: the morning after day (today + k - 1), on that day's close.
    // Without the server's instant (the mock), noon tomorrow on the device.
    let firstClose = i.todayClosesAtMs ?? null;
    if (firstClose == null) {
      const d = new Date(nowMs);
      d.setDate(d.getDate() + 1);
      d.setHours(12, 0, 0, 0);
      firstClose = d.getTime();
    }
    for (let k = 1; k < REMINDER_WINDOW_DAYS; k += 1) {
      const about = i.day + k - 1;
      if (about > lastDayOfRun) break;
      if (k === 1 && i.todaySealed) continue;
      const fire = addLocalDays(firstClose, k - 1) - LAST_CALL_LEAD_MS;
      if (fire <= nowMs) continue;
      items.push(lastCallItem(k, fire, about, k === 1 && todayCertain));
    }
  }

  const why = i.todaySealed
    ? 'today is sealed on this device; the window starts tomorrow'
    : todayQualifies
      ? 'today is still open; the window starts today'
      : "past today's time; the window starts tomorrow";
  return {
    action: 'schedule',
    items,
    zone: i.deviceZone,
    reason: zoneMoved ? `device zone changed; ${why}` : why,
  };
}

/**
 * A string that changes exactly when the pending set should: the zone, the
 * calendar day it was built on, and every item's id, instant and body. The
 * service keeps the last one and rebuilds only when it differs.
 */
export function planSignature(plan: ReminderPlan, todayKey: string): string {
  if (plan.action !== 'schedule') return plan.action;
  return [
    plan.zone ?? '-',
    todayKey,
    ...plan.items.map((it) => `${it.id}${it.at != null ? `@${it.at}` : ''}=${it.body}`),
  ].join('|');
}
