import { Tabs } from 'expo-router';
import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppHeader } from '@/components/AppHeader';
import { TimerMiniBar } from '@/components/TimerMiniBar';
import { colors, font, microTracking } from '@/theme/tokens';

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
  // On web the browser owns this value: see the [data-safe-bottom] rule in
  // +html.tsx. The 10 here is the same floor that rule starts from, so if the
  // stylesheet ever fails to apply the bar still clears the bottom edge — and
  // because CSS OVERRIDES this property rather than adding to it, the inset
  // can never be counted twice.
  const paddingBottom =
    Platform.OS === 'web' ? 10 : Math.max(insets.bottom, 10);
  return (
    <>
      <TimerMiniBar />
      <View
        {...({ dataSet: { safeBottom: '' } } as object)}
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
