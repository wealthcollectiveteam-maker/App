import { useKeepAwake } from 'expo-keep-awake';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import {
  BellSlashIcon as BellSlash,
  CheckCircleIcon as CheckCircle,
} from 'phosphor-react-native';
import React, { useCallback, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ProgressRing } from '@/components/ProgressRing';
import { Kicker, OutlineButton } from '@/components/ui';
import type { TaskKey } from '@/data/types';
import { useTimerTick } from '@/hooks/useTimerTick';
import {
  getNotificationPermissionStatus,
  type NotificationPermission,
} from '@/services/timerEffects';
import { selectTasks, useAppStore } from '@/store/useAppStore';
import {
  formatCountdown,
  useTimerStore,
  type CompletedTimer,
} from '@/store/useTimerStore';
import { colors, font, radius, space } from '@/theme/tokens';

/** Keep the screen awake only while this screen is mounted and focused. */
function KeepAwakeWhileVisible() {
  useKeepAwake();
  return null;
}

/**
 * Never fail silently: when notification permission is denied, say so and
 * offer the system settings. Without it a backgrounded timer is invisible.
 */
function NotificationDeniedNotice() {
  const [status, setStatus] = useState<NotificationPermission>('unavailable');

  useFocusEffect(
    useCallback(() => {
      getNotificationPermissionStatus().then(setStatus).catch(() => {});
    }, []),
  );

  if (status !== 'denied') return null;
  return (
    <View style={styles.deniedNotice}>
      <BellSlash size={15} color={colors.neutral400} />
      <Text style={styles.deniedText}>
        Timer alerts are off — you won{'\u2019'}t be notified when this
        finishes.
      </Text>
      <OutlineButton
        label="Open Settings"
        small
        tone="neutral"
        onPress={() => Linking.openSettings().catch(() => {})}
      />
    </View>
  );
}

function CompletedState({
  completed,
  onDone,
}: {
  completed: CompletedTimer;
  onDone: () => void;
}) {
  return (
    <View style={styles.center}>
      <CheckCircle size={64} weight="fill" color={colors.accent500} />
      <Text style={styles.doneTitle}>Done. Locked in.</Text>
      <Text style={styles.doneMeta}>
        {completed.label} · trained {formatCountdown(completed.elapsedSeconds)}
      </Text>
      <OutlineButton
        label="Keep going"
        onPress={onDone}
        style={{ marginTop: 26, minWidth: 200 }}
      />
    </View>
  );
}

/** Pre-start state for user-set durations (e.g. reading). */
function ReadyState({ taskKey }: { taskKey: TaskKey }) {
  const tasks = useAppStore(selectTasks);
  const requestStart = useTimerStore((s) => s.requestStart);
  const task = tasks.find((t) => t.key === taskKey);
  const [minutes, setMinutes] = useState(task?.timerMinutes ?? 10);
  const [devSeconds, setDevSeconds] = useState<number | null>(null);

  if (!task) return null;
  const durationSeconds = devSeconds ?? minutes * 60;

  return (
    <View style={styles.center}>
      <Kicker style={{ marginBottom: 10 }}>Set your duration</Kicker>
      <ProgressRing fraction={1} size={200}>
        <Text style={styles.countdown}>
          {formatCountdown(durationSeconds)}
        </Text>
      </ProgressRing>
      <Text style={styles.taskName}>{task.label}</Text>
      <View style={styles.stepperRow}>
        <OutlineButton
          label="−1 min"
          tone="neutral"
          small
          onPress={() => {
            setDevSeconds(null);
            setMinutes((m) => Math.max(1, m - 1));
          }}
        />
        <OutlineButton
          label="+1 min"
          tone="neutral"
          small
          onPress={() => {
            setDevSeconds(null);
            setMinutes((m) => m + 1);
          }}
        />
        {__DEV__ && (
          <OutlineButton
            label="0:30 (dev)"
            tone="neutral"
            small
            onPress={() => setDevSeconds(30)}
          />
        )}
      </View>
      <OutlineButton
        label="Start timer"
        onPress={() => requestStart(task, durationSeconds)}
        style={{ marginTop: 18, minWidth: 220 }}
      />
    </View>
  );
}

