import React from 'react';
import { Text } from 'react-native';

import { BottomSheet } from '@/components/BottomSheet';
import { Kicker, OutlineButton } from '@/components/ui';
import { useTimerStore } from '@/store/useTimerStore';
import { colors, font } from '@/theme/tokens';

/** One timer at a time: starting a second asks whether to discard the first. */
export function TimerConflictSheet() {
  const conflict = useTimerStore((s) => s.conflict);
  const active = useTimerStore((s) => s.active);
  const resolveConflict = useTimerStore((s) => s.resolveConflict);

  return (
    <BottomSheet visible={!!conflict} onClose={() => resolveConflict(false)}>
      <Kicker style={{ marginBottom: 10 }}>Timer already running</Kicker>
      <Text
        style={{
          fontFamily: font.regular,
          fontSize: 13.5,
          color: colors.neutral300,
          lineHeight: 19,
          marginBottom: 16,
        }}
      >
        {active?.label} is still on the clock. Discard it and start{' '}
        {conflict?.label}?
      </Text>
      <OutlineButton
        label="Discard and start new"
        onPress={() => resolveConflict(true)}
        style={{ marginBottom: 8 }}
      />
      <OutlineButton
        label="Keep current timer"
        tone="neutral"
        onPress={() => resolveConflict(false)}
      />
    </BottomSheet>
  );
}
