import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';

import { BottomSheet } from '@/components/BottomSheet';
import { Kicker, SegmentedControl } from '@/components/ui';
import type { Scenario, Tier } from '@/data/types';
import { useAppStore, type ScreenStateKind } from '@/store/useAppStore';
import { colors, font, radius } from '@/theme/tokens';

/**
 * The developer scenario sheet — DEV BUILDS ONLY.
 *
 * It jumps the challenge to an arbitrary day, forces a tier, fakes Health
 * data and rolls the day over: every one of those rewrites real challenge
 * state through the same store actions the app uses. Shipped, it was
 * reachable by anyone who long-pressed the wordmark for 600ms.
 *
 * It lives in its own module so AppHeader can reach it through a `__DEV__`
 * guarded require(). `__DEV__` is a compile-time constant, so in a
 * production bundle that branch is dead code and this file is never
 * included — the sheet is ABSENT from the binary, not merely hidden behind
 * a check.
 */

const SCENARIOS: { key: Scenario; label: string; sub: string }[] = [
  { key: 'day1', label: 'Day 1', sub: 'Fresh start. Nothing done yet.' },
  { key: 'day12', label: 'Day 12', sub: 'Mid-run. Partial progress today.' },
  { key: 'missed', label: 'Missed day', sub: 'Streak broken banner.' },
  { key: 'day75', label: 'Day 75', sub: 'Challenge complete.' },
];

const TIER_SEGMENTS = ['HARD', 'MEDIUM', 'SOFT'];
const STATE_SEGMENTS = ['READY', 'LOADING', 'ERROR'];

/**
 * Wraps the wordmark in the 600ms long-press that opens the sheet. Runs
 * through react-native-gesture-handler so it works with touch and mouse
 * alike.
 */
export function DevScenarioSheet({ children }: { children: React.ReactNode }) {
  const scenario = useAppStore((s) => s.scenario);
  const tier = useAppStore((s) => s.tier);
  const squad = useAppStore((s) => s.squad);
  const screenState = useAppStore((s) => s.screenState);
  const loadScenario = useAppStore((s) => s.loadScenario);
  const setTier = useAppStore((s) => s.setTier);
  const setScreenState = useAppStore((s) => s.setScreenState);
  const leaveSquad = useAppStore((s) => s.leaveSquad);
  const joinSquad = useAppStore((s) => s.joinSquad);
  const healthSimulated = useAppStore((s) => s.healthSimulated);
  const toggleHealthSimulation = useAppStore((s) => s.toggleHealthSimulation);
  const advanceDay = useAppStore((s) => s.advanceDay);
  const [open, setOpen] = useState(false);

  const openDev = () => setOpen(true);

  const longPress = Gesture.LongPress()
    .minDuration(600)
    .onStart(() => {
      'worklet';
      runOnJS(openDev)();
    });

  return (
    <>
      <GestureDetector gesture={longPress}>
        <View>{children}</View>
      </GestureDetector>

      <BottomSheet visible={open} onClose={() => setOpen(false)}>
        <Kicker style={{ marginBottom: 10 }}>Dev — mock scenario</Kicker>
        {SCENARIOS.map((s) => {
          const active = s.key === scenario;
          return (
            <Pressable
              key={s.key}
              onPress={() => {
                loadScenario(s.key);
                setOpen(false);
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

        <Kicker style={{ marginTop: 14, marginBottom: 8 }}>Screen state</Kicker>
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
            setOpen(false);
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
            advanceDay();
            setOpen(false);
          }}
          style={styles.scenarioRow}
        >
          <Text style={styles.scenarioLabel}>Advance day (rollover)</Text>
          <Text style={styles.scenarioSub}>
            Simulate local midnight: pending task edits take effect.
          </Text>
        </Pressable>

        <Pressable
          onPress={() => {
            toggleHealthSimulation();
            setOpen(false);
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
    </>
  );
}

const styles = StyleSheet.create({
  scenarioRow: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    marginBottom: 4,
  },
  scenarioRowActive: {
    backgroundColor: colors.accentDeep,
  },
  scenarioLabel: {
    fontFamily: font.medium,
    fontSize: 14,
    color: colors.textHi,
  },
  scenarioSub: {
    fontFamily: font.regular,
    fontSize: 12,
    color: colors.textMid,
    marginTop: 2,
  },
});
