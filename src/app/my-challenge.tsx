import { useRouter } from 'expo-router';
import {
  CaretLeftIcon as CaretLeft,
  LockSimpleIcon as LockSimple,
} from 'phosphor-react-native';
import React, { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSheet } from '@/components/BottomSheet';
import { Card, Kicker, OutlineButton } from '@/components/ui';
import {
  isAboveStandard,
  targetText,
  TASK_BASES,
  TIERS,
} from '@/constants/tiers';
import type {
  BuiltinTaskKey,
  CustomTask,
  TaskDef,
  Tier,
} from '@/data/types';
import { DataService } from '@/services/DataService';
import { selectTierLabel, useAppStore } from '@/store/useAppStore';
import { toast } from '@/store/useToastStore';
import { colors, font, radius, space } from '@/theme/tokens';

function tomorrowDateLabel(): string {
  const d = new Date(Date.now() + 86_400_000);
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
}

/** Add/edit form for a custom task. */
function TaskFormSheet({
  visible,
  editing,
  onClose,
}: {
  visible: boolean;
  editing: CustomTask | null;
  onClose: () => void;
}) {
  const addCustomTask = useAppStore((s) => s.addCustomTask);
  const updateCustomTask = useAppStore((s) => s.updateCustomTask);

  const [name, setName] = useState(editing?.name ?? '');
  const [sub, setSub] = useState(editing?.sub ?? '');
  const [proof, setProof] = useState(editing?.proof ?? false);
  const [timer, setTimer] = useState(
    editing?.timerMinutes ? String(editing.timerMinutes) : '',
  );

  // Reset fields whenever the sheet opens for a different target.
  const [seenKey, setSeenKey] = useState<string | null>(null);
  const targetKey = visible ? (editing?.id ?? 'new') : null;
  if (targetKey !== seenKey) {
    setSeenKey(targetKey);
    if (targetKey !== null) {
      setName(editing?.name ?? '');
      setSub(editing?.sub ?? '');
      setProof(editing?.proof ?? false);
      setTimer(editing?.timerMinutes ? String(editing.timerMinutes) : '');
    }
  }

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast('Give it a name');
      return;
    }
    const minutes = parseInt(timer, 10);
    const timerMinutes =
      Number.isFinite(minutes) && minutes > 0 ? minutes : undefined;
    if (editing) {
      updateCustomTask(editing.id, {
        name: trimmed,
        sub: sub.trim(),
        proof,
        timerMinutes,
      });
      toast('Task updated — applies from tomorrow');
    } else {
      const ok = addCustomTask({
        name: trimmed,
        sub: sub.trim(),
        proof,
        timerMinutes,
      });
      if (!ok) {
        toast('Custom task limit reached (4)');
        return;
      }
      toast('Added — counts from tomorrow');
    }
    onClose();
  };

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Kicker style={{ marginBottom: 6 }}>
        {editing ? 'Edit task' : 'Add a task'}
      </Kicker>
      <Text style={styles.formWarning}>
        Anything you add here counts. Choose carefully — changes always start
        the next day.
      </Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Task name — e.g. No phone before 8am"
        placeholderTextColor={colors.neutral600}
        style={styles.input}
      />
      <TextInput
        value={sub}
        onChangeText={setSub}
        placeholder="Descriptor (optional)"
        placeholderTextColor={colors.neutral600}
        style={styles.input}
      />
      <View style={styles.formRow}>
        <Text style={styles.formLabel}>Requires proof photo</Text>
        <Switch
          value={proof}
          onValueChange={setProof}
          trackColor={{ false: colors.neutral800, true: colors.accent700 }}
          thumbColor={proof ? colors.accent300 : colors.neutral500}
        />
      </View>
      <View style={styles.formRow}>
        <Text style={styles.formLabel}>Timer duration (minutes, optional)</Text>
        <TextInput
          value={timer}
          onChangeText={setTimer}
          keyboardType="numeric"
          placeholder="—"
          placeholderTextColor={colors.neutral600}
          style={[styles.input, { width: 70, marginTop: 0, textAlign: 'center' }]}
        />
      </View>
      <OutlineButton
        label={editing ? 'Save changes' : 'Add task'}
        onPress={save}
        style={{ marginTop: 14 }}
      />
    </BottomSheet>
  );
}

