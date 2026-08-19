import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  useFonts,
} from '@expo-google-fonts/inter';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { TimerConflictSheet } from '@/components/TimerConflictSheet';
import { ToastHost } from '@/components/ToastHost';
import { useAppStore } from '@/store/useAppStore';
import { remainingSeconds, useTimerStore } from '@/store/useTimerStore';
import { colors } from '@/theme/tokens';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
  });

  useEffect(() => {
    if (loaded) SplashScreen.hideAsync();
  }, [loaded]);

  // Timer: rehydrate on cold launch, recompute on foreground. If the target
  // time passed while backgrounded or killed, complete the task now.
  // Health readings refresh on launch and foreground (on-device only).
  useEffect(() => {
    useTimerStore.getState().hydrate();
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
