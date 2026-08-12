import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import {
  CameraIcon as Camera,
  CheckSquareIcon as CheckSquare,
  SquareIcon as Square,
} from 'phosphor-react-native';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { FlairAvatar } from '@/components/FlairAvatar';
import { ProgressRing } from '@/components/ProgressRing';
import { Card, FadingDivider, Kicker, OutlineButton } from '@/components/ui';
import { TASKS } from '@/data/mock';
import type { Tier } from '@/data/types';
import { selectDoneCount, useAppStore } from '@/store/useAppStore';
import { toast } from '@/store/useToastStore';
import { colors, font, radius, space } from '@/theme/tokens';

const MISSED_COPY: Record<Tier, string> = {
  hard: 'Hard rules: the clock resets. Day 1 — again.',
  medium: 'Streak broken. Day 13 still counts. Lock back in.',
  soft: 'A miss, not a quit. Pick it back up today.',
};

function StatusBanner() {
  const day = useAppStore((s) => s.day);
  const tier = useAppStore((s) => s.tier);
  const missedDay = useAppStore((s) => s.missedDay);
  const dayComplete = useAppStore((s) => s.dayComplete);
  const router = useRouter();

  if (day === 75 && dayComplete) {
    return (
      <LinearGradient
        colors={[colors.celebrationGround, colors.surface]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={styles.day75Card}
      >
        <Kicker color={colors.accent200}>Challenge complete</Kicker>
        <Text style={styles.day75Title}>
          75 days. Every task. Never missed.
        </Text>
        <OutlineButton
          label="See your results"
          onPress={() => router.push('/finish')}
          style={{ marginTop: 14 }}
        />
      </LinearGradient>
    );
  }

  if (missedDay) {
    const copy = MISSED_COPY[tier].replace('Day 13', `Day ${day}`);
    return (
      <Card style={{ borderWidth: 1, borderColor: colors.neutral700 }}>
        <Kicker color={colors.neutral400}>Streak broken</Kicker>
        <Text style={styles.bannerBody}>{copy}</Text>
      </Card>
    );
  }

  if (day === 1) {
    return (
      <Card style={{ borderWidth: 1, borderColor: colors.accent800 }}>
        <Kicker>Day 1 of 75</Kicker>
        <Text style={styles.bannerBody}>It starts now.</Text>
      </Card>
    );
  }

  return null;
}

function TaskRow({ taskKey }: { taskKey: (typeof TASKS)[number]['key'] }) {
  const task = TASKS.find((t) => t.key === taskKey)!;
  const doneAt = useAppStore((s) => s.tasksDone[taskKey]);
  const completeTask = useAppStore((s) => s.completeTask);
  const uncompleteTask = useAppStore((s) => s.uncompleteTask);
  const done = !!doneAt;

  return (
    <Pressable
      onPress={() => {
        if (done) {
          uncompleteTask(taskKey);
        } else {
          completeTask(taskKey);
          toast('+20 XP');
        }
      }}
      style={styles.taskRow}
    >
      {done ? (
        <CheckSquare size={21} weight="fill" color={colors.accent500} />
      ) : (
        <Square size={21} weight="regular" color={colors.neutral600} />
      )}
      <Text
        style={[
          styles.taskLabel,
          done && {
            textDecorationLine: 'line-through',
            color: colors.neutral500,
          },
        ]}
      >
        {task.label}
      </Text>
      {done ? (
        <Text style={styles.taskMeta}>{doneAt}</Text>
      ) : task.proof ? (
        <View style={styles.proofMeta}>
          <Camera size={12} color={colors.neutral600} />
          <Text style={styles.taskMeta}>proof optional</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function SquadSnapshot() {
  const squad = useAppStore((s) => s.squad);
  const router = useRouter();

  return (
    <Pressable onPress={() => router.navigate('/squad')}>
      <Card>
        <View style={styles.snapshotHeader}>
          <Kicker>{squad.name} — Squad</Kicker>
          <Text style={styles.snapshotStreak}>
            {squad.streak}-day squad streak
          </Text>
        </View>
        <View style={styles.snapshotRow}>
          {squad.members.map((m) => (
            <View key={m.id} style={{ alignItems: 'center', gap: 5 }}>
              <FlairAvatar initials={m.initials} level={m.level} size={36} />
              <Text style={styles.snapshotCount}>{m.doneToday} of 6</Text>
            </View>
          ))}
        </View>
      </Card>
    </Pressable>
  );
}

export default function HomeScreen() {
  const day = useAppStore((s) => s.day);
  const why = useAppStore((s) => s.why);
  const dayComplete = useAppStore((s) => s.dayComplete);
  const doneCount = useAppStore(selectDoneCount);
  const router = useRouter();
  const allDone = doneCount === 6;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={styles.content}
    >
      <StatusBanner />

      <View style={{ alignItems: 'center', marginTop: 18 }}>
        <ProgressRing day={day} />
        <Text style={styles.todayCount}>{doneCount} OF 6 TODAY</Text>
        <Text style={styles.why}>{'\u201C'}{why}{'\u201D'}</Text>
      </View>

      <FadingDivider style={{ marginVertical: 18 }} />

      <View>
        {TASKS.map((t) => (
          <TaskRow key={t.key} taskKey={t.key} />
        ))}
      </View>

      {!dayComplete && (
        <OutlineButton
          label={allDone ? 'Finish the day' : 'Go to check-in'}
          onPress={() =>
            allDone ? router.push('/celebration') : router.navigate('/checkin')
          }
          style={{ marginTop: 16 }}
        />
      )}

      <View style={{ marginTop: 16 }}>
        <SquadSnapshot />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: space.screenX,
    paddingTop: 8,
    paddingBottom: 28,
  },
  bannerBody: {
    fontFamily: font.regular,
    fontSize: 13.5,
    color: colors.neutral300,
    marginTop: 6,
    lineHeight: 19,
  },
  day75Card: {
    borderRadius: radius.lg,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.accent800,
  },
  day75Title: {
    fontFamily: font.medium,
    fontSize: 20,
    color: colors.text,
    marginTop: 6,
  },
  todayCount: {
    fontFamily: font.medium,
    fontSize: 11,
    letterSpacing: 2.64,
    color: colors.neutral400,
    marginTop: 14,
    textTransform: 'uppercase',
  },
  why: {
    fontFamily: font.regular,
    fontSize: 12.5,
    color: colors.neutral500,
    marginTop: 6,
    fontStyle: 'italic',
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    gap: 12,
  },
  taskLabel: {
    flex: 1,
    fontFamily: font.regular,
    fontSize: 14,
    color: colors.text,
  },
  taskMeta: {
    fontFamily: font.regular,
    fontSize: 11.5,
    color: colors.neutral600,
  },
  proofMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  snapshotHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  snapshotStreak: {
    fontFamily: font.regular,
    fontSize: 11.5,
    color: colors.neutral500,
  },
  snapshotRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 14,
    paddingHorizontal: 8,
  },
  snapshotCount: {
    fontFamily: font.regular,
    fontSize: 10.5,
    color: colors.neutral500,
  },
});
