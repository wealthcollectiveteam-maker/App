import { Tabs } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppHeader } from '@/components/AppHeader';
import { TimerMiniBar } from '@/components/TimerMiniBar';
import { colors, font, microTracking } from '@/theme/tokens';

/**
 * TEMPORARY — Phase 12B. The on-screen layout diagnostic, reached through the
 * same guarded-require shape the dev scenario sheet uses, so that a build made
 * without the flag does not merely hide it: the module is never required and
 * Metro leaves it out. Delete this, `@/components/LayoutDebug`, and the row in
 * Settings once the tab bar is confirmed on a real iPhone.
 */
const LayoutDebug: typeof import('@/components/LayoutDebug') | null =
  __DEV__ || process.env.EXPO_PUBLIC_LAYOUT_DEBUG === '1'
    ? // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('@/components/LayoutDebug')
    : null;

const LABELS: Record<string, string> = {
  index: 'HOME',
  checkin: 'CHECK-IN',
  track: 'TRACK',
  squad: 'SQUAD',
  you: 'YOU',
};

interface TabBarProps {
  state: { index: number; routes: { key: string; name: string }[] };
  navigation: any;
}

/**
 * Wordmark-set tab bar: labels only, the active one lit and underlined in
 * accent. Icons are gone — the schematics carry the whole bar on type.
 */
function TabBar({ state, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();
  // THE ONLY PLACE the bottom inset is applied, on every platform.
  //
  // Phase 12 had this read 10 on web and let a `!important` CSS rule in
  // +html.tsx supply the real number, because the JS provider was believed to
  // report zero there. With one SafeAreaProvider at the root it does not: the
  // library's probe div is measured synchronously on mount and a first style
  // resolution fires no transition, so this value is the browser's own from
  // the first commit. Two writers of one property is what made the bar
  // unreasonable-about; the CSS rule is gone and this is the survivor,
  // because it is also the only one native can use.
  //
  // max() rather than +: a device with no home indicator reports 0 and still
  // needs the labels off the bottom edge.
  const paddingBottom = Math.max(insets.bottom, 10);
  return (
    <>
      <TimerMiniBar />
      <View
        ref={(node) => LayoutDebug?.captureTabBar(node)}
        style={[styles.bar, { paddingBottom }]}
      >
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const label = LABELS[route.name];
          if (!label) return null;
          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={label}
              onPress={() => {
                const event = navigation.emit({
                  type: 'tabPress',
                  target: route.key,
                  canPreventDefault: true,
                });
                if (!focused && !event.defaultPrevented) {
                  navigation.navigate(route.name);
                }
              }}
              style={styles.item}
            >
              <Text
                style={[
                  styles.label,
                  { color: focused ? colors.accent400 : colors.textLow },
                ]}
                numberOfLines={1}
              >
                {label}
              </Text>
              <View
                style={[
                  styles.rule,
                  { backgroundColor: focused ? colors.accent : 'transparent' },
                ]}
              />
            </Pressable>
          );
        })}
      </View>
    </>
  );
}

export default function TabLayout() {
  return (
    <View style={{ flex: 1 }}>
      <Tabs
        tabBar={(props) => <TabBar {...props} />}
        screenOptions={{
          header: () => <AppHeader />,
          headerShown: true,
          sceneStyle: { backgroundColor: colors.bg },
        }}
      >
        {/* Home is the only screen that carries STREAK beside the tier badge. */}
        <Tabs.Screen
          name="index"
          options={{ header: () => <AppHeader showStreak /> }}
        />
        <Tabs.Screen name="checkin" />
        <Tabs.Screen name="track" />
        <Tabs.Screen name="squad" />
        <Tabs.Screen name="you" />
      </Tabs>
      {/* TEMPORARY — Phase 12B tab-bar diagnostics. Remove with the rest of
          @/components/LayoutDebug once the layout is confirmed on device. */}
      {LayoutDebug ? <LayoutDebug.LayoutDebugOverlay /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: 12,
  },
  item: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 6,
  },
  label: {
    fontFamily: font.semibold,
    fontSize: 10.5,
    letterSpacing: microTracking(10.5),
  },
  rule: {
    height: 2,
    alignSelf: 'stretch',
    marginHorizontal: 10,
  },
});