/**
 * Editor for a tier task's target. Raising above standard is free (quiet
 * "above standard" marker); lowering below standard asks for confirmation
 * and relabels the challenge CUSTOM — the label, not the rules.
 */
function TargetEditorSheet({
  task,
  onClose,
}: {
  task: TaskDef | null;
  onClose: () => void;
}) {
  const tier = useAppStore((s) => s.tier);
  const updateTaskTarget = useAppStore((s) => s.updateTaskTarget);
  const [value, setValue] = useState('');
  const [confirmingLower, setConfirmingLower] = useState(false);
  const [seenKey, setSeenKey] = useState<string | null>(null);

  const openKey = task ? task.key : null;
  if (openKey !== seenKey) {
    setSeenKey(openKey);
    if (task?.target) setValue(String(task.target.value));
    setConfirmingLower(false);
  }

  if (!task?.target) return null;
  const base = TASK_BASES[task.key as BuiltinTaskKey];
  const standard = task.tierStandard;
  const parsed = parseInt(value, 10);
  const valid = Number.isFinite(parsed) && parsed >= 1;

  const apply = () => {
    updateTaskTarget(task.key, parsed);
    toast('Target updated — applies from tomorrow');
    onClose();
  };

  const save = () => {
    if (!valid) return;
    if (standard && parsed < standard.value && !confirmingLower) {
      setConfirmingLower(true);
      return;
    }
    apply();
  };

  return (
    <BottomSheet visible={!!task} onClose={onClose}>
      <Kicker style={{ marginBottom: 6 }}>
        {base?.shortName ?? task.label} — target
      </Kicker>
      {standard && (
        <Text style={styles.standardRef}>
          {TIERS[tier].label} standard: {targetText(standard)}
        </Text>
      )}

      {!confirmingLower ? (
        <>
          <View style={styles.targetRow}>
            <OutlineButton
              label="−"
              small
              tone="neutral"
              onPress={() => setValue(String(Math.max(1, (parsed || 1) - (task.target!.unit === 'minutes' ? 5 : 1))))}
            />
            <TextInput
              value={value}
              onChangeText={setValue}
              keyboardType="numeric"
              style={styles.targetInput}
            />
            <Text style={styles.targetUnit}>{task.target.unit}</Text>
            <OutlineButton
              label="+"
              small
              tone="neutral"
              onPress={() => setValue(String((parsed || 0) + (task.target!.unit === 'minutes' ? 5 : 1)))}
            />
          </View>
          <OutlineButton
            label="Save target"
            onPress={save}
            style={{ marginTop: 14 }}
          />
        </>
      ) : (
        <>
          <Text style={styles.lowerConfirm}>
            Lowering this below the {TIERS[tier].label} standard. Your
            challenge will show as CUSTOM.
          </Text>
          <OutlineButton label="Confirm" onPress={apply} style={{ marginBottom: 8 }} />
          <OutlineButton
            label="Cancel"
            tone="neutral"
            onPress={() => setConfirmingLower(false)}
          />
        </>
      )}
    </BottomSheet>
  );
}

/** Confirmation for a tier change — significant, effective tomorrow. */
function TierConfirmSheet({
  target,
  onClose,
}: {
  target: Tier | null;
  onClose: () => void;
}) {
  const tier = useAppStore((s) => s.tier);
  const requestTierChange = useAppStore((s) => s.requestTierChange);
  if (!target) return null;
  const def = TIERS[target];

  return (
    <BottomSheet visible={!!target} onClose={onClose}>
      <Kicker style={{ marginBottom: 10 }}>
        Change tier — {TIERS[tier].label} to {def.label}
      </Kicker>
      <Text style={styles.tierConfirmText}>
        {def.taskKeys.length} tier tasks instead of{' '}
        {TIERS[tier].taskKeys.length}. A missed day will now mean:{' '}
        {def.missedDay.restartsChallenge
          ? 'the challenge restarts at Day 1.'
          : 'the streak resets; the day count continues.'}
      </Text>
      <Text style={styles.tierConfirmMeta}>
        Takes effect tomorrow. Your streak and day count carry over —
        historical days keep the tier they were completed under.
      </Text>
      <OutlineButton
        label={`Switch to ${def.label} tomorrow`}
        onPress={() => {
          requestTierChange(target);
          toast(`Tier changes to ${def.label} tomorrow`);
          onClose();
        }}
        style={{ marginBottom: 8 }}
      />
      <OutlineButton label="Keep current tier" tone="neutral" onPress={onClose} />
    </BottomSheet>
  );
}

