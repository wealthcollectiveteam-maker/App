import { FireIcon as Fire } from 'phosphor-react-native';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSheet } from '@/components/BottomSheet';
import { Kicker } from '@/components/ui';
import type { Scenario } from '@/data/types';
import { useAppStore } from '@/store/useAppStore';
import { colors, font, radius } from '@/theme/tokens';

const SCENARIOS: { key: Scenario; label: string; sub: string }[] = [
  { key: 'day1', label: 'Day 1', sub: 'Fresh start. Nothing done yet.' },
  { key: 'day12', label: 'Day 12', sub: 'Mid-run. 4 of 6 today.' },
  { key: 'missed', label: 'Missed day', sub: 'Streak broken banner.' },
  { key: 'day75', label: 'Day 75', sub: 'Challenge complete.' },
];

/**
 * Persistent header: RANKED wordmark (long-press 600ms opens the hidden dev
 * scenario sheet), tier tag, flame chip.
 */
export function AppHeader() {
  const insets = useSafeAreaInsets();
  const tier = useAppStore((s) => s.tier);
  const flame = useAppStore((s) => s.flame);
  const scenario = useAppStore((s) => s.scenario);
  const loadScenario = useAppStore((s) => s.loadScenario);
  const [devOpen, setDevOpen] = useState(false);

  return (
    <View style={[styles.bar, { paddingTop: insets.top + 10 }]}>
      <Pressable
        delayLongPress={600}
        onLongPress={() => setDevOpen(true)}
        hitSlop={8}
      >
        <Text style={styles.wordmark}>
          <Text style={{ color: colors.accent400 }}>R</Text>ANKED
        </Text>
      </Pressable>

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
        <Kicker style={{ marginBottom: 12 }}>Dev — mock scenario</Kicker>
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
    paddingVertical: 11,
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
