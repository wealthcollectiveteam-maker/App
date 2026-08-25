import { useRouter } from 'expo-router';
import {
  CheckIcon as Check,
} from 'phosphor-react-native';
import React from 'react';
import {
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useShallow } from 'zustand/react/shallow';

import { Micro, PrimaryButton, Serif, Skew } from '@/components/primitives';
import { RefreshableScrollView } from '@/components/RefreshableScrollView';
import { ScreenState } from '@/components/ScreenState';
import { WorkoutSuggestion } from '@/components/WorkoutSuggestion';
import type { TaskDef } from '@/data/types';
import { useStartTimer } from '@/hooks/useStartTimer';
import {
  selectDoneCount,
  selectQueue,
  selectTasks,
  selectWorkoutSuggestions,
  useAppStore,
} from '@/store/useAppStore';
import { toast } from '@/store/useToastStore';
import { colors, font, microTracking, space } from '@/theme/tokens';

const FLY_THRESHOLD = 90;

/** "10:00" from a whole-minute timer target. */
const clockFace = (minutes: number) =>
  `${String(minutes).padStart(2, '0')}:00`;

/**
 * Top card of the swipe deck. Gesture runs through
 * react-native-gesture-handler with the animation driven by Reanimated on
 * the UI thread. The component is keyed by task, so a fresh card (and fresh
 * shared values) mounts for each task.
 */
function TopCard({
  task,
  index,
  total,
  onDone,
  onLater,
  onStartTimer,
  suggestion,
}: {
  task: TaskDef;
  index: number;
  total: number;
  onDone: () => void;
  onLater: () => void;
  onStartTimer: (task: TaskDef) => void;
  suggestion?: import('@/services/HealthService').HealthWorkout;
}) {
  const tx = useSharedValue(0);
  const busy = useSharedValue(false);

  const pan = Gesture.Pan()
    .activeOffsetX([-10, 10])
    .failOffsetY([-14, 14])
    .onUpdate((e) => {
      'worklet';
      if (!busy.value) tx.value = e.translationX;
    })
    .onEnd(() => {
      'worklet';
      if (busy.value) return;
      if (tx.value > FLY_THRESHOLD) {
        busy.value = true;
        tx.value = withTiming(520, { duration: 240 }, (finished) => {
          if (finished) runOnJS(onDone)();
        });
      } else if (tx.value < -FLY_THRESHOLD) {
        busy.value = true;
        tx.value = withTiming(-520, { duration: 240 }, (finished) => {
          if (finished) runOnJS(onLater)();
        });
      } else {
        tx.value = withSpring(0, { damping: 16, stiffness: 160 });
      }
    });

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { rotate: `${tx.value / 22}deg` }],
  }));
  const doneStyle = useAnimatedStyle(() => ({
    opacity: interpolate(tx.value, [0, FLY_THRESHOLD], [0, 1], 'clamp'),
  }));
  const laterStyle = useAnimatedStyle(() => ({
    opacity: interpolate(tx.value, [-FLY_THRESHOLD, 0], [1, 0], 'clamp'),
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.topCard, cardStyle]}>
        {/* The accent rule down the left edge. */}
        <View style={styles.cardRule} />

        <View style={styles.cardBody}>
          <Animated.View style={[styles.stamp, styles.stampDone, doneStyle]}>
            <Micro color={colors.accent400}>Done</Micro>
          </Animated.View>
          <Animated.View style={[styles.stamp, styles.stampLater, laterStyle]}>
            <Micro color={colors.textMid}>Later</Micro>
          </Animated.View>

          <View style={styles.cardHeader}>
            <Micro color={colors.textMid}>Task</Micro>
            <Text style={styles.counterFigure} maxFontSizeMultiplier={1.3}>
              {String(index).padStart(2, '0')}
              <Text style={styles.counterTotal}>
                /{String(total).padStart(2, '0')}
              </Text>
            </Text>
          </View>

          <Text style={styles.cardTitle}>{task.label}</Text>
          <Serif style={{ marginTop: 10 }}>{task.sub}</Serif>

          {suggestion && (
            <WorkoutSuggestion taskKey={task.key} workout={suggestion} />
          )}

          <View style={{ flex: 1, minHeight: 24 }} />

          {task.timerMinutes ? (
            <View style={styles.timerRow}>
              <Text style={styles.ghostClock} maxFontSizeMultiplier={1.3}>
                {clockFace(task.timerMinutes)}
              </Text>
              <Skew
                label={'Start\ntimer'}
                onPress={() => onStartTimer(task)}
                accessibilityLabel={`Start timer for ${task.label}`}
              />
            </View>
          ) : null}

          <View style={styles.cardFooter}>
            <Micro color={colors.textLow}>← Later</Micro>
            <Text style={styles.footerPipe}>|</Text>
            <Micro color={colors.textHi}>Swipe to complete →</Micro>
          </View>
        </View>
      </Animated.View>
    </GestureDetector>
  );
}

