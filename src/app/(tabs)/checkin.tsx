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
import type { OpenDay, TaskDef } from '@/data/types';
import { useStartTimer } from '@/hooks/useStartTimer';
import { dayDateLabel } from '@/lib/dayLabel';
import { writeDay } from '@/lib/writeDay';
import {
  selectQueue,
  selectTasks,
  selectWorkoutSuggestions,
  useAppStore,
} from '@/store/useAppStore';
import { toast } from '@/store/useToastStore';
import { colors, font, microTracking, space } from '@/theme/tokens';

const FLY_THRESHOLD = 90;

/**
 * "2h 14m", "14m", "under a minute" — how long yesterday has left.
 *
 * Rendered from the SERVER's closes_at, which is noon in the challenge's own
 * timezone resolved to an absolute instant. Subtracting two instants is
 * timezone-free, so this stays right on a device set to the wrong zone; the
 * only thing the device contributes is "now".
 */
function timeLeft(closesAt: string): string {
  const ms = new Date(closesAt).getTime() - Date.now();
  if (ms <= 0) return 'closed';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'under a minute';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Re-renders once a minute so the countdown is not a lie after the first one. */
function useCountdown(closesAt: string | undefined): string {
  const [label, setLabel] = React.useState(() =>
    closesAt ? timeLeft(closesAt) : '',
  );
  React.useEffect(() => {
    if (!closesAt) return;
    setLabel(timeLeft(closesAt));
    const id = setInterval(() => setLabel(timeLeft(closesAt)), 30_000);
    return () => clearInterval(id);
  }, [closesAt]);
  return label;
}

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
  grace,
}: {
  task: TaskDef;
  index: number;
  total: number;
  onDone: () => void;
  onLater: () => void;
  onStartTimer: (task: TaskDef) => void;
  suggestion?: import('@/services/HealthService').HealthWorkout;
  /** Ticking YESTERDAY. The card itself changes, not a label on it. */
  grace?: number;
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
      <Animated.View
        style={[styles.topCard, grace !== undefined && styles.topCardGrace, cardStyle]}
      >
        {/* The accent rule down the left edge — ember when this is yesterday. */}
        <View
          style={[styles.cardRule, grace !== undefined && styles.cardRuleGrace]}
        />

        <View style={styles.cardBody}>
          {grace !== undefined && (
            <View style={styles.cardDayBadge}>
              <Micro color={colors.graceGround} size={10}>
                {`DAY ${grace}`}
              </Micro>
            </View>
          )}
          <Animated.View style={[styles.stamp, styles.stampDone, doneStyle]}>
            <Micro color={grace !== undefined ? colors.grace : colors.accent400}>
              Done
            </Micro>
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
function AllDone({ tasks, grace }: { tasks: TaskDef[]; grace: OpenDay | null }) {
  const todayComplete = useAppStore((s) => s.dayComplete);
  const todayDone = useAppStore((s) => s.tasksDone);
  const today = useAppStore((s) => s.day);
  const sealDay = useAppStore((s) => s.sealDay);
  const router = useRouter();

  // Which day this card is about. Everything below reads from here, so the
  // finished-state card can never describe today while the deck behind it was
  // yesterday's.
  const day = grace ? grace.day : today;
  const sealed = grace ? grace.sealed : todayComplete;
  const tasksDone = grace ? grace.tasksDone : todayDone;
  const hue = grace ? colors.grace : colors.accent400;

  return (
    <View style={[styles.allDone, grace && styles.allDoneGrace]}>
      <View style={styles.allDoneHead}>
        <Text style={styles.allDoneFigure} maxFontSizeMultiplier={1.3}>
          {String(tasks.length).padStart(2, '0')}
        </Text>
        <View style={{ flex: 1 }}>
          <Micro color={hue}>
            {sealed
              ? `Day ${day} locked in`
              : grace
                ? `Day ${day} — yesterday, all done`
                : 'All done today'}
          </Micro>
          <Serif style={{ marginTop: 8 }}>
            {sealed
              ? grace
                ? 'Counted. Day ' + day + ' stands.'
                : 'Flame fed. See you tomorrow.'
              : grace
                ? 'Lock it in before noon and the streak holds.'
                : 'Seal the day and feed the flame.'}
          </Serif>
        </View>
      </View>

      <View style={styles.doneList}>
        {tasks.map((t) => (
          <View key={t.key} style={styles.doneRow}>
            <Check size={14} weight="bold" color={hue} />
            <Text style={styles.doneLabel} numberOfLines={2}>
              {t.label}
            </Text>
            <Text style={styles.doneTime}>{tasksDone[t.key]}</Text>
          </View>
        ))}
      </View>

      {!sealed && (
        <PrimaryButton
          // Yesterday does not get the celebration screen: that screen is
          // about the day you are living, and it would be claiming a moment
          // that already passed. Sealing happens here, in place.
          label={grace ? `Lock in Day ${day} →` : 'Lock in →'}
          onPress={grace ? sealDay : () => router.push('/celebration')}
          style={{ marginTop: 20 }}
        />
      )}
    </View>
  );
}

/**
 * THE SWITCHER — the thing that makes two open days unambiguous.
 *
 * It is not a subtitle or a tint. It is a control that is always on screen
 * while both days are open, whose selected half is FILLED, and which names
 * the day number and the count on each side. You cannot tick a task without
 * having passed it.
 */
function DaySwitcher({
  today,
  todayDone,
  todayTotal,
  grace,
  graceDone,
  graceTotal,
  active,
  onPick,
}: {
  today: number;
  todayDone: number;
  todayTotal: number;
  grace: OpenDay;
  graceDone: number;
  graceTotal: number;
  active: 'today' | 'yesterday';
  onPick: (which: 'today' | 'yesterday') => void;
}) {
  const left = useCountdown(grace.closesAt);
  return (
    <View style={styles.switcherWrap}>
      <View style={styles.switcher}>
        <Skew
          label={`YESTERDAY · DAY ${grace.day} · ${graceDone}/${graceTotal}`}
          tone="grace"
          filled={active === 'yesterday'}
          size="sm"
          onPress={() => onPick('yesterday')}
          style={{ flex: 1 }}
          accessibilityLabel={`Finish yesterday, day ${grace.day}, ${graceDone} of ${graceTotal} done`}
        />
        <Skew
          label={`TODAY · DAY ${today} · ${todayDone}/${todayTotal}`}
          filled={active === 'today'}
          size="sm"
          onPress={() => onPick('today')}
          style={{ flex: 1 }}
          accessibilityLabel={`Today, day ${today}, ${todayDone} of ${todayTotal} done`}
        />
      </View>
      <Micro color={colors.textMid} style={{ marginTop: 8 }}>
        {`Day ${grace.day} locks at noon — ${left} left`}
      </Micro>
    </View>
  );
}

export default function CheckinScreen() {
  const todayTasks = useAppStore(selectTasks);
  const todayDone = useAppStore((s) => s.tasksDone);
  const day = useAppStore((s) => s.day);
  const deferred = useAppStore((s) => s.deferred);
  const completeTask = useAppStore((s) => s.completeTask);
  const deferTask = useAppStore((s) => s.deferTask);
  const workoutSuggestions = useAppStore(useShallow(selectWorkoutSuggestions));
  const startTimer = useStartTimer();

  const yesterday = useAppStore((s) => s.yesterday);
  const todayClosesAt = useAppStore((s) => s.todayClosesAt);
  const challengeTimezone = useAppStore((s) => s.challengeTimezone);
  const activeDay = useAppStore((s) => s.activeDay);
  const setActiveDay = useAppStore((s) => s.setActiveDay);

  // THE WINDOW. Yesterday is offered only while the SERVER calls it open and
  // there is still something to do on it. Nothing here is derived from this
  // device's clock: the boundary is noon in the CHALLENGE's timezone, and a
  // phone in another zone (or simply set wrong) must not be able to talk the
  // screen into offering a day every write against it will be refused.
  const yTotal = yesterday?.tasks.length ?? 0;
  const yDone = yesterday
    ? yesterday.tasks.filter((t) => yesterday.tasksDone[t.key]).length
    : 0;
  const offerYesterday =
    !!yesterday && yesterday.open && !yesterday.sealed && yDone < yTotal;
  // Closed, and it was never finished. Say so — do not simply take the option
  // away and leave the user wondering whether they imagined it.
  const closedUnfinished =
    !!yesterday && !yesterday.open && !yesterday.sealed && yDone < yTotal;

  // Which day the deck is actually ticking. `grace` is non-null ONLY in
  // yesterday-mode, and every branch below keys off it, so there is one
  // switch rather than a scattering of conditions that could disagree.
  //
  // PHASE 20: `target` comes from writeDay() — the identical call every write
  // path makes. The day this screen NAMES and the day the database RECEIVES
  // are now the same expression evaluated on the same state, not two
  // conclusions reached separately and hoped to match.
  const target = writeDay({
    activeDay,
    today: day,
    yesterday: yesterday ? { day: yesterday.day, open: offerYesterday } : null,
  });
  const grace = target !== day && yesterday ? yesterday : null;

  // THE DATE, not just the day number. "Day 18" does not tell anyone at
  // 12:20 AM whether they are filling in the day that just ended or the one
  // that just started; "Wednesday 10 September" does. Derived from the
  // SERVER's boundary instant in the CHALLENGE's timezone, so a phone in
  // another zone cannot make this label disagree with the write.
  const targetDate = dayDateLabel(
    grace ? grace.closesAt : todayClosesAt,
    challengeTimezone,
  );

  const tasks = grace ? grace.tasks : todayTasks;
  const tasksDone = grace ? grace.tasksDone : todayDone;
  const doneCount = tasks.filter((t) => tasksDone[t.key]).length;
  const total = tasks.length;
  // Deferral is a today affordance: a day you are closing out has nowhere to
  // push a task to.
  const queue = selectQueue({
    todayTasks: tasks,
    tasksDone,
    deferred: grace ? [] : deferred,
  });
  const topKey = queue[0];
  const topTask = tasks.find((t) => t.key === topKey);
  const hue = grace ? colors.grace : colors.accent400;
  const closesIn = useCountdown(grace?.closesAt);

  return (
    <ScreenState>
      <RefreshableScrollView
        // THE GROUND ITSELF CHANGES. Peripheral vision registers a warm
        // screen before a word of it is read, which is the whole point: the
        // trap here is a user looking straight at the right label and not
        // seeing it.
        style={{
          flex: 1,
          backgroundColor: grace ? colors.graceGround : colors.bg,
        }}
        contentContainerStyle={styles.content}
      >
        {grace ? (
          <View style={styles.graceBar}>
            <Micro color={colors.graceGround} size={11}>
              {'FINISHING YESTERDAY · DAY ' + grace.day}
            </Micro>
            <Micro color={colors.graceGround} size={11}>
              {'LOCKS IN ' + closesIn.toUpperCase()}
            </Micro>
          </View>
        ) : null}

        <View style={styles.header}>
          <Text style={[styles.title, grace ? { color: colors.grace } : null]}>
            {'Day ' + target}
          </Text>
          {targetDate ? (
            <Micro color={grace ? colors.grace : colors.textMid}>
              {targetDate.toUpperCase()}
            </Micro>
          ) : null}
          <Micro color={grace ? colors.grace : colors.textMid}>
            {doneCount} of {total} done
          </Micro>
        </View>

        {/* BEFORE THE FIRST TAP, NOT AFTER. The DaySwitcher below offers the
            choice, but a switcher is something you find by looking for it.
            This says the previous day is still open in a sentence, in the
            default state, so nobody fills in the wrong day and discovers the
            option afterwards. */}
        {offerYesterday && yesterday && !grace ? (
          <View style={styles.stillOpenNotice}>
            <Micro color={colors.grace} size={11}>
              {'DAY ' + yesterday.day + ' IS STILL OPEN'}
            </Micro>
            <Serif size={15} style={{ marginTop: 6 }}>
              {'You are filling in day ' + target +
                '. Day ' + yesterday.day + ' is ' + yDone + ' of ' + yTotal +
                ' and stays open until noon — switch below to finish it.'}
            </Serif>
          </View>
        ) : null}

        {offerYesterday && yesterday ? (
          <DaySwitcher
            today={day}
            todayDone={todayTasks.filter((t) => todayDone[t.key]).length}
            todayTotal={todayTasks.length}
            grace={yesterday}
            graceDone={yDone}
            graceTotal={yTotal}
            active={grace ? 'yesterday' : 'today'}
            onPick={setActiveDay}
          />
        ) : null}

        {closedUnfinished && yesterday ? (
          <View style={styles.closedNotice}>
            <Micro color={colors.textMid} size={11}>
              {'DAY ' + yesterday.day + ' CLOSED AT NOON'}
            </Micro>
            <Serif size={15} style={{ marginTop: 6 }}>
              {'It finished ' + yDone + ' of ' + yTotal +
                '. That is how it is counted — nothing here can change it now.'}
            </Serif>
          </View>
        ) : null}

        <View style={[styles.deck, !topTask && styles.deckDone]}>
          {topTask ? (
            <>
              {queue[2] && <View style={[styles.underCard, styles.under2]} />}
              {queue[1] && <View style={[styles.underCard, styles.under1]} />}
              <TopCard
                // Keyed by DAY as well as task: switching days mounts a fresh
                // card with fresh shared values rather than re-using the one
                // left mid-swipe on the other day.
                key={(grace ? grace.day : day) + ':' + topTask.key}
                task={topTask}
                index={doneCount + 1}
                total={total}
                grace={grace ? grace.day : undefined}
                onDone={() => {
                  completeTask(topTask.key);
                  toast('+20 XP');
                }}
                onLater={() => deferTask(topTask.key)}
                onStartTimer={startTimer}
                suggestion={grace ? undefined : workoutSuggestions[topTask.key]}
              />
            </>
          ) : (
            <AllDone tasks={tasks} grace={grace} />
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
                  done && (grace ? styles.chipDoneGrace : styles.chipDone),
                  now && (grace ? styles.chipNowGrace : styles.chipNow),
                ]}
              >
                {done && <Check size={13} weight="bold" color={hue} />}
                <Text
                  style={[
                    styles.chipText,
                    done && { color: hue },
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
  // ---- the grace window ----
  // A solid ember band across the full content width, dark text on it, the
  // same weight the primary action carries. It is the first thing on the
  // screen and it never scrolls away above the deck.
  graceBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: colors.grace,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginHorizontal: -space.screenX,
    paddingLeft: space.screenX,
    paddingRight: space.screenX,
    marginBottom: 16,
  },
  switcherWrap: {
    marginBottom: 18,
  },
  switcher: {
    flexDirection: 'row',
    gap: 8,
  },
  closedNotice: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    padding: space.cardPad,
    marginBottom: 18,
  },
  // Same shape as closedNotice, edged in the grace hue: this one is about a
  // day still open, and the colour is the fastest thing on the screen to read.
  stillOpenNotice: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.grace,
    backgroundColor: colors.surface,
    padding: space.cardPad,
    marginBottom: 18,
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
  topCardGrace: {
    backgroundColor: colors.graceSurface,
  },
  cardRule: {
    width: 2,
    backgroundColor: colors.accent,
  },
  cardRuleGrace: {
    // Four times the width of the blue rule. The card does not merely change
    // colour, it changes shape.
    width: 8,
    backgroundColor: colors.grace,
  },
  cardDayBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.grace,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginBottom: 12,
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
  allDoneGrace: {
    backgroundColor: colors.graceSurface,
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
  chipDoneGrace: {
    backgroundColor: colors.graceDeep,
    borderColor: colors.graceDeep,
  },
  chipNowGrace: {
    borderColor: colors.grace,
  },
  chipText: {
    fontFamily: font.semibold,
    fontSize: 11,
    letterSpacing: microTracking(11),
    textTransform: 'uppercase',
    color: colors.textLow,
  },
});
