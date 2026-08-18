import { FireIcon as Fire } from 'phosphor-react-native';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSheet } from '@/components/BottomSheet';
import { Kicker, SegmentedControl } from '@/components/ui';
import type { Scenario, Tier } from '@/data/types';
import { useAppStore, type ScreenStateKind } from '@/store/useAppStore';
import { colors, font, radius } from '@/theme/tokens';

const SCENARIOS: { key: Scenario; label: string; sub: string }[] = [
  { key: 'day1', label: 'Day 1', sub: 'Fresh start. Nothing done yet.' },
  { key: 'day12', label: 'Day 12', sub: 'Mid-run. Partial progress today.' },
  { key: 'missed', label: 'Missed day', sub: 'Streak broken banner.' },
  { key: 'day75', label: 'Day 75', sub: 'Challenge complete.' },
];

const TIER_SEGMENTS = ['HARD', 'MEDIUM', 'SOFT'];
const STATE_SEGMENTS = ['READY', 'LOADING', 'ERROR'];

/**
 * Persistent header: RANKED wordmark (long-press 600ms opens the hidden dev
 * scenario sheet), tier tag, flame chip. The long-press runs through
 * react-native-gesture-handler so it works with touch and mouse alike.
 */
export function AppHeader() {
  const insets = useSafeAreaInsets();
  const tier = useAppStore((s) => s.tier);
  const flame = useAppStore((s) => s.flame);
  const scenario = useAppStore((s) => s.scenario);
  const squad = useAppStore((s) => s.squad);
  const screenState = useAppStore((s) => s.screenState);
  const loadScenario = useAppStore((s) => s.loadScenario);
  const setTier = useAppStore((s) => s.setTier);
  const setScreenState = useAppStore((s) => s.setScreenState);
  const leaveSquad = useAppStore((s) => s.leaveSquad);
  const joinSquad = useAppStore((s) => s.joinSquad);
  const healthSimulated = useAppStore((s) => s.healthSimulated);
  const toggleHealthSimulation = useAppStore((s) => s.toggleHealthSimulation);
  const [devOpen, setDevOpen] = useState(false);

  const openDev = () => setDevOpen(true);

  const longPress = Gesture.LongPress()
    .minDuration(600)
    .onStart(() => {
      'worklet';
      runOnJS(openDev)();
    });

  return (
    <View style={[styles.bar, { paddingTop: insets.top + 10 }]}>
      <GestureDetector gesture={longPress}>
        <View>
          <Text style={styles.wordmark} selectable={false}>
            <Text style={{ color: colors.accent400 }}>R</Text>ANKED
          </Text>
        </View>
      </GestureDetector>

      <View style={styles.right}>
        <View style={styles.tierTag}>
          <Text style={styles.tierText}>{tier}</Text>
        </View>
        <View style={styles.flameChip}>
          <Fire
            size={13}
            weight={flame > 0 ? 'fill' : 'regular'}
            color={flame > 0 ? colors.accent400 : colors.neutral700}
          />
          <Text
            style={[
              styles.flameText,
              { color: flame > 0 ? colors.neutral200 : colors.neutral600 },
            ]}
          >
            {flame}
          </Text>
        </View>
      </View>

      <BottomSheet visible={devOpen} onClose={() => setDevOpen(false)}>
        <Kicker style={{ marginBottom: 10 }}>Dev — mock scenario</Kicker>
        {SCENARIOS.map((s) => {
          const active = s.key === scenario;
          return (
            <Pressable
              key={s.key}
              onPress={() => {
                loadScenario(s.key);
                setDevOpen(false);
              }}
              style={[styles.scenarioRow, active && styles.scenarioRowActive]}
            >
              <Text style={styles.scenarioLabel}>{s.label}</Text>
              <Text style={styles.scenarioSub}>{s.sub}</Text>
            </Pressable>
          );
        })}

        <Kicker style={{ marginTop: 14, marginBottom: 8 }}>Tier</Kicker>
        <SegmentedControl
          segments={TIER_SEGMENTS}
          value={tier.toUpperCase()}
          onChange={(v) => setTier(v.toLowerCase() as Tier)}
        />

        <Kicker style={{ marginTop: 14, marginBottom: 8 }}>
          Screen state
        </Kicker>
        <SegmentedControl
          segments={STATE_SEGMENTS}
          value={screenState.toUpperCase()}
          onChange={(v) => setScreenState(v.toLowerCase() as ScreenStateKind)}
        />

        <Pressable
          onPress={() => {
            if (squad) {
              leaveSquad();
            } else {
              joinSquad('K7X2FD');
            }
            setDevOpen(false);
          }}
          style={[styles.scenarioRow, { marginTop: 14 }]}
        >
          <Text style={styles.scenarioLabel}>
            {squad ? 'Switch to solo mode' : 'Rejoin squad'}
          </Text>
          <Text style={styles.scenarioSub}>
            {squad
              ? 'Drop the squad to QA solo states.'
              : 'Restore the mock squad.'}
          </Text>
        </Pressable>

        <Pressable
          onPress={() => {
            toggleHealthSimulation();
            setDevOpen(false);
          }}
          style={styles.scenarioRow}
        >
          <Text style={styles.scenarioLabel}>
            {healthSimulated
              ? 'Disable simulated Health data'
              : 'Simulate Health data'}
          </Text>
          <Text style={styles.scenarioSub}>
            {healthSimulated
              ? 'Back to real HealthKit (or none on web).'
              : 'Fake dietary energy, weight and a 47-min workout for QA.'}
          </Text>
        </Pressable>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
    backgroundColor: colors.bg,
  },
  wordmark: {
    fontFamily: font.medium,
    fontSize: 19,
    letterSpacing: 4.18, // .22em
    color: colors.text,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  tierTag: {
    backgroundColor: colors.accent800,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  tierText: {
    fontFamily: font.medium,
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.accent100,
  },
  flameChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  flameText: {
    fontFamily: font.medium,
    fontSize: 11.5,
  },
  scenarioRow: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    marginBottom: 4,
  },
  scenarioRowActive: {
    backgroundColor: colors.accent900,
  },
  scenarioLabel: {
    fontFamily: font.medium,
    fontSize: 14,
    color: colors.text,
  },
  scenarioSub: {
    fontFamily: font.regular,
    fontSize: 12,
    color: colors.neutral500,
    marginTop: 2,
  },
});
