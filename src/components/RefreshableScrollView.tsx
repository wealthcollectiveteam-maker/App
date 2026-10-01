import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type ScrollViewProps,
} from 'react-native';

import { isLiveBackend } from '@/services';
import { useAppStore } from '@/store/useAppStore';
import { colors } from '@/theme/tokens';

/**
 * A ScrollView that can be pulled to refetch server data.
 *
 * WHY THIS IS NOT JUST <ScrollView refreshControl={...} />:
 * react-native-web's RefreshControl is a stub. It destructures `onRefresh`,
 * `refreshing`, `tintColor` and the rest off its props and then renders a
 * bare <View> with none of them — so on web the prop compiles, type-checks,
 * renders, and does absolutely nothing. This app's users are on a Home
 * Screen web app, which is precisely where there is no reload button and
 * precisely where that stub would have left them. So web gets a real
 * gesture, implemented here, and native keeps the platform control.
 *
 * The web gesture: a drag that starts with the scroller already at the top
 * and pulls down past PULL_THRESHOLD runs the refetch. The indicator tracks
 * the finger at half rate so the pull feels resisted rather than free, and
 * the spinner stays up until the refetch has actually resolved — a pull that
 * snaps back instantly means the reads were that fast, never that the
 * gesture was dropped.
 *
 * Nothing polls. On a five-person squad a timer would spend battery all day
 * waiting for an event that happens twice a week; foregrounding the app
 * refetches too (see the AppState listener in app/_layout.tsx).
 *
 * With no live backend there is no gesture and no control at all: a mock
 * build has no server to ask, and a spinner that "worked" without refetching
 * anything is the UI claiming something that did not happen.
 */

const PULL_THRESHOLD = 64;
const MAX_PULL = 96;
/** Finger travel is halved, so the pull reads as resisted. */
const DRAG_RATE = 0.5;

export function RefreshableScrollView({
  children,
  ...props
}: ScrollViewProps & { children?: ReactNode }) {
  const refreshFromServer = useAppStore((s) => s.refreshFromServer);
  const [refreshing, setRefreshing] = useState(false);
  const [pull, setPull] = useState(0);
  const scrollRef = useRef<ScrollView | null>(null);
  // Read inside the DOM handlers, which are registered once.
  const busy = useRef(false);

  const run = useCallback(() => {
    if (busy.current) return;
    busy.current = true;
    setRefreshing(true);
    refreshFromServer().finally(() => {
      busy.current = false;
      setRefreshing(false);
      setPull(0);
    });
  }, [refreshFromServer]);

  useEffect(() => {
    if (Platform.OS !== 'web' || !isLiveBackend) return;
    const instance = scrollRef.current as unknown as {
      getScrollableNode?: () => HTMLElement;
    } | null;
    const node = instance?.getScrollableNode?.();
    if (!node) return;

    let startY: number | null = null;
    let travel = 0;

    const onStart = (e: TouchEvent) => {
      // Only a drag that begins at the very top is a pull-to-refresh. Any
      // other one is an ordinary scroll and must stay one.
      if (busy.current || node.scrollTop > 0) return;
      startY = e.touches[0]?.clientY ?? null;
      travel = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (startY == null) return;
      const dy = (e.touches[0]?.clientY ?? startY) - startY;
      if (dy <= 0) {
        travel = 0;
        setPull(0);
        return;
      }
      travel = Math.min(dy * DRAG_RATE, MAX_PULL);
      setPull(travel);
      // Stops iOS rubber-banding the whole page behind the app while the
      // pull is in progress. Registered non-passive so this is allowed.
      if (e.cancelable) e.preventDefault();
    };
    const onEnd = () => {
      if (startY == null) return;
      startY = null;
      if (travel >= PULL_THRESHOLD) run();
      else setPull(0);
      travel = 0;
    };

    node.addEventListener('touchstart', onStart, { passive: true });
    node.addEventListener('touchmove', onMove, { passive: false });
    node.addEventListener('touchend', onEnd, { passive: true });
    node.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      node.removeEventListener('touchstart', onStart);
      node.removeEventListener('touchmove', onMove);
      node.removeEventListener('touchend', onEnd);
      node.removeEventListener('touchcancel', onEnd);
    };
  }, [run]);

  const showIndicator = refreshing || pull > 0;

  return (
    <View style={styles.wrap}>
      {Platform.OS === 'web' && isLiveBackend && showIndicator && (
        <View
          pointerEvents="none"
          style={[
            styles.indicator,
            { transform: [{ translateY: refreshing ? PULL_THRESHOLD : pull }] },
          ]}
        >
          <ActivityIndicator
            color={colors.accent400}
            animating={refreshing || pull >= PULL_THRESHOLD}
          />
        </View>
      )}
      <ScrollView
        ref={scrollRef}
        {...props}
        refreshControl={
          Platform.OS === 'web' || !isLiveBackend ? undefined : (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={run}
              tintColor={colors.accent400}
              colors={[colors.accent]}
              progressBackgroundColor={colors.surface}
            />
          )
        }
      >
        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  indicator: {
    position: 'absolute',
    top: -28,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 2,
  },
});
