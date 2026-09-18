import { useRouter } from 'expo-router';
import { TimerIcon as Timer } from 'phosphor-react-native';
import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { useTimerTick } from '@/hooks/useTimerTick';
import { formatCountdown, useTimerStore } from '@/store/useTimerStore';
import { colors, font, radius, shadows } from '@/theme/tokens';

/**
 * Pinned mini-bar shown above the tab bar while a timer runs: task name,
 * remaining time, tap to return to the timer screen. Toast styling
 * (neutral-900, divider border, shadow-md) but persistent.
 */
export function TimerMiniBar() {
  const active = useTimerStore((s) => s.active);
  const remaining = useTimerTick();
  const router = useRouter();

  if (!active || remaining === null) return null;
  const paused = !!active.pausedAtISO;

  return (
    <Pressable
      onPress={() => router.push('/timer')}
      style={({ pressed, hovered }: any) => [
        styles.bar,
        (hovered || pressed) && { borderColor: colors.accent700 },
      ]}
    >
      <Timer
        size={15}
        weight="fill"
        color={paused ? colors.neutral500 : colors.accent400}
      />
      <Text style={styles.label} numberOfLines={1}>
        {active.label}
      </Text>
      <Text style={[styles.time, paused && { color: colors.neutral500 }]}>
        {paused ? 'paused' : formatCountdown(remaining)}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    alignSelf: 'center',
    marginBottom: 8,
    backgroundColor: colors.neutral900,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.pill,
    paddingHorizontal: 15,
    paddingVertical: 9,
    maxWidth: 320,
    ...shadows.md,
  },
  label: {
    flexShrink: 1,
    fontFamily: font.medium,
    fontSize: 12.5,
    color: colors.neutral200,
  },
  time: {
    fontFamily: font.medium,
    fontSize: 12.5,
    color: colors.accent300,
    fontVariant: ['tabular-nums'],
  },
});
