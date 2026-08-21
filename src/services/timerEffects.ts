import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/**
 * Side effects for the workout timer: local notifications (native only —
 * they fire even if the app never returns to the foreground), success
 * haptics, and a completion chime that respects the device silent switch
 * (expo-audio's default iOS audio mode does not play in silent mode).
 *
 * NOTIFICATION MODEL (Phase 9 Part 3): a timer posts FOUR notifications
 * with STABLE identifiers so they can be cancelled precisely — never via
 * cancelAllScheduledNotificationsAsync, which would nuke ping/push
 * notifications too:
 *   timer-running   — posted immediately; sits on the Lock Screen showing
 *                     the absolute end time (iOS can't live-count-down)
 *   timer-halfway   — scheduled at the halfway point
 *   timer-5min      — scheduled at T-5:00
 *   timer-complete  — scheduled at the target time
 * All cancelled on pause/cancel, reposted on resume against the recomputed
 * target. Tapping any of them deep-links to the timer screen.
 */

const TIMER_NOTIFICATION_IDS = [
  'timer-running',
  'timer-halfway',
  'timer-5min',
  'timer-complete',
] as const;

export type NotificationPermission =
  | 'granted'
  | 'denied'
  | 'undetermined'
  | 'unavailable';

// expo-notifications is unsupported on web; import lazily and guard.
type NotificationsModule = typeof import('expo-notifications');
let notifications: NotificationsModule | null = null;
function getNotifications(): NotificationsModule | null {
  if (Platform.OS === 'web') return null;
  if (!notifications) {
    // Lazy require: expo-notifications must never load on web.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    notifications = require('expo-notifications') as NotificationsModule;
  }
  return notifications;
}

/**
 * Register the foreground-presentation handler and the tap-to-deep-link
 * listener ONCE at app root (previously this was lazily registered on the
 * first timer use, so early notifications had no handler).
 */
export function initNotificationHandling(
  onOpenTimer: () => void,
): () => void {
  const mod = getNotifications();
  if (!mod) return () => {};
  try {
    mod.setNotificationHandler({
      handleNotification: async () => ({
        shouldPlaySound: true,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
    const sub = mod.addNotificationResponseReceivedListener((response) => {
      const url = response.notification.request.content.data?.url;
      if (url === '/timer') onOpenTimer();
    });
    return () => sub.remove();
  } catch {
    return () => {};
  }
}

export async function getNotificationPermissionStatus(): Promise<NotificationPermission> {
  const mod = getNotifications();
  if (!mod) return 'unavailable';
  try {
    const current = await mod.getPermissionsAsync();
    if (current.granted) return 'granted';
    if (current.canAskAgain) return 'undetermined';
    return 'denied';
  } catch {
    return 'unavailable';
  }
}

export async function ensureNotificationPermission(): Promise<void> {
  const mod = getNotifications();
  if (!mod) return;
  try {
    const current = await mod.getPermissionsAsync();
    if (!current.granted && current.canAskAgain) {
      await mod.requestPermissionsAsync();
    }
  } catch {
    // Permission problems must never break the timer itself.
  }
}

function clockLabel(atMs: number): string {
  return new Date(atMs).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function countdownLabel(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

/**
 * Post the running notification and schedule halfway / 5-min / completion.
 * ALWAYS clears its own ids first (cancel pending + dismiss delivered), so
 * every lifecycle transition is a serialized clear-then-post — a
 * fire-and-forget cancel can never race a fresh post and kill it.
 */
export async function postTimerNotifications(
  taskLabel: string,
  targetAtMs: number,
): Promise<void> {
  const mod = getNotifications();
  if (!mod) return;
  const remainingMs = targetAtMs - Date.now();
  if (remainingMs <= 0) return;
  await cancelTimerNotifications();
  try {
    // Visible immediately on the Lock Screen: absolute end time — the
    // information a glance actually needs, since iOS won't live-count.
    await mod.scheduleNotificationAsync({
      identifier: 'timer-running',
      content: {
        title: `${taskLabel} — timer running`,
        body: `${countdownLabel(remainingMs / 1000)} · ends at ${clockLabel(targetAtMs)}`,
        sound: false,
        data: { url: '/timer' },
      },
      trigger: null,
    });

    if (remainingMs > 2 * 60_000) {
      const halfAtMs = Date.now() + remainingMs / 2;
      await mod.scheduleNotificationAsync({
        identifier: 'timer-halfway',
        content: {
          title: taskLabel,
          body: `${countdownLabel(remainingMs / 2000)} left`,
          sound: false,
          data: { url: '/timer' },
        },
        trigger: {
          type: mod.SchedulableTriggerInputTypes.DATE,
          date: new Date(halfAtMs),
        },
      });
    }

    if (remainingMs > 5.5 * 60_000) {
      await mod.scheduleNotificationAsync({
        identifier: 'timer-5min',
        content: {
          title: taskLabel,
          body: '5:00 left',
          sound: false,
          data: { url: '/timer' },
        },
        trigger: {
          type: mod.SchedulableTriggerInputTypes.DATE,
          date: new Date(targetAtMs - 5 * 60_000),
        },
      });
    }

    await mod.scheduleNotificationAsync({
      identifier: 'timer-complete',
      content: {
        title: 'Time.',
        body: `${taskLabel} — done. Locked in.`,
        sound: true,
        data: { url: '/timer' },
      },
      trigger: {
        type: mod.SchedulableTriggerInputTypes.DATE,
        date: new Date(targetAtMs),
      },
    });
  } catch {
    // Notifications are best-effort; the wall-clock math is the source of truth.
  }
}

/**
 * Cancel + dismiss precisely by identifier — never cancelAll (which would
 * nuke ping/push notifications too). Both calls are needed because they
 * cover different states: cancelScheduledNotificationAsync removes PENDING
 * notifications (halfway / 5-min / completion that haven't fired), while
 * dismissNotificationAsync removes DELIVERED ones from Notification Center
 * (the immediately-posted "timer running" one, and any of the scheduled
 * ones that already fired). Cancelling a scheduled id has no effect on a
 * delivered notification.
 */
export async function cancelTimerNotifications(): Promise<void> {
  const mod = getNotifications();
  if (!mod) return;
  try {
    await Promise.all(
      TIMER_NOTIFICATION_IDS.flatMap((id) => [
        mod.cancelScheduledNotificationAsync(id),
        mod.dismissNotificationAsync(id),
      ]),
    );
  } catch {}
}

/**
 * A2: notification taps that COLD-LAUNCH the app never reach
 * addNotificationResponseReceivedListener — they arrive via
 * getLastNotificationResponseAsync. Call once after the router has mounted.
 * Navigates only when a timer is genuinely active, so a stale response
 * from a previous session can't hijack a normal launch.
 */
export async function handleColdLaunchNotification(
  hasActiveTimer: () => boolean,
  onOpenTimer: () => void,
): Promise<void> {
  const mod = getNotifications();
  if (!mod) return;
  try {
    const response = await mod.getLastNotificationResponseAsync();
    const url = response?.notification.request.content.data?.url;
    if (url === '/timer' && hasActiveTimer()) onOpenTimer();
  } catch {
    // Deep-link recovery is best-effort; a normal launch must never break.
  }
}

let chime: AudioPlayer | null = null;

export function playCompletionEffects(): void {
  if (Platform.OS !== 'web') {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
      () => {},
    );
  }
  try {
    if (!chime) {
      chime = createAudioPlayer(
        require('@/assets/sounds/timer_done.wav'),
      );
    }
    chime.seekTo(0);
    chime.play();
  } catch {
    // No audio device (e.g. headless test runs) — ignore.
  }
}
