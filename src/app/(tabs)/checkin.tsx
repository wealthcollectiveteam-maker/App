import { useRouter } from 'expo-router';
import {
  CameraIcon as Camera,
  CheckCircleIcon as CheckCircle,
  CheckIcon as Check,
} from 'phosphor-react-native';
import React from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
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

import { ScreenState } from '@/components/ScreenState';
import { Card, Kicker, OutlineButton } from '@/components/ui';
import type { TaskDef, TaskKey } from '@/data/types';
import {
  selectDoneCount,
  selectQueue,
  selectTasks,
  useAppStore,
} from '@/store/useAppStore';
import { toast } from '@/store/useToastStore';
import { colors, font, radius, shadows, space } from '@/theme/tokens';

const FLY_THRESHOLD = 90;

function ProofRow({ taskKey }: { taskKey: TaskKey }) {
  const proof = useAppStore((s) => s.proofs[taskKey]);
  const attachProof = useAppStore((s) => s.attachProof);

  return (
    <Pressable
      onPress={() => {
        if (!proof) {
          attachProof(taskKey);
          toast('Proof attached');
        }
      }}
      style={styles.proofRow}
    >
      <View
        style={[
          styles.proofSquare,
          proof && {
            borderStyle: 'solid',
            borderColor: colors.accent500,
            backgroundColor: colors.accentTint,
          },
        ]}
      >
        {proof ? (
          <Check size={18} color={colors.accent400} weight="bold" />
        ) : (
          <Camera size={18} color={colors.neutral500} />
        )}
      </View>
      <Text style={styles.proofText}>
        {proof ? 'proof attached' : 'attach proof — optional'}
      </Text>
    </Pressable>
  );
}

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
}: {
  task: TaskDef;
  index: number;
  total: number;
  onDone: () => void;
  onLater: () => void;
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
    transform: [
      { translateX: tx.value },
      { rotate: `${tx.value / 18}deg` },
    ],
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
        <Animated.View style={[styles.stamp, styles.stampDone, doneStyle]}>
          <Text style={[styles.stampText, { color: colors.accent300 }]}>
            DONE
          </Text>
        </Animated.View>
        <Animated.View style={[styles.stamp, styles.stampLater, laterStyle]}>
          <Text style={[styles.stampText, { color: colors.neutral400 }]}>
            LATER
          </Text>
        </Animated.View>

        <Kicker>
          Task {index} of {total}
        </Kicker>
        <Text style={styles.cardTitle}>{task.label}</Text>
        <Text style={styles.cardSub}>{task.sub}</Text>
        {task.proof && <ProofRow taskKey={task.key} />}
        <View style={{ flex: 1 }} />
        <Text style={styles.cardFooter}>
          {'\u2190'} later&nbsp;&nbsp;|&nbsp;&nbsp;swipe to complete {'\u2192'}
        </Text>
      </Animated.View>
    </GestureDetector>
  );
}

function AllDone({ total }: { total: number }) {
  const dayComplete = useAppStore((s) => s.dayComplete);
  const day = useAppStore((s) => s.day);
  const router = useRouter();

  return (
    <Card style={styles.allDone}>
      <CheckCircle size={54} weight="fill" color={colors.accent500} />
      <Text style={styles.allDoneTitle}>
        {dayComplete ? `Day ${day} locked in.` : `All ${total} done.`}
      </Text>
      <Text style={styles.allDoneSub}>
        {dayComplete
          ? 'Flame fed. See you tomorrow.'
          : 'Seal the day and feed the flame.'}
      </Text>
      {!dayComplete && (
        <OutlineButton
          label="Lock in."
          onPress={() => router.push('/celebration')}
          style={{ marginTop: 16, alignSelf: 'stretch' }}
        />
      )}
    </Card>
  );
}

