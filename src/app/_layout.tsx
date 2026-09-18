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
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { MockModeBanner } from '@/components/MockModeBanner';
import {
  SessionErrorScreen,
  SessionLoadingScreen,
  UnconfiguredBuildScreen,
} from '@/components/SessionGate';
import { TimerConflictSheet } from '@/components/TimerConflictSheet';
import { ToastHost } from '@/components/ToastHost';
import { UpdateBanner } from '@/components/UpdateBanner';
import { cleanUpdateParamFromUrl } from '@/lib/webUpdate';
import { scheduleDayBoundaries } from '@/lib/writeDay';
import { configurationError } from '@/services';
import {
  handleColdLaunchNotification,
  initNotificationHandling,
} from '@/services/timerEffects';
import { useAppStore } from '@/store/useAppStore';
import { useSessionStore } from '@/store/useSessionStore';
import { useUpdateStore } from '@/store/useUpdateStore';
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

  // IS THERE A NEWER BUILD? Cold start half of the pair; the foreground half
  // rides the AppState listener below. Nothing polls.
  useEffect(() => {
    useUpdateStore.getState().check().catch(() => {});
  }, []);

  // Belt to the inline script's braces. `?v=` is already gone before this
  // component exists (see the strip in +html.tsx, and why it has to run
  // there) — but the router rewrites the address on every navigation, and a
  // build hash in a shared link is the kind of thing that comes back. Keyed
  // on the route so any navigation that reintroduced it is undone; a no-op
  // when there is nothing to strip, which is essentially always.
  useEffect(() => {
    cleanUpdateParamFromUrl();
  }, [route]);

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
      // Refetch on foreground. On web this listener IS the visibilitychange
      // event — react-native-web's AppState is built on it — so returning to
      // a Home Screen web app lands here.
      //
      // This refreshed only the day, which fixed an app left open across
      // local midnight but left the squad frozen: a member who joined, or a
      // squadmate who ticked a task, stayed invisible until a force-quit, and
      // a standalone web app has no reload button to fall back on. It now
      // re-reads everything the server owns.
      //
      // Event-driven, never polled: a timer would spend battery all day on a
      // five-person squad. Silent on failure — the mirror keeps what it has
      // rather than degrading to an empty day 1.
      if (useSessionStore.getState().status === 'signedIn') {
        useAppStore.getState().refreshFromServer().catch(() => {});
      }
      // Same event, second question: is the BUILD stale as well as the data?
      // iOS resumes an installed web app rather than re-fetching it, so this
      // is often the only moment the app touches the network at all. Not
      // gated on being signed in — an out-of-date auth screen needs the fix
      // as much as an out-of-date Home does.
      useUpdateStore.getState().check().catch(() => {});
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // THE DAY BOUNDARIES (Phase 20, P2; noon added in Phase 24). The two
  // moments a day window goes stale with nobody touching the app: MIDNIGHT,
  // when today rolls and yesterday opens, and NOON, when yesterday closes.
  //
  // The AppState listener above covers the app being reopened; it cannot
  // cover the app being left open. At 12:20 AM on 2026-09-10 that gap was
  // real: the screen was still showing the previous day while the server had
  // already rolled, and thirteen seconds apart two taps landed on one day and
  // eleven on another. Noon is the same gap the other way round — left open,
  // the screen went on offering a yesterday the server had closed.
  //
  // ONE TIMER, NOT A POLL. It fires at whichever boundary comes first,
  // refreshes, and re-arms for the next; see scheduleDayBoundaries() for why
  // a noon fire can only re-arm for midnight. Both boundaries are on the
  // CHALLENGE's wall clock, never the phone's, and the effect re-arms when
  // that zone first arrives from the server. A device asleep through a
  // boundary fires late or not at all; the foreground listener is the
  // backstop for that. What stops a stale window becoming a wrong WRITE is not
  // this timer: every write names the day the screen was showing, and the
  // server refuses it if that day has since closed.
  const challengeTimezone = useAppStore((s) => s.challengeTimezone);
  useEffect(
    () =>
      scheduleDayBoundaries(
        () => challengeTimezone,
        () => {
          if (useSessionStore.getState().status === 'signedIn') {
            useAppStore.getState().refreshFromServer().catch(() => {});
          }
        },
      ),
    [challengeTimezone],
  );

  if (!loaded) return null;

  // A production build with no backend credentials never opens onto the app.
  // Mounting the navigator at all would put a fully interactive challenge on
  // screen with nothing behind it — see services/index.ts.
  if (configurationError) {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: colors.bg }}>
            <StatusBar style="light" />
            {/* The one screen where an update is not a nicety but the only
                exit: this build cannot reach a backend, and a redeploy is
                the whole fix. */}
            <UpdateBanner />
            <UnconfiguredBuildScreen />
          </View>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    );
  }

  /**
   * ONE safe-area provider, at the root, above every navigator.
   *
   * There was none. Every navigator fell back to its own
   * SafeAreaProviderCompat, so the tab navigator, the stack screens outside
   * it (auth, settings, timer, the modals) and each modal measured the insets
   * SEPARATELY — and on web each of those starts at zero for SSR and only
   * learns the real value once its own hidden probe element is measured. That
   * is how one part of the app can reserve room for the home indicator while
   * another lays out as though it is not there. With a provider here,
   * SafeAreaProviderCompat finds insets already in context and reuses them
   * instead of creating a second source of truth.
   */
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider style={{ flex: 1 }}>
        <View style={{ flex: 1, backgroundColor: colors.bg }}>
          <StatusBar style="light" />
          {/* In flow, above the navigator: a build silently running on mock
              data is indistinguishable from a working one until data is lost. */}
          <MockModeBanner />
          {/* Also in flow, for the same reason — it must never cover a header,
              a tab or the bar. Renders nothing unless an update is waiting. */}
          <UpdateBanner />
          {/* The gate overlay covers THIS view, not the whole app, so it stops
              at the banner above it. Deliberate: "couldn't reach the server"
              is exactly the state a user can be stuck in on a bad build, and
              the update banner is the only control that can get them out of
              it. An overlay that hid it would hide the fix. */}
          <View style={{ flex: 1 }}>
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
          </View>
          <ToastHost />
          <TimerConflictSheet />
        </View>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
