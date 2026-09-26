/**
 * THE DAILY REMINDER'S ONE DECISION (Phase 38I, I4; rolling window 38J, J3)
 * — as data, not as a side effect. services/reminder.ts applies whatever
 * this returns; this decides.
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
 * WHAT IT SAYS. Only the NEXT reminder may name a day number: a missed day
 * on Hard restarts the count, so any later number could be false by the
 * time it fires. The rest say something that cannot go stale — the grace
 * rule, which is true of every day. Neither names a task count; the person
 * may tick two more before eight.
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
/** Stable identifiers, one per offset from today, so cancel is precise and never "cancel all". */
export const REMINDER_ID_PREFIX = 'daily-reminder-';
export const reminderIds = (): string[] =>
  Array.from({ length: REMINDER_WINDOW_DAYS }, (_, i) => `${REMINDER_ID_PREFIX}${i}`);

export type ReminderPermission = 'granted' | 'denied' | 'undetermined' | 'unavailable';

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
}

export interface ReminderItem {
  /** `daily-reminder-<offsetDays>` */
  id: string;
  /** 0 = today, 1 = tomorrow, … */
  offsetDays: number;
  hour: number;
  minute: number;
  body: string;
  /** Only the first item in the window names a day; this is that day, else null. */
  namesDay: number | null;
}

export type ReminderPlan =
  /** Nothing to do and nothing to undo: web, where there is no such thing. */
  | { action: 'none'; reason: string }
  /** Cancel every pending reminder: the switch is off, or none may fire. */
  | { action: 'clear'; reason: string }
  /** Cancel every pending reminder and schedule exactly these. */
  | { action: 'schedule'; items: ReminderItem[]; zone: string | null; reason: string };

/** The next reminder: it may name the day, because it is the next one. */
export function reminderBody(day: number): string {
  return `Day ${day} is open until noon tomorrow.`;
}

/** Every later reminder: true of any day, so it cannot go stale. */
export const REMINDER_GENERIC_BODY = "Today's tasks stay open until noon tomorrow.";

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

  const items: ReminderItem[] = [];
  for (let offset = 0; offset < REMINDER_WINDOW_DAYS; offset += 1) {
    if (offset === 0 && !todayQualifies) continue;
    const first = items.length === 0;
    items.push({
      id: `${REMINDER_ID_PREFIX}${offset}`,
      offsetDays: offset,
      hour: REMINDER_HOUR,
      minute: REMINDER_MINUTE,
      body: first ? reminderBody(i.day + offset) : REMINDER_GENERIC_BODY,
      namesDay: first ? i.day + offset : null,
    });
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
 * calendar day it was built on, and every item's id and body. The service
 * keeps the last one and rebuilds only when it differs.
 */
export function planSignature(plan: ReminderPlan, todayKey: string): string {
  if (plan.action !== 'schedule') return plan.action;
  return [plan.zone ?? '-', todayKey, ...plan.items.map((it) => `${it.id}=${it.body}`)].join('|');
}