function TaskRow({
  task,
  meta,
  struck,
  onEdit,
  onRemove,
}: {
  task: TaskDef | { key: string; label: string; sub: string };
  meta?: string;
  struck?: boolean;
  onEdit?: () => void;
  onRemove?: () => void;
}) {
  return (
    <View style={styles.taskRow}>
      <View style={{ flex: 1 }}>
        <Text
          style={[
            styles.taskLabel,
            struck && {
              textDecorationLine: 'line-through',
              color: colors.neutral500,
            },
          ]}
        >
          {task.label}
        </Text>
        {meta ? <Text style={styles.taskMeta}>{meta}</Text> : null}
      </View>
      {onEdit && <OutlineButton label="Edit" small tone="neutral" onPress={onEdit} />}
      {onRemove && (
        <OutlineButton label="Remove" small tone="neutral" onPress={onRemove} />
      )}
    </View>
  );
}

export default function MyChallengeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const tier = useAppStore((s) => s.tier);
  const day = useAppStore((s) => s.day);
  const todayTasks = useAppStore((s) => s.todayTasks);
  const tomorrowTasks = useAppStore((s) => s.tomorrowTasks);
  const customTasks = useAppStore((s) => s.customTasks);
  const pending = useAppStore((s) => s.pendingChanges);
  const removeCustomTask = useAppStore((s) => s.removeCustomTask);
  const undoPendingChanges = useAppStore((s) => s.undoPendingChanges);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CustomTask | null>(null);
  const [tierTarget, setTierTarget] = useState<Tier | null>(null);
  const [targetTask, setTargetTask] = useState<TaskDef | null>(null);
  const tierLabelNow = useAppStore(selectTierLabel);

  const hasPending =
    pending.addedTomorrow.length > 0 ||
    pending.removedTomorrow.length > 0 ||
    pending.pendingTier != null ||
    pending.targetChanges.length > 0;

  const customByKey = new Map(customTasks.map((c) => [`custom-${c.id}`, c]));

  // Recent day snapshots — history renders against what was in force then,
  // including the target values of that day (not today's).
  const history: { day: number; count: number; targets: string }[] = [];
  for (let d = day - 1; d >= Math.max(1, day - 5); d--) {
    const snap = DataService.getDaySnapshot(d);
    if (snap) {
      history.push({
        day: d,
        count: snap.length,
        targets: snap
          .filter((t) => t.target)
          .map((t) => t.label)
          .join(' · '),
      });
    }
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 10 }]}
    >
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <CaretLeft size={20} color={colors.neutral400} />
        </Pressable>
        <Text style={styles.title}>My Challenge</Text>
        <View style={{ width: 20 }} />
      </View>

      <Card>
        <View style={styles.summaryRow}>
          <View style={styles.summaryCell}>
            <Text style={styles.summaryValue}>{tierLabelNow}</Text>
            <Kicker color={colors.neutral500}>
              {tierLabelNow === 'Custom' ? `${TIERS[tier].label} rules` : 'Tier'}
            </Kicker>
          </View>
          <View style={styles.summaryCell}>
            <Text style={styles.summaryValue}>{day}</Text>
            <Kicker color={colors.neutral500}>Day</Kicker>
          </View>
          <View style={styles.summaryCell}>
            <Text style={styles.summaryValue}>{todayTasks.length}</Text>
            <Kicker color={colors.neutral500}>Tasks today</Kicker>
          </View>
        </View>
      </Card>

      <View style={styles.sectionHeader}>
        <Kicker>Today{'\u2019'}s tasks</Kicker>
        <View style={styles.lockRow}>
          <LockSimple size={11} color={colors.neutral500} />
          <Text style={styles.lockText}>locked</Text>
        </View>
      </View>
      <Text style={styles.lockCopy}>
        Today{'\u2019'}s tasks are locked. Changes start tomorrow.
      </Text>
      <Card style={{ marginTop: 8 }}>
        {todayTasks.map((t) => (
          <TaskRow
            key={t.key}
            task={t}
            meta={t.timerMinutes ? `${t.timerMinutes} min timer` : undefined}
          />
        ))}
      </Card>

      <View style={[styles.sectionHeader, { marginTop: 20 }]}>
        <Kicker>Tomorrow{'\u2019'}s tasks</Kicker>
        <Text style={styles.countMeta}>{tomorrowTasks.length} tasks</Text>
      </View>
      <Card style={{ marginTop: 8 }}>
        {tomorrowTasks.map((t) => {
          const custom = customByKey.get(t.key);
          const isPendingAdd = custom
            ? custom.activeFromDay === day + 1
            : false;
          const above = !custom && isAboveStandard(t);
          const tierMeta = above
            ? 'above standard'
            : !custom && t.key === 'workout2' && t.target
              ? targetText(t.target)
              : undefined;
          return (
            <TaskRow
              key={t.key}
              task={t}
              meta={
                isPendingAdd
                  ? 'starts tomorrow'
                  : custom
                    ? 'custom task'
                    : tierMeta
              }
              onEdit={
                custom
                  ? () => {
                      setEditing(custom);
                      setFormOpen(true);
                    }
                  : t.target
                    ? () => setTargetTask(t)
                    : undefined
              }
              onRemove={
                custom
                  ? () => {
                      removeCustomTask(custom.id);
                      toast(
                        custom.activeFromDay > day
                          ? 'Pending task removed'
                          : 'Removed from tomorrow',
                      );
                    }
                  : undefined
              }
            />
          );
        })}
        {pending.removedTomorrow.map((c) => (
          <TaskRow
            key={c.id}
            task={{ key: c.id, label: c.name, sub: c.sub }}
            struck
            meta="removed from tomorrow"
          />
        ))}
      </Card>
      <Text style={styles.tierNote}>
        Tier tasks can{'\u2019'}t be removed — changing tier is the heavier
        move below.
      </Text>

      <OutlineButton
        label="Add a task"
        onPress={() => {
          setEditing(null);
          setFormOpen(true);
        }}
        style={{ marginTop: 12 }}
      />

      <Kicker style={{ marginTop: 22, marginBottom: 8 }}>Tier</Kicker>
      <Card>
        {(Object.keys(TIERS) as Tier[]).map((t, i) => {
          const def = TIERS[t];
          const active = t === tier;
          const isPendingTier = pending.pendingTier === t;
          return (
            <Pressable
              key={t}
              onPress={() => {
                if (!active && !isPendingTier) setTierTarget(t);
              }}
              style={[styles.tierRow, i > 0 && styles.rowBorder]}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.taskLabel}>
                  {def.label}
                  {active ? '  ·  current' : ''}
                  {isPendingTier ? '  ·  from tomorrow' : ''}
                </Text>
                <Text style={styles.taskMeta}>
                  {def.taskKeys.length} tasks ·{' '}
                  {def.missedDay.restartsChallenge
                    ? 'a miss restarts at Day 1'
                    : 'a miss resets the streak'}
                </Text>
              </View>
              {(active || isPendingTier) && (
                <View style={styles.tierTag}>
                  <Text style={styles.tierTagText}>
                    {active ? 'NOW' : 'TOMORROW'}
                  </Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </Card>
      <Text style={styles.tierNote}>
        Historical days keep the tier they were completed under.
      </Text>

      {history.length > 0 && (
        <>
          <Kicker style={{ marginTop: 22, marginBottom: 8 }}>History</Kicker>
          <Card>
            {history.map((h) => (
              <View key={h.day} style={styles.historyRow}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={styles.taskLabel}>Day {h.day}</Text>
                  <Text style={styles.taskMeta}>
                    {h.count} tasks were in force
                  </Text>
                </View>
                {h.targets ? (
                  <Text style={styles.historyTargets}>{h.targets}</Text>
                ) : null}
              </View>
            ))}
          </Card>
        </>
      )}

      {hasPending && (
        <Card style={styles.pendingBar}>
          <View style={{ flex: 1 }}>
            <Text style={styles.pendingText}>
              {pending.todayCount} tasks today → {pending.tomorrowCount}{' '}
              tasks tomorrow.
            </Text>
            <Text style={styles.pendingMeta}>
              Starts {tomorrowDateLabel()}
              {pending.pendingTier
                ? ` · tier → ${TIERS[pending.pendingTier].label}`
                : ''}
              {pending.targetChanges
                .map(
                  (c) =>
                    ` · ${c.name} → ${targetText({ value: c.toValue, unit: c.unit })}`,
                )
                .join('')}
            </Text>
          </View>
          <OutlineButton
            label="Undo changes"
            small
            tone="neutral"
            onPress={() => {
              undoPendingChanges();
              toast('Pending changes cleared');
            }}
          />
        </Card>
      )}

      <TaskFormSheet
        visible={formOpen}
        editing={editing}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
      />
      <TierConfirmSheet target={tierTarget} onClose={() => setTierTarget(null)} />
      <TargetEditorSheet task={targetTask} onClose={() => setTargetTask(null)} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: space.screenX,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  title: {
    fontFamily: font.medium,
    fontSize: 20,
    color: colors.text,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  summaryCell: {
    alignItems: 'center',
    gap: 4,
  },
  summaryValue: {
    fontFamily: font.medium,
    fontSize: 20,
    color: colors.text,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 18,
  },
  lockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  lockText: {
    fontFamily: font.medium,
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.neutral500,
  },
  lockCopy: {
    fontFamily: font.regular,
    fontSize: 12,
    color: colors.neutral500,
    marginTop: 4,
  },
  countMeta: {
    fontFamily: font.regular,
    fontSize: 11.5,
    color: colors.neutral500,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    paddingVertical: 4,
  },
  taskLabel: {
    fontFamily: font.regular,
    fontSize: 14,
    color: colors.text,
  },
  taskMeta: {
    fontFamily: font.regular,
    fontSize: 11,
    color: colors.accent400,
    marginTop: 2,
  },
  tierNote: {
    fontFamily: font.regular,
    fontSize: 11.5,
    color: colors.neutral600,
    marginTop: 8,
  },
  tierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 52,
    paddingVertical: 6,
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  tierTag: {
    backgroundColor: colors.accent800,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  tierTagText: {
    fontFamily: font.medium,
    fontSize: 9,
    letterSpacing: 1.1,
    color: colors.accent100,
  },
  historyRow: {
    minHeight: 40,
    justifyContent: 'center',
    paddingVertical: 6,
  },
  historyTargets: {
    fontFamily: font.regular,
    fontSize: 11,
    color: colors.neutral500,
    marginTop: 3,
  },
  pendingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 20,
    borderWidth: 1,
    borderColor: colors.accent800,
  },
  pendingText: {
    fontFamily: font.medium,
    fontSize: 13,
    color: colors.text,
  },
  pendingMeta: {
    fontFamily: font.regular,
    fontSize: 11.5,
    color: colors.accent300,
    marginTop: 2,
  },
  formWarning: {
    fontFamily: font.regular,
    fontSize: 12,
    color: colors.neutral500,
    marginBottom: 10,
    lineHeight: 17,
  },
  input: {
    fontFamily: font.regular,
    fontSize: 13.5,
    color: colors.text,
    minHeight: 42,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
    marginTop: 8,
  },
  formRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 12,
  },
  formLabel: {
    fontFamily: font.regular,
    fontSize: 13,
    color: colors.neutral300,
  },
  tierConfirmText: {
    fontFamily: font.regular,
    fontSize: 13.5,
    color: colors.neutral300,
    lineHeight: 19,
  },
  standardRef: {
    fontFamily: font.regular,
    fontSize: 12,
    color: colors.neutral500,
    marginBottom: 12,
  },
  targetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  targetInput: {
    fontFamily: font.medium,
    fontSize: 18,
    color: colors.text,
    minHeight: 44,
    width: 84,
    textAlign: 'center',
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
    fontVariant: ['tabular-nums'],
  },
  targetUnit: {
    flex: 1,
    fontFamily: font.regular,
    fontSize: 13,
    color: colors.neutral400,
  },
  lowerConfirm: {
    fontFamily: font.regular,
    fontSize: 13.5,
    color: colors.neutral300,
    lineHeight: 19,
    marginBottom: 14,
  },
  tierConfirmMeta: {
    fontFamily: font.regular,
    fontSize: 12,
    color: colors.neutral500,
    lineHeight: 17,
    marginTop: 8,
    marginBottom: 14,
  },
});
