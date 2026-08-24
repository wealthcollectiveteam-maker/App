import { InstrumentSerif_400Regular_Italic } from '@expo-google-fonts/instrument-serif';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_900Black,
  Inter_900Black_Italic,
  useFonts,
} from '@expo-google-fonts/inter';
import * as Linking from 'expo-linking';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { MockModeBanner } from '@/components/MockModeBanner';
import {
  SessionErrorScreen,
  SessionLoadingScreen,
  UnconfiguredBuildScreen,
} from '@/components/SessionGate';
import { TimerConflictSheet } from '@/components/TimerConflictSheet';
import { ToastHost } from '@/components/ToastHost';
import { configurationError } from '@/services';
import {
  handleColdLaunchNotification,
  initNotificationHandling,
} from '@/services/timerEffects';
import { useAppStore } from '@/store/useAppStore';
import { useSessionStore } from '@/store/useSessionStore';
import { remainingSeconds, useTimerStore } from '@/store/useTimerStore';
import { colors } from '@/theme/tokens';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const router = useRouter();
  const segments = useSegments();
  const route = segments.join('/');
  // Two families. Inter carries every structural weight; Instrument Serif
  // Italic is loaded for quotes and descriptors only.
  const [loaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_900Black,
    Inter_900Black_Italic,
    InstrumentSerif_400Regular_Italic,
  });

  const status = useSessionStore((s) => s.status);
  const booted = useSessionStore((s) => s.booted);

  const inAuthRoute = segments[0] === 'auth';
  const needsAuth = status === 'signedOut' || status === 'setup';
  // "Settled" = the route on screen matches what the session allows. Until
  // it does, the gate overlay covers the navigator, so nobody ever sees a
  // frame of empty tabs before the redirect lands.
  const settled = status === 'error' || (needsAuth ? inAuthRoute : !inAuthRoute);
  // Anything but a decided session, on the route that session allows.
  const gating = !booted || status === 'loading' || !settled;

  // Session gate. Resolving a stored session is the FIRST thing that
  // happens: hydrate(userId) has to run before the tabs read the mirror,
  // otherwise every screen renders an empty day 1 for a real account.
  useEffect(() => {
    if (configurationError) return; // nothing to sign in to — see below
    useSessionStore.getState().bootstrap().catch(() => {});
  }, []);

  useEffect(() => {
    if (!loaded || !booted) return; // never navigate before the Stack mounts
    if (needsAuth && !inAuthRoute) router.replace('/auth');
    else if (status === 'signedIn' && inAuthRoute) router.replace('/');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, booted, status, needsAuth, inAuthRoute, route]);

  // The splash goes as soon as the fonts are there. It must NOT wait on the
  // session: a request that hangs rather than fails would hold a frozen
  // splash screen with nothing to look at. The gate overlay covers the rest.
  useEffect(() => {
    if (loaded) SplashScreen.hideAsync().catch(() => {});
  }, [loaded]);

  // The emailed sign-in link arriving at a RUNNING app. The cold-launch
  // URL is bootstrap()'s job, not this listener's: read here as well, it
  // would race the stored session instead of settling it. Either way the
  // session store is the only thing that acts on a link.
  useEffect(() => {
    const sub = Linking.addEventListener('url', ({ url }) => {
      useSessionStore.getState().handleAuthUrl(url).catch(() => {});
    });
    return () => sub.remove();
  }, []);

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

  // A production build with no backend credentials never opens onto the app.
  // Mounting the navigator at all would put a fully interactive challenge on
  // screen with nothing behind it — see services/index.ts.
  if (configurationError) {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={{ flex: 1, backgroundColor: colors.bg }}>
          <StatusBar style="light" />
          <UnconfiguredBuildScreen />
        </View>
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <StatusBar style="light" />
        {/* In flow, above the navigator: a build silently running on mock
            data is indistinguishable from a working one until data is lost. */}
        <MockModeBanner />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.bg },
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="auth" options={{ gestureEnabled: false }} />
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
        {/* Over the navigator, never instead of it: unmounting the Stack
            would leave expo-router with nothing to navigate. */}
        {(gating || status === 'error') && (
          <View style={StyleSheet.absoluteFill}>
            {status === 'error' ? <SessionErrorScreen /> : <SessionLoadingScreen />}
          </View>
        )}
        <ToastHost />
        <TimerConflictSheet />
      </View>
    </GestureHandlerRootView>
  );
}