export default function TimerScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ task?: string }>();
  const active = useTimerStore((s) => s.active);
  const lastCompleted = useTimerStore((s) => s.lastCompleted);
  const clearLastCompleted = useTimerStore((s) => s.clearLastCompleted);
  const pause = useTimerStore((s) => s.pause);
  const resume = useTimerStore((s) => s.resume);
  const addMinute = useTimerStore((s) => s.addMinute);
  const cancel = useTimerStore((s) => s.cancel);
  const remaining = useTimerTick();

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.navigate('/');
  };

  let body: React.ReactNode;
  if (active && remaining !== null) {
    const paused = !!active.pausedAtISO;
    const fraction = active.durationSeconds
      ? remaining / active.durationSeconds
      : 0;
    body = (
      <View style={styles.center}>
        <KeepAwakeWhileVisible />
        <NotificationDeniedNotice />
        <Kicker style={{ marginBottom: 10 }}>
          {paused ? 'Paused' : 'Timer running'}
        </Kicker>
        <ProgressRing fraction={fraction} size={220}>
          <Text style={[styles.countdown, paused && { color: colors.neutral500 }]}>
            {formatCountdown(remaining)}
          </Text>
        </ProgressRing>
        <Text style={styles.taskName}>{active.label}</Text>
        <View style={styles.controls}>
          {paused ? (
            <OutlineButton label="Resume" onPress={resume} style={styles.controlBtn} />
          ) : (
            <OutlineButton label="Pause" onPress={pause} style={styles.controlBtn} />
          )}
          <OutlineButton
            label="+1 min"
            tone="neutral"
            onPress={addMinute}
            style={styles.controlBtn}
          />
        </View>
        <OutlineButton
          label="Cancel"
          tone="ghost"
          onPress={() => {
            cancel();
            close();
          }}
          style={{ marginTop: 8, minWidth: 140 }}
        />
      </View>
    );
  } else if (lastCompleted) {
    body = (
      <CompletedState
        completed={lastCompleted}
        onDone={() => {
          clearLastCompleted();
          close();
        }}
      />
    );
  } else if (params.task) {
    body = <ReadyState taskKey={params.task as TaskKey} />;
  } else {
    body = (
      <View style={styles.center}>
        <Text style={styles.doneMeta}>No timer running.</Text>
        <OutlineButton
          label="Back"
          tone="neutral"
          onPress={close}
          style={{ marginTop: 18, minWidth: 160 }}
        />
      </View>
    );
  }

  return (
    <View
      style={[
        styles.screen,
        { paddingTop: insets.top + 10, paddingBottom: insets.bottom + 16 },
      ]}
    >
      <Pressable onPress={close} hitSlop={12} style={styles.closeRow}>
        <Text style={styles.closeText}>Close</Text>
      </Pressable>
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: space.screenX,
  },
  closeRow: {
    alignSelf: 'flex-end',
    paddingVertical: 6,
  },
  closeText: {
    fontFamily: font.medium,
    fontSize: 11,
    letterSpacing: 1.9,
    textTransform: 'uppercase',
    color: colors.neutral500,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 40,
  },
  countdown: {
    fontFamily: font.medium,
    fontSize: 44,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  taskName: {
    fontFamily: font.medium,
    fontSize: 17,
    color: colors.text,
    marginTop: 18,
  },
  controls: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 22,
  },
  controlBtn: {
    minWidth: 130,
  },
  stepperRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
  },
  doneTitle: {
    fontFamily: font.medium,
    fontSize: 24,
    color: colors.text,
    marginTop: 14,
  },
  doneMeta: {
    fontFamily: font.regular,
    fontSize: 13.5,
    color: colors.neutral400,
    marginTop: 6,
  },
  stepper: {
    borderRadius: radius.sm,
  },
  deniedNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: colors.neutral700,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 16,
  },
  deniedText: {
    flex: 1,
    fontFamily: font.regular,
    fontSize: 11.5,
    color: colors.neutral400,
    lineHeight: 15,
  },
});