export default function CheckinScreen() {
  const tasks = useAppStore(selectTasks);
  const doneCount = useAppStore(selectDoneCount);
  const tier = useAppStore((s) => s.tier);
  const tasksDone = useAppStore((s) => s.tasksDone);
  const deferred = useAppStore((s) => s.deferred);
  const completeTask = useAppStore((s) => s.completeTask);
  const deferTask = useAppStore((s) => s.deferTask);

  const total = tasks.length;
  const queue = selectQueue({ tier, tasksDone, deferred });
  const topKey = queue[0];
  const topTask = tasks.find((t) => t.key === topKey);

  return (
    <ScreenState>
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.bg }}
        contentContainerStyle={styles.content}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Check-in</Text>
          <Text style={styles.counter}>
            {doneCount} OF {total}
          </Text>
        </View>

        <View style={styles.deck}>
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
              />
            </>
          ) : (
            <AllDone total={total} />
          )}
        </View>

        <View style={styles.chips}>
          {tasks.map((t) => {
            const done = !!tasksDone[t.key];
            return (
              <View
                key={t.key}
                style={[
                  styles.chip,
                  done ? styles.chipDone : styles.chipPending,
                ]}
              >
                <Text
                  style={[
                    styles.chipText,
                    { color: done ? colors.accent300 : colors.neutral500 },
                  ]}
                >
                  {done ? '\u2713 ' : ''}
                  {t.label.split(' — ')[0]}
                </Text>
              </View>
            );
          })}
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
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  title: {
    fontFamily: font.medium,
    fontSize: 24,
    color: colors.text,
  },
  counter: {
    fontFamily: font.medium,
    fontSize: 11,
    letterSpacing: 2.64,
    color: colors.neutral400,
  },
  deck: {
    height: 320,
    justifyContent: 'center',
  },
  topCard: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 300,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 18,
    ...shadows.md,
    ...(Platform.OS === 'web'
      ? ({ touchAction: 'none', userSelect: 'none' } as any)
      : null),
  },
  underCard: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 300,
    backgroundColor: colors.neutral900,
    borderRadius: radius.lg,
    opacity: 0.55,
  },
  under1: {
    top: 10,
    marginHorizontal: 10,
  },
  under2: {
    top: 20,
    marginHorizontal: 20,
    opacity: 0.35,
  },
  stamp: {
    position: 'absolute',
    top: 18,
    borderWidth: 2,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 4,
    zIndex: 2,
  },
  stampDone: {
    right: 18,
    borderColor: colors.accent500,
    transform: [{ rotate: '8deg' }],
  },
  stampLater: {
    left: 18,
    borderColor: colors.neutral600,
    transform: [{ rotate: '-8deg' }],
  },
  stampText: {
    fontFamily: font.semibold,
    fontSize: 16,
    letterSpacing: 2,
  },
  cardTitle: {
    fontFamily: font.medium,
    fontSize: 23,
    color: colors.text,
    marginTop: 10,
  },
  cardSub: {
    fontFamily: font.regular,
    fontSize: 13.5,
    color: colors.neutral400,
    marginTop: 6,
    lineHeight: 19,
  },
  proofRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 16,
  },
  proofSquare: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.neutral600,
    alignItems: 'center',
    justifyContent: 'center',
  },
  proofText: {
    fontFamily: font.regular,
    fontSize: 12,
    color: colors.neutral500,
  },
  cardFooter: {
    fontFamily: font.regular,
    fontSize: 11.5,
    color: colors.neutral600,
    textAlign: 'center',
  },
  allDone: {
    height: 300,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    paddingHorizontal: 24,
  },
  allDoneTitle: {
    fontFamily: font.medium,
    fontSize: 22,
    color: colors.text,
    marginTop: 12,
  },
  allDoneSub: {
    fontFamily: font.regular,
    fontSize: 13.5,
    color: colors.neutral400,
    marginTop: 6,
    textAlign: 'center',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 22,
  },
  chip: {
    borderRadius: radius.pill,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  chipDone: {
    backgroundColor: colors.accent900,
  },
  chipPending: {
    borderWidth: 1,
    borderColor: colors.neutral700,
  },
  chipText: {
    fontFamily: font.regular,
    fontSize: 11.5,
  },
});
