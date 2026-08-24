import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';

import { BottomSheet } from '@/components/BottomSheet';
import { Kicker, SegmentedControl } from '@/components/ui';
import type { Scenario, Tier } from '@/data/types';
import { isLiveBackend } from '@/services';
import {
  isSimulationEnabled,
  runSimulation,
  type SimScenario,
} from '@/services/backend/devSimulation';
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
 * ON A LIVE BACKEND the scenarios go through devSimulation.ts, which calls
 * owner-scoped RPCs that write real rows. They did nothing at all before
 * that: they were written for MockDataService and none survived the switch,
 * which is why the Day 75 finish screen had been unreachable and untestable
 * for eleven weeks. On the mock they keep the old in-memory path.
 *
 * It lives in its own module so AppHeader can reach it through a `__DEV__`
 * guarded require(). `__DEV__` is a compile-time constant, so in a
 * production bundle that branch is dead code and this file is never
 * included — the sheet is ABSENT from the binary, not merely hidden behind
 * a check.
 */

/**
 * `liveSub` describes what the simulation ACTUALLY does on a real backend,
 * because that is what will happen. A day counter reading 12 over an empty
 * Wall and a zero streak is not a simulation of day 12.
 */
const SCENARIOS: {
  key: Scenario;
  sim: SimScenario;
  label: string;
  sub: string;
  liveSub: string;
}[] = [
  {
    key: 'day1',
    sim: 'day1',
    label: 'Day 1 - fresh start',
    sub: 'Fresh start. Nothing done yet.',
    liveSub:
      'Ends this challenge and DELETES the simulated history. The undo for everything below.',
  },
  {
    key: 'day12',
    sim: 'day12',
    label: 'Day 12',
    sub: 'Mid-run. Partial progress today.',
    liveSub: 'Days 1-11 sealed with every task done, flame 11. Today untouched.',
  },
  {
    key: 'missed',
    sim: 'missed',
    label: 'Missed day',
    sub: 'Streak broken banner.',
    liveSub: 'Runs the real midnight evaluation on yesterday. Hard restarts.',
  },
  {
    key: 'day75',
    sim: 'day75',
    label: 'Day 75, complete',
    sub: 'Challenge complete.',
    liveSub:
      'All 75 days sealed and today done, so the finish screen is reachable.',
  },
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
  const [simEnabled, setSimEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  // Checked when the sheet opens rather than on mount: the answer is a round
  // trip, and it changes only when someone edits sim_allowed_users by hand.
  useEffect(() => {
    if (!open || !isLiveBackend) return;
    isSimulationEnabled().then(setSimEnabled, () => setSimEnabled(false));
  }, [open]);

  const openDev = () => setOpen(true);

  /**
   * On a live backend a scenario is a server round trip, so the sheet stays
   * open until it lands. Closing it immediately is what let the old dead
   * buttons look as though they had worked.
   */
  const run = async (row: (typeof SCENARIOS)[number]) => {
    if (!isLiveBackend) {
      loadScenario(row.key);
      setOpen(false);
      return;
    }
    setBusy(true);
    await runSimulation(row.sim);
    setBusy(false);
    setOpen(false);
  };

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
        <Kicker style={{ marginBottom: 10 }}>
          {isLiveBackend ? 'Dev — live simulation' : 'Dev — mock scenario'}
        </Kicker>
        {isLiveBackend ? (
          <Text style={styles.warning}>
            {simEnabled === false
              ? 'This account is not in sim_allowed_users, so every scenario below will be refused.'
              : 'These write real rows to the real database, and a simulated completion is indistinguishable from a real one. Use a throwaway account.'}
          </Text>
        ) : null}
        {SCENARIOS.map((s) => {
          const active = !isLiveBackend && s.key === scenario;
          return (
            <Pressable
              key={s.key}
              disabled={busy}
              onPress={() => {
                run(s);
              }}
              style={[
                styles.scenarioRow,
                active && styles.scenarioRowActive,
                busy && styles.scenarioRowBusy,
              ]}
            >
              <Text style={styles.scenarioLabel}>{s.label}</Text>
              <Text style={styles.scenarioSub}>
                {isLiveBackend ? s.liveSub : s.sub}
              </Text>
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
          disabled={busy}
          onPress={() => {
            if (!isLiveBackend) {
              advanceDay();
              setOpen(false);
              return;
            }
            setBusy(true);
            runSimulation('advance').finally(() => {
              setBusy(false);
              setOpen(false);
            });
          }}
          style={[styles.scenarioRow, busy && styles.scenarioRowBusy]}
        >
          <Text style={styles.scenarioLabel}>Advance day (rollover)</Text>
          <Text style={styles.scenarioSub}>
            {isLiveBackend
              ? 'Winds the start date back a day, sealing today as done. Pending edits take effect.'
              : 'Simulate local midnight: pending task edits take effect.'}
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
  scenarioRowBusy: {
    opacity: 0.5,
  },
  warning: {
    fontFamily: font.regular,
    fontSize: 11,
    lineHeight: 15,
    color: colors.textMid,
    marginBottom: 10,
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
