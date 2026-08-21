import { HeartbeatIcon as Heartbeat } from 'phosphor-react-native';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { OutlineButton } from '@/components/ui';
import type { HealthWorkout } from '@/services/HealthService';
import type { TaskKey } from '@/data/types';
import { useAppStore } from '@/store/useAppStore';
import { toast } from '@/store/useToastStore';
import { colors, font, radius } from '@/theme/tokens';

/**
 * Inline suggestion when Apple Health recorded a qualifying workout for an
 * incomplete workout task. NEVER auto-completes — the user confirms, and
 * completion goes through the existing path (same XP, feed, streak).
 */
export function WorkoutSuggestion({
  taskKey,
  workout,
}: {
  taskKey: TaskKey;
  workout: HealthWorkout;
}) {
  const completeTask = useAppStore((s) => s.completeTask);
  const consumeHealthWorkout = useAppStore((s) => s.consumeHealthWorkout);
  const time = new Date(workout.startISO).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });

  return (
    <View style={styles.wrap}>
      <Heartbeat size={14} color={colors.accent400} />
      <Text style={styles.text}>
        Apple Health saw a{' '}
        <Text style={styles.emph}>
          {workout.minutes}-min {workout.type}
        </Text>{' '}
        at {time}.
      </Text>
      <OutlineButton
        label="Mark complete"
        small
        onPress={() => {
          completeTask(taskKey);
          // One recorded activity vouches for one task, ever.
          consumeHealthWorkout(workout.startISO);
          toast('+20 XP');
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.accentTint,
    borderWidth: 1,
    borderColor: colors.accent800,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 2,
    marginBottom: 6,
  },
  text: {
    flex: 1,
    fontFamily: font.regular,
    fontSize: 11.5,
    color: colors.neutral300,
    lineHeight: 16,
  },
  emph: {
    fontFamily: font.medium,
    color: colors.text,
  },
});
