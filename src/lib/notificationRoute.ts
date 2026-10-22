/**
 * WHERE A NOTIFICATION TAP GOES (Phase 38S). One decision for both tap
 * paths in services/timerEffects.ts: the live listener (app running or in
 * the background) and the cold launch (the tap started the app).
 *
 *   '/timer'   the timer's alerts. On a cold launch only while a timer is
 *              actually running, so a stale response from an earlier
 *              session cannot hijack a normal launch (A2).
 *   '/checkin' the daily reminder and its last call (services/reminder.ts).
 *              Until 38S this url was sent and never read: the tap opened
 *              the app wherever it last was, not where the day is logged.
 *
 * Kept free of react-native imports so scripts/notification-route.test.mjs
 * runs it in plain Node.
 */
export type NotificationRoute = '/timer' | '/checkin';

export function notificationRoute(
  url: unknown,
  opts: { coldLaunch: boolean; hasActiveTimer: boolean },
): NotificationRoute | null {
  if (url === '/timer') return !opts.coldLaunch || opts.hasActiveTimer ? '/timer' : null;
  if (url === '/checkin') return '/checkin';
  return null;
}
