import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/**
 * Side effects for the workout timer: local notifications (native only —
 * they fire even if the app never returns to the foreground), success
 * haptics, and a completion chime that respects the device silent switch
 * (expo-audio's default iOS audio mode does not play in silent mode).
 */

// expo-notifications is unsupported on web; import lazily and guard.
type NotificationsModule = typeof import('expo-notifications');
let notifications: NotificationsModule | null = null;
function getNotifications(): NotificationsModule | null {
  if (Platform.OS === 'web') return null;
  if (!notifications) {
    // Lazy require: expo-notifications must never load on web.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    notifications = require('expo-notifications') as NotificationsModule;
    notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldPlaySound: true,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
  }
  return notifications;
}

export async function ensureNotificationPermission(): Promise<void> {
  const mod = getNotifications();
  if (!mod) return;
  try {
    const current = await mod.getPermissionsAsync();
    if (!current.granted) await mod.requestPermissionsAsync();
  } catch {
    // Permission problems must never break the timer itself.
  }
}

/** Schedule the "time's up" notification for the target wall-clock time. */
export async function scheduleCompletionNotification(
  taskLabel: string,
  targetAtMs: number,
): Promise<void> {
  const mod = getNotifications();
  if (!mod) return;
  try {
    await mod.cancelAllScheduledNotificationsAsync();
    if (targetAtMs <= Date.now()) return;
    await mod.scheduleNotificationAsync({
      content: {
        title: 'Time.',
        body: `${taskLabel} — done. Locked in.`,
        sound: true,
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

export async function cancelCompletionNotification(): Promise<void> {
  const mod = getNotifications();
  if (!mod) return;
  try {
    await mod.cancelAllScheduledNotificationsAsync();
  } catch {}
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