/**
 * The finished-day card.
 *
 * It used to hold three lines in the height of a full task card — the
 * emptiest moment in an app whose whole job is to make finishing feel
 * earned. The space now carries what you actually did today: every task,
 * with the time you checked it off. Read straight from the frozen snapshot
 * and the completion map, so it invents nothing.
 */
function AllDone({ tasks }: { tasks: TaskDef[] }) {
  const dayComplete = useAppStore((s) => s.dayComplete);
  const tasksDone = useAppStore((s) => s.tasksDone);
  const day = useAppStore((s) => s.day);
  const router = useRouter();

  return (
    <View style={styles.allDone}>
      <View style={styles.allDoneHead}>
        <Text style={styles.allDoneFigure} maxFontSizeMultiplier={1.3}>
          {String(tasks.length).padStart(2, '0')}
        </Text>
        <View style={{ flex: 1 }}>
          <Micro color={colors.accent400}>
            {dayComplete ? `Day ${day} locked in` : 'All done today'}
          </Micro>
          <Serif style={{ marginTop: 8 }}>
            {dayComplete
              ? 'Flame fed. See you tomorrow.'
              : 'Seal the day and feed the flame.'}
          </Serif>
        </View>
      </View>

      <View style={styles.doneList}>
        {tasks.map((t) => (
          <View key={t.key} style={styles.doneRow}>
            <Check size={14} weight="bold" color={colors.accent400} />
            <Text style={styles.doneLabel} numberOfLines={2}>
              {t.label}
            </Text>
            <Text style={styles.doneTime}>{tasksDone[t.key]}</Text>
          </View>
        ))}
      </View>

      {!dayComplete && (
        <PrimaryButton
          label="Lock in →"
          onPress={() => router.push('/celebration')}
          style={{ marginTop: 20 }}
        />
      )}
    </View>
  );
}

