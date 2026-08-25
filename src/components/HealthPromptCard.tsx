import { HeartbeatIcon as Heartbeat } from 'phosphor-react-native';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Card, OutlineButton } from '@/components/ui';
import {
  localDateKey,
  selectTasks,
  useAppStore,
} from '@/store/useAppStore';
import { toast } from '@/store/useToastStore';
import { colors, font } from '@/theme/tokens';

/**
 * Apple Health diet prompt. Health data proves logging, not adherence —
 * so this always PROMPTS and the user confirms; nothing auto-completes.
 * Dismissing hides it for the day. (Workout suggestions render inline on
 * the task rows — see WorkoutSuggestion.)
 */
export function HealthPromptCards() {
  const tasks = useAppStore(selectTasks);
  const tasksDone = useAppStore((s) => s.tasksDone);
  const healthPrefs = useAppStore((s) => s.healthPrefs);
  const readings = useAppStore((s) => s.healthReadings);
  const dismissed = useAppStore((s) => s.healthPromptDismissed);
  const dismissHealthPrompt = useAppStore((s) => s.dismissHealthPrompt);
  const completeTask = useAppStore((s) => s.completeTask);

  if (!healthPrefs.healthEnabled) return null;
  const today = localDateKey();

  // Diet: food logged in another app today -> offer to mark diet complete.
  const dietTask = tasks.find((t) => t.key === 'diet');
  if (
    !healthPrefs.dietPromptEnabled ||
    !dietTask ||
    tasksDone.diet ||
    dismissed.diet === today ||
    readings.dietaryKcal == null ||
    readings.dietaryKcal <= 0
  ) {
    return null;
  }

  return (
    <View style={{ gap: 10, marginTop: 12 }}>
      <PromptCard
        text="You logged food in another app today — mark diet complete?"
        onConfirm={() => {
          completeTask('diet');
          toast('+20 XP');
        }}
        onDismiss={() => dismissHealthPrompt('diet')}
      />
    </View>
  );
}

function PromptCard({
  text,
  onConfirm,
  onDismiss,
}: {
  text: string;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  return (
    <Card style={styles.card}>
      <View style={styles.textRow}>
        <Heartbeat size={16} color={colors.accent400} />
        <Text style={styles.text}>{text}</Text>
      </View>
      <View style={styles.actions}>
        <OutlineButton label="Mark complete" small onPress={onConfirm} />
        <OutlineButton
          label="Not now"
          small
          tone="ghost"
          onPress={onDismiss}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: colors.accent800,
  },
  textRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
  },
  text: {
    flex: 1,
    fontFamily: font.regular,
    fontSize: 13,
    color: colors.neutral300,
    lineHeight: 18.5,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
});
