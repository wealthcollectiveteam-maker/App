import { HeartbeatIcon as Heartbeat } from 'phosphor-react-native';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { OutlineButton } from '@/components/ui';
import type { TaskKey } from '@/data/types';
import type { HealthSuggestion as Suggestion } from '@/lib/healthLinks';
import { useAppStore } from '@/store/useAppStore';
import { toast } from '@/store/useToastStore';
import { colors, font, radius } from '@/theme/tokens';

/**
 * Inline suggestion under a task when Apple Health vouches for it (Phase 38N;
 * the workout-only version was Phase 9's WorkoutSuggestion). The line names
 * what Health saw and which device wrote it. NEVER auto-completes — the user
 * confirms, and completion goes through completeTask, the same path as a
 * swipe: same XP, feed row, streak and haptic. "Not now" hides it for the
 * rest of the day.
 *
 * Nothing here is a grade. A rule that was not met produces no line at all
 * (lib/healthLinks.ts), so this component only ever says something was done.
 */
export function HealthSuggestionRow({
  taskKey,
  suggestion,
}: {
  taskKey: TaskKey;
  suggestion: Suggestion;
}) {
  const completeTask = useAppStore((s) => s.completeTask);
  const consumeHealthWorkout = useAppStore((s) => s.consumeHealthWorkout);
  const dismissHealthPrompt = useAppStore((s) => s.dismissHealthPrompt);

  return (
    <View style={styles.wrap}>
      <Heartbeat size={14} color={colors.accent400} />
      <Text style={styles.text}>{suggestion.text}</Text>
      <View style={styles.actions}>
        <OutlineButton
          label="Mark complete"
          small
          onPress={() => {
            completeTask(taskKey);
            // One recorded activity vouches for one task, ever.
            if (suggestion.workoutStartISO) consumeHealthWorkout(suggestion.workoutStartISO);
            toast('+20 XP');
          }}
        />
        <OutlineButton
          label="Not now"
          small
          tone="ghost"
          onPress={() => dismissHealthPrompt(taskKey)}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
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
    minWidth: 120,
    fontFamily: font.regular,
    fontSize: 11.5,
    color: colors.neutral300,
    lineHeight: 16,
  },
  actions: {
    flexDirection: 'row',
    gap: 6,
  },
});
