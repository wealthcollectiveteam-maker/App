import AsyncStorage from '@react-native-async-storage/async-storage';
import { getCalendars } from 'expo-localization';
import { AppState, Platform } from 'react-native';

import {
  planSignature,
  type ReminderPermission,
  type ReminderPlan,
  reminderIds,
  reminderPlan,
} from '@/lib/reminderSchedule';
import { getNotificationPermissionStatus } from '@/services/timerEffects';
import { useAppStore } from '@/store/useAppStore';

/**
 * THE DAILY REMINDER, native only (Phase 38I, I4; rolling window 38J, J3).
 * A window of local notifications, one a day at 20:00 device-local for the
 * next seven days, kept while the preference is on and the system grant is
 * 'granted'. The decision is lib/reminderSchedule.ts; this applies it.
 *
 * WHEN IT RUNS: at launch, on every foreground, and whenever the store's
 * day, today's seal, or the preference changes. Each run computes the plan
 * from what is true now and makes the pending set match it — so sealing
 * today on this device removes today's and leaves the other six, a device
 * that changed timezone is rebuilt against the new zone, and a person who
 * never opens the app again still has seven mornings of reminders ahead.
 *
 * PERMISSION is requested in exactly one place: enableReminder(true), which
 * the Settings switch calls. Never at launch.
 *
 * On web every function here is a no-op: expo-notifications is never loaded.
 */

const LAST_KEY = 'ranked.reminder.last.v2';

interface LastSchedule {
  zone: string | null;
  signature: string;
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

/** The instant of `hour:minute`, `offsetDays` from today, on the device's clock. */
function fireDate(offsetDays: number, hour: number, minute: number): Date {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return d;
}

/** Cancel every reminder id, by name. Never cancel-all: the timer's are not ours to touch. */
async function cancelAllReminders(mod: NotificationsModule): Promise<void> {
  for (const id of reminderIds()) {
    await mod.cancelScheduledNotificationAsync(id);
  }
}

/**
 * Make the pending set match the plan. Returns the plan so the caller (and
 * the dev console) can see what was decided.
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
      await cancelAllReminders(mod);
      await AsyncStorage.removeItem(LAST_KEY);
      return plan;
    }
    const signature = planSignature(plan, localDateKey(now));
    if (last?.signature === signature) return plan;
    await cancelAllReminders(mod);
    for (const item of plan.items) {
      await mod.scheduleNotificationAsync({
        identifier: item.id,
        content: { title: 'Ranked', body: item.body, sound: false, data: { url: '/checkin' } },
        trigger: {
          type: mod.SchedulableTriggerInputTypes.DATE,
          date: fireDate(item.offsetDays, item.hour, item.minute),
        },
      });
    }
    const record: LastSchedule = { zone: plan.zone, signature };
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
