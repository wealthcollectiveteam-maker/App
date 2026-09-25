import AsyncStorage from '@react-native-async-storage/async-storage';
import { getCalendars } from 'expo-localization';
import { AppState, Platform } from 'react-native';

import {
  REMINDER_ID,
  type ReminderPermission,
  type ReminderPlan,
  reminderPlan,
  scheduleMatches,
} from '@/lib/reminderSchedule';
import { getNotificationPermissionStatus } from '@/services/timerEffects';
import { useAppStore } from '@/store/useAppStore';

/**
 * THE DAILY REMINDER, native only (Phase 38I, I4). One local notification a
 * day at 20:00 device-local while the preference is on and the system grant
 * is 'granted'. The decision is lib/reminderSchedule.ts; this applies it.
 *
 * WHEN IT RUNS: at launch, on every foreground, and whenever the store's
 * day, today's seal, or the preference changes. Each run computes the plan
 * from what is true now and makes the pending notification match it —
 * so sealing today on this device cancels today's and schedules tomorrow's,
 * and a device that changed timezone gets rescheduled against the new zone.
 *
 * PERMISSION is requested in exactly one place: enableReminder(true), which
 * the Settings switch calls. Never at launch.
 *
 * On web every function here is a no-op: expo-notifications is never loaded.
 */

const LAST_KEY = 'ranked.reminder.last.v1';

interface LastSchedule {
  zone: string | null;
  day: number;
  target: 'today' | 'tomorrow';
  dateKey: string;
}

type NotificationsModule = typeof import('expo-notifications');
let notifications: NotificationsModule | null = null;
function getNotifications(): NotificationsModule | null {
  if (Platform.OS === 'web') return null;
  if (!notifications) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    notifications = require('expo-notifications') as NotificationsModule;
  }
  return notifications;
}

function deviceZone(): string | null {
  try {
    return getCalendars()[0]?.timeZone ?? null;
  } catch {
    return null;
  }
}

function localDateKey(d = new Date()): string {
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`;
}

async function readLast(): Promise<LastSchedule | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_KEY);
    return raw ? (JSON.parse(raw) as LastSchedule) : null;
  } catch {
    return null;
  }
}

/** The instant of `hour:minute` today or tomorrow, on the device's clock. */
function fireDate(target: 'today' | 'tomorrow', hour: number, minute: number): Date {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  if (target === 'tomorrow') d.setDate(d.getDate() + 1);
  return d;
}

/**
 * Make the pending notification match the plan. Returns the plan so the
 * caller (and the dev console) can see what was decided.
 */
export async function syncReminder(): Promise<ReminderPlan> {
  const mod = getNotifications();
  const s = useAppStore.getState();
  const now = new Date();
  const permission: ReminderPermission = mod ? await getNotificationPermissionStatus() : 'unavailable';
  const last = await readLast();
  const plan = reminderPlan({
    platform: Platform.OS,
    enabled: s.notificationPrefs.dailyReminder,
    permission,
    day: s.day,
    todaySealed: s.dayComplete,
    now: { hour: now.getHours(), minute: now.getMinutes() },
    deviceZone: deviceZone(),
    lastScheduledZone: last?.zone ?? null,
  });
  if (!mod || plan.action === 'none') return plan;

  try {
    if (plan.action === 'clear') {
      await mod.cancelScheduledNotificationAsync(REMINDER_ID);
      await AsyncStorage.removeItem(LAST_KEY);
      return plan;
    }
    const todayKey = localDateKey(now);
    if (scheduleMatches(last, plan, todayKey)) return plan;
    await mod.cancelScheduledNotificationAsync(REMINDER_ID);
    await mod.scheduleNotificationAsync({
      identifier: REMINDER_ID,
      content: { title: 'Ranked', body: plan.body, sound: false, data: { url: '/checkin' } },
      trigger: {
        type: mod.SchedulableTriggerInputTypes.DATE,
        date: fireDate(plan.target, plan.hour, plan.minute),
      },
    });
    const record: LastSchedule = { zone: plan.zone, day: plan.day, target: plan.target, dateKey: todayKey };
    await AsyncStorage.setItem(LAST_KEY, JSON.stringify(record));
  } catch {
    // A scheduling failure must never break the screen that asked for it.
  }
  return plan;
}

/**
 * The Settings switch. Turning ON is the ONE moment the system permission is
 * requested. If it is refused the preference stays OFF: the row must not
 * show a reminder that cannot be sent. Returns the grant as it stands after.
 */
export async function enableReminder(on: boolean): Promise<ReminderPermission> {
  const mod = getNotifications();
  const setPref = useAppStore.getState().setNotificationPref;
  if (!mod) {
    setPref('dailyReminder', false);
    return 'unavailable';
  }
  if (!on) {
    setPref('dailyReminder', false);
    await syncReminder();
    return getNotificationPermissionStatus();
  }
  try {
    const current = await mod.getPermissionsAsync();
    if (!current.granted && current.canAskAgain) {
      await mod.requestPermissionsAsync();
    }
  } catch {
    /* read the status below either way */
  }
  const status = await getNotificationPermissionStatus();
  setPref('dailyReminder', status === 'granted');
  await syncReminder();
  return status;
}

/**
 * Wire the reminder to the app's life: launch, foreground, and the three
 * store changes that move the plan. Returns the teardown. No-op on web.
 */
export function installReminderSync(): () => void {
  if (Platform.OS === 'web') return () => {};
  syncReminder().catch(() => {});
  const appState = AppState.addEventListener('change', (state) => {
    if (state === 'active') syncReminder().catch(() => {});
  });
  const unsubscribe = useAppStore.subscribe((s, prev) => {
    if (
      s.day !== prev.day ||
      s.dayComplete !== prev.dayComplete ||
      s.notificationPrefs.dailyReminder !== prev.notificationPrefs.dailyReminder
    ) {
      syncReminder().catch(() => {});
    }
  });
  return () => {
    appState.remove();
    unsubscribe();
  };
}
