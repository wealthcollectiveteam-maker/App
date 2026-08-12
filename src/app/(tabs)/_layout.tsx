import { Tabs } from 'expo-router';
import {
  HouseIcon as House,
  LightningIcon as Lightning,
  NotebookIcon as Notebook,
  UserIcon as User,
  UsersThreeIcon as UsersThree,
} from 'phosphor-react-native';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppHeader } from '@/components/AppHeader';
import { colors, font } from '@/theme/tokens';

const ICONS: Record<string, React.ComponentType<any>> = {
  index: House,
  checkin: Lightning,
  track: Notebook,
  squad: UsersThree,
  you: User,
};

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

function TabBar({ state, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const Icon = ICONS[route.name];
        if (!Icon) return null;
        return (
          <Pressable
            key={route.key}
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
            <Icon
              size={22}
              weight={focused ? 'fill' : 'regular'}
              color={focused ? colors.accent400 : colors.neutral600}
            />
            <Text
              style={[
                styles.label,
                { color: focused ? colors.accent300 : colors.neutral600 },
              ]}
            >
              {LABELS[route.name]}
            </Text>
          </Pressable>
        );
      })}
    </View>
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
      <Tabs.Screen name="index" />
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
    borderTopColor: colors.divider,
    paddingTop: 8,
  },
  item: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  label: {
    fontFamily: font.medium,
    fontSize: 8.5,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
});
