import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';

import { HealthPromptCards } from '@/components/HealthPromptCard';
import {
  InitialsTile,
  Micro,
  PrimaryButton,
  SegmentBar,
  Serif,
  Skew,
  TaskRow,
} from '@/components/primitives';
import { ScreenState } from '@/components/ScreenState';
import { Card, OutlineButton } from '@/components/ui';
import { WorkoutSuggestion } from '@/components/WorkoutSuggestion';
import { CHALLENGE } from '@/constants/challenge';
import { missedDayCopy, targetText } from '@/constants/tiers';
import type { TaskDef } from '@/data/types';
import { useStartTimer } from '@/hooks/useStartTimer';
import {
  selectDoneCount,
  selectTasks,
  selectWorkoutSuggestions,
  useAppStore,
} from '@/store/useAppStore';
import { toast } from '@/store/useToastStore';
import { colors, font, space } from '@/theme/tokens';

function StatusBanner() {
  const day = useAppStore((s) => s.day);
  const tier = useAppStore((s) => s.tier);
  const missedDay = useAppStore((s) => s.missedDay);
  const dayComplete = useAppStore((s) => s.dayComplete);
  const router = useRouter();

  if (day === CHALLENGE.days && dayComplete) {
    return (
      <View style={styles.banner}>
        <View style={styles.bannerRule} />
        <View style={styles.bannerBody}>
          <Micro color={colors.accent400}>Challenge complete</Micro>
          <Text style={styles.bannerTitle}>
            {CHALLENGE.days} days. Every task. Never missed.
          </Text>
          <PrimaryButton
            label="See your results"
            onPress={() => router.push('/finish')}
            style={{ marginTop: 14 }}
          />
        </View>
      </View>
    );
  }

  if (missedDay) {
    return (
      <View style={styles.banner}>
        <View style={[styles.bannerRule, { backgroundColor: colors.textLow }]} />
        <View style={styles.bannerBody}>
          <Micro color={colors.textMid}>Streak broken</Micro>
          <Serif style={{ marginTop: 6 }}>{missedDayCopy(tier, day)}</Serif>
        </View>
      </View>
    );
  }

  return null;
}

/**
 * The right-hand meta on a task row, in priority order: a timer control, a
 * proof note, then the task's own target. Nothing here invents progress the
 * app does not track.
 */
function TaskMeta({ task }: { task: TaskDef }) {
  const startTimer = useStartTimer();

  if (task.timerMinutes) {
    return (
      <Skew
        label="Timer ▸"
        size="sm"
        onPress={() => startTimer(task)}
        accessibilityLabel={`Start timer for ${task.label}`}
      />
    );
  }
  if (task.proof) return <Micro color={colors.textLow}>Proof optional</Micro>;
  if (task.target) {
    return <Micro color={colors.accent400}>{targetText(task.target)}</Micro>;
  }
  return null;
}

function HomeTaskRow({ task }: { task: TaskDef }) {
  const doneAt = useAppStore((s) => s.tasksDone[task.key]);
  const completeTask = useAppStore((s) => s.completeTask);
  const uncompleteTask = useAppStore((s) => s.uncompleteTask);
  const done = !!doneAt;

  return (
    <TaskRow
      label={task.label}
      done={done}
      meta={done ? doneAt : undefined}
      right={done ? undefined : <TaskMeta task={task} />}
      onPress={() => {
        if (done) {
          uncompleteTask(task.key);
        } else {
          completeTask(task.key);
          toast('+20 XP');
        }
      }}
    />
  );
}

/** Initials strip: your own tile carries the accent underline. */
function SquadStrip() {
  const squad = useAppStore((s) => s.squad);
  const router = useRouter();

  if (!squad) {
    return (
      <Card style={styles.soloCard}>
        <View style={{ flex: 1 }}>
          <Text style={styles.soloTitle}>Running it solo.</Text>
          <Text style={styles.soloSub}>
            Invite a squad when you want witnesses.
          </Text>
        </View>
        <OutlineButton
          label="Invite"
          small
          onPress={() => router.navigate('/squad')}
        />
      </Card>
    );
  }

  return (
    <Pressable
      onPress={() => router.navigate('/squad')}
      accessibilityRole="button"
      accessibilityLabel="Open the squad tab"
      style={styles.strip}
    >
      <Micro color={colors.textMid}>Squad</Micro>
      <View style={styles.stripTiles}>
        {squad.members.map((m) => (
          <InitialsTile
            key={m.id}
            initials={m.initials}
            active={m.isSelf}
            size={40}
          />
        ))}
      </View>
      <View style={styles.stripStreak}>
        <Micro color={colors.accent400}>{squad.streak}-day</Micro>
        <View style={styles.diamond} />
      </View>
    </Pressable>
  );
}

