import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  useFonts,
} from '@expo-google-fonts/inter';
import { Stack, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { TimerConflictSheet } from '@/components/TimerConflictSheet';
import { ToastHost } from '@/components/ToastHost';
import {
  handleColdLaunchNotification,
  initNotificationHandling,
} from '@/services/timerEffects';
import { useAppStore } from '@/store/useAppStore';
import { remainingSeconds, useTimerStore } from '@/store/useTimerStore';
import { colors } from '@/theme/tokens';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const router = useRouter();
  const [loaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
  });

  useEffect(() => {
    if (loaded) SplashScreen.hideAsync();
  }, [loaded]);

  // Notification handler + tap-to-deep-link, registered ONCE at app root
  // (not lazily on first timer use).
  useEffect(() => {
    const unsubscribe = initNotificationHandling(() => router.push('/timer'));
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Timer: rehydrate on cold launch, recompute on foreground. If the target
  // time passed while backgrounded or killed, complete the task now.
  // Health readings refresh on launch and foreground (on-device only).
  useEffect(() => {
    useTimerStore
      .getState()
      .hydrate()
      .then(() =>
        // A2: a notification tap that cold-launched the app arrives via the
        // last-response API, not the live listener. Router is mounted by
        // now (post-mount effect), and hydrate() ran first so "is a timer
        // active" is answerable.
        handleColdLaunchNotification(
          () => useTimerStore.getState().active != null,
          () => router.push('/timer'),
        ),
      )
      .catch(() => {});
    useAppStore.getState().hydratePersisted().catch(() => {});
    useAppStore.getState().refreshHealth().catch(() => {});
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      const { active, completeActive } = useTimerStore.getState();
      if (active && !active.pausedAtISO && remainingSeconds(active) <= 0) {
        completeActive();
      }
      useAppStore.getState().refreshHealth().catch(() => {});
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!loaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.bg },
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="celebration"
            options={{ presentation: 'transparentModal', animation: 'fade' }}
          />
          <Stack.Screen
            name="finish"
            options={{ presentation: 'transparentModal', animation: 'fade' }}
          />
          <Stack.Screen
            name="timer"
            options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }}
          />
        </Stack>
        <ToastHost />
        <TimerConflictSheet />
      </View>
    </GestureHandlerRootView>
  );
}