export default function CheckinScreen() {
  const tasks = useAppStore(selectTasks);
  const doneCount = useAppStore(selectDoneCount);
  const tasksDone = useAppStore((s) => s.tasksDone);
  const deferred = useAppStore((s) => s.deferred);
  const completeTask = useAppStore((s) => s.completeTask);
  const deferTask = useAppStore((s) => s.deferTask);
  const workoutSuggestions = useAppStore(useShallow(selectWorkoutSuggestions));
  const startTimer = useStartTimer();

  const total = tasks.length;
  const queue = selectQueue({ todayTasks: tasks, tasksDone, deferred });
  const topKey = queue[0];
  const topTask = tasks.find((t) => t.key === topKey);

  return (
    <ScreenState>
      <RefreshableScrollView
        style={{ flex: 1, backgroundColor: colors.bg }}
        contentContainerStyle={styles.content}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Check-in</Text>
          <Micro color={colors.textMid}>
            {doneCount} of {total} done
          </Micro>
        </View>

        <View style={[styles.deck, !topTask && styles.deckDone]}>
          {topTask ? (
            <>
              {queue[2] && <View style={[styles.underCard, styles.under2]} />}
              {queue[1] && <View style={[styles.underCard, styles.under1]} />}
              <TopCard
                key={topTask.key}
                task={topTask}
                index={doneCount + 1}
                total={total}
                onDone={() => {
                  completeTask(topTask.key);
                  toast('+20 XP');
                }}
                onLater={() => deferTask(topTask.key)}
                onStartTimer={startTimer}
                suggestion={workoutSuggestions[topTask.key]}
              />
            </>
          ) : (
            <AllDone tasks={tasks} />
          )}
        </View>

        <View style={styles.chips}>
          {tasks.map((t) => {
            const done = !!tasksDone[t.key];
            const now = !done && t.key === topKey;
            return (
              <View
                key={t.key}
                style={[
                  styles.chip,
                  done && styles.chipDone,
                  now && styles.chipNow,
                ]}
              >
                {done && (
                  <Check size={13} weight="bold" color={colors.accent400} />
                )}
                <Text
                  style={[
                    styles.chipText,
                    done && { color: colors.accent400 },
                    now && { color: colors.textHi },
                  ]}
                  numberOfLines={1}
                >
                  {t.label.split(' — ')[0]}
                  {now ? ' · Now' : ''}
                </Text>
              </View>
            );
          })}
        </View>
      </RefreshableScrollView>
    </ScreenState>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: space.screenX,
    paddingTop: 8,
    paddingBottom: 28,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 18,
  },
  title: {
    fontFamily: font.bold,
    fontSize: 34,
    letterSpacing: -1,
    color: colors.textHi,
  },
  deck: {
    // Sizes to the card, so nothing clips when the system font grows.
    minHeight: 380,
  },
  deckDone: {
    minHeight: 0,
  },
  topCard: {
    flexDirection: 'row',
    minHeight: 380,
    backgroundColor: colors.surface,
    ...(Platform.OS === 'web'
      ? ({ touchAction: 'none', userSelect: 'none' } as any)
      : null),
  },
  cardRule: {
    width: 2,
    backgroundColor: colors.accent,
  },
  cardBody: {
    flex: 1,
    padding: 22,
  },
  underCard: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: colors.surfaceAlt,
  },
  under1: {
    top: 10,
    bottom: -10,
    marginHorizontal: 10,
    opacity: 0.7,
  },
  under2: {
    top: 20,
    bottom: -20,
    marginHorizontal: 20,
    opacity: 0.4,
  },
  stamp: {
    position: 'absolute',
    top: 20,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
    zIndex: 2,
  },
  // Stamps sit opposite the exit direction (Tinder-style) so they stay on
  // screen while the card is dragged toward the edge.
  stampDone: {
    left: 20,
    borderColor: colors.accent,
    transform: [{ skewX: '-12deg' }],
  },
  stampLater: {
    right: 20,
    borderColor: colors.line,
    transform: [{ skewX: '-12deg' }],
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  counterFigure: {
    fontFamily: font.black,
    fontSize: 32,
    letterSpacing: -1.4,
    color: colors.accent400,
    fontVariant: ['tabular-nums'],
  },
  counterTotal: {
    fontFamily: font.semibold,
    fontSize: 17,
    letterSpacing: 0,
    color: colors.textMid,
  },
  cardTitle: {
    fontFamily: font.bold,
    fontSize: 42,
    lineHeight: 46,
    letterSpacing: -1.8,
    color: colors.textHi,
    marginTop: 26,
  },
  proofRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 18,
  },
  proofSquare: {
    width: 30,
    height: 30,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    marginTop: 12,
  },
  ghostClock: {
    fontFamily: font.black,
    fontSize: 54,
    letterSpacing: -2.4,
    color: colors.surfaceAlt,
    fontVariant: ['tabular-nums'],
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginTop: 22,
  },
  footerPipe: {
    fontFamily: font.regular,
    fontSize: 12,
    color: colors.line,
  },
  allDone: {
    // Sizes to its content now that there is content: no fixed height to
    // leave three lines floating in a screen's worth of surface.
    backgroundColor: colors.surface,
    padding: 24,
  },
  allDoneHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
  },
  allDoneFigure: {
    fontFamily: font.black,
    fontSize: 76,
    lineHeight: 80,
    letterSpacing: -4,
    color: colors.accent,
    fontVariant: ['tabular-nums'],
  },
  doneList: {
    marginTop: 22,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  doneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 44,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  doneLabel: {
    flex: 1,
    fontFamily: font.medium,
    fontSize: 14.5,
    color: colors.textMid,
    textDecorationLine: 'line-through',
  },
  doneTime: {
    fontFamily: font.semibold,
    fontSize: 11,
    letterSpacing: microTracking(11),
    textTransform: 'uppercase',
    color: colors.textLow,
    fontVariant: ['tabular-nums'],
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 22,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  chipDone: {
    backgroundColor: colors.accentDeep,
    borderColor: colors.accentDeep,
  },
  chipNow: {
    borderColor: colors.accent,
  },
  chipText: {
    fontFamily: font.semibold,
    fontSize: 11,
    letterSpacing: microTracking(11),
    textTransform: 'uppercase',
    color: colors.textLow,
  },
});
