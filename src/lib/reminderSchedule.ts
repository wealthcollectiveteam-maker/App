/**
 * THE DAILY REMINDER'S ONE DECISION (Phase 38I, I4) — as data, not as a side
 * effect. services/reminder.ts applies whatever this returns; this decides.
 *
 * WHY THE REMINDER EXISTS. Nobody in the squad has ever been asked to come
 * back (38E). Web push needs a service worker and a Home Screen install this
 * squad will not do; a local notification in the native app needs neither.
 *
 * WHAT IT SAYS. One line, and it never states something that may no longer
 * be true by the time it fires. A task count would: the person may tick two
 * more before eight o'clock. The day number will not: days turn at midnight
 * and the reminder fires at twenty o'clock the same day, so "Day 32 is open
 * until noon tomorrow" is exactly as true at eight as when it was scheduled
 * — unless the day was completed on another device, which this phone cannot
 * know and which is the accepted edge (see the report).
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
/** The one stable identifier, so cancel is precise and never "cancel all". */
export const REMINDER_ID = 'daily-reminder';

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

export type ReminderPlan =
  /** Nothing to do and nothing to undo: web, where there is no such thing. */
  | { action: 'none'; reason: string }
  /** Cancel whatever is pending: the reminder is off, or it may not fire. */
  | { action: 'clear'; reason: string }
  /** Cancel whatever is pending and schedule exactly this. */
  | {
      action: 'schedule';
      target: 'today' | 'tomorrow';
      day: number;
      hour: number;
      minute: number;
      body: string;
      zone: string | null;
      reason: string;
    };

/** The one line. It names the day and nothing that can go stale. */
export function reminderBody(day: number): string {
  return `Day ${day} is open until noon tomorrow.`;
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

  if (!i.todaySealed && beforeTime) {
    return {
      action: 'schedule',
      target: 'today',
      day: i.day,
      hour: REMINDER_HOUR,
      minute: REMINDER_MINUTE,
      body: reminderBody(i.day),
      zone: i.deviceZone,
      reason: zoneMoved ? 'device zone changed; rescheduled for today' : 'today is still open',
    };
  }
  return {
    action: 'schedule',
    target: 'tomorrow',
    day: i.day + 1,
    hour: REMINDER_HOUR,
    minute: REMINDER_MINUTE,
    body: reminderBody(i.day + 1),
    zone: i.deviceZone,
    reason: i.todaySealed
      ? 'today is sealed on this device'
      : zoneMoved
        ? 'device zone changed; rescheduled for tomorrow'
        : "past today's time",
  };
}

/**
 * Whether a pending schedule made against `last` is still the schedule
 * `plan` asks for. False when the zone moved, the target day changed, or
 * there was none: the caller cancels and schedules afresh.
 */
export function scheduleMatches(
  last: { zone: string | null; day: number; target: 'today' | 'tomorrow'; dateKey: string } | null,
  plan: ReminderPlan,
  todayKey: string,
): boolean {
  if (plan.action !== 'schedule' || !last) return false;
  return last.zone === plan.zone && last.day === plan.day && last.dateKey === todayKey && last.target === plan.target;
}