export default function HomeScreen() {
  const day = useAppStore((s) => s.day);
  const why = useAppStore((s) => s.why);
  const dayComplete = useAppStore((s) => s.dayComplete);
  const tasks = useAppStore(selectTasks);
  const doneCount = useAppStore(selectDoneCount);
  const workoutSuggestions = useAppStore(useShallow(selectWorkoutSuggestions));
  const router = useRouter();
  const allDone = doneCount === tasks.length;

  return (
    <ScreenState>
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.bg }}
        contentContainerStyle={styles.content}
      >
        <StatusBanner />

        {/* The day number is the largest element on this screen. */}
        <View style={styles.dayBlock}>
          <Text style={styles.dayNumber} maxFontSizeMultiplier={1.3}>
            {String(day).padStart(2, '0')}
          </Text>
          <View style={styles.dayMeta}>
            <Micro color={colors.textMid}>
              Of {CHALLENGE.days} days
            </Micro>
            <Micro color={colors.accent400} style={{ marginTop: 6 }}>
              {doneCount} of {tasks.length} today
            </Micro>
          </View>
        </View>

        <SegmentBar
          done={doneCount}
          total={tasks.length}
          height={5}
          style={{ marginTop: 18 }}
        />

        {!!why && (
          <Serif style={{ marginTop: 16 }}>
            {'“'}
            {why}
            {'”'}
          </Serif>
        )}

        <View style={{ marginTop: 20 }}>
          {tasks.map((t) => (
            <View key={t.key}>
              <HomeTaskRow task={t} />
              {workoutSuggestions[t.key] && (
                <WorkoutSuggestion
                  taskKey={t.key}
                  workout={workoutSuggestions[t.key]!}
                />
              )}
            </View>
          ))}
        </View>

        <HealthPromptCards />

        {!dayComplete && (
          <PrimaryButton
            label={
              allDone ? 'Finish the day →' : 'Go to check-in →'
            }
            onPress={() =>
              allDone ? router.push('/celebration') : router.navigate('/checkin')
            }
            style={{ marginTop: 28 }}
          />
        )}

        <View style={{ marginTop: 20 }}>
          <SquadStrip />
        </View>
      </ScrollView>
    </ScreenState>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: space.screenX,
    paddingTop: 8,
    paddingBottom: 28,
  },
  banner: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    marginBottom: 20,
  },
  bannerRule: {
    width: 2,
    backgroundColor: colors.accent,
  },
  bannerBody: {
    flex: 1,
    padding: space.cardPad,
  },
  bannerTitle: {
    fontFamily: font.bold,
    fontSize: 20,
    letterSpacing: -0.4,
    color: colors.textHi,
    marginTop: 8,
  },
  dayBlock: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 14,
  },
  dayNumber: {
    fontFamily: font.black,
    fontSize: 104,
    lineHeight: 104,
    letterSpacing: -6,
    color: colors.textHi,
    fontVariant: ['tabular-nums'],
  },
  dayMeta: {
    flex: 1,
    paddingBottom: 16,
  },
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  stripTiles: {
    flex: 1,
    flexDirection: 'row',
    gap: 8,
  },
  stripStreak: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  diamond: {
    width: 8,
    height: 8,
    backgroundColor: colors.accent,
    transform: [{ rotate: '45deg' }],
  },
  soloCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  soloTitle: {
    fontFamily: font.bold,
    fontSize: 16,
    letterSpacing: -0.2,
    color: colors.textHi,
  },
  soloSub: {
    fontFamily: font.regular,
    fontSize: 13,
    color: colors.textMid,
    marginTop: 3,
  },
});
