import { buildTierTask, TASK_BASES, taskLabel, TIERS } from '@/constants/tiers';
import type {
  BuiltinTaskKey,
  CustomTask,
  TargetChange,
  TaskDef,
  TaskKey,
  TaskTarget,
  Tier,
} from '@/data/types';

/**
 * Pure task-set projection, shared by the mock and the Supabase service so
 * the two can never drift. The server owns the authoritative frozen snapshot
 * for today; this module is what renders TOMORROW's preview from the same
 * inputs (tier + custom tasks + target overrides) that the server's
 * compose_task_set() uses at rollover.
 */

export interface TaskConfigInputs {
  customTasks: CustomTask[];
  targetOverrides: Partial<Record<TaskKey, number>>;
}

/**
 * A task as the SERVER's frozen snapshot stores it (compose_task_set).
 *
 * Data only: what the task IS. It deliberately carries no label, no
 * sub-line and no timer length, because those are presentation — a stored
 * label would freeze today's wording into the database and go stale the
 * moment the copy or the design changes.
 */
export interface SnapshotTask {
  key: TaskKey;
  /** tier_standards.short_name, or a custom task's name. */
  shortName: string;
  proof: boolean;
  target: TaskTarget | null;
  tierStandard: TaskTarget | null;
}

/**
 * Snapshot row -> TaskDef: the one place the server's shape becomes the
 * app's shape.
 *
 * Every screen was written against MockDataService, whose tasks arrive from
 * buildTierTask() complete with label, sub, timerMinutes and timerUserSet.
 * The snapshot has none of them, so handing a raw snapshot to the UI is a
 * crash (`t.label.split`) and, quieter, a timed task that never offers a
 * timer. Deriving them here — from the same TASK_BASES the mock uses — is
 * what makes the two implementations produce identical TaskDefs.
 *
 * `customs` supplies a custom task's sub-line, which the snapshot does not
 * store; it is matched by the `custom-<id>` key.
 */
export function taskFromSnapshot(
  raw: SnapshotTask,
  customs: CustomTask[] = [],
): TaskDef {
  const target = raw.target ?? null;
  const base = TASK_BASES[raw.key as BuiltinTaskKey] as
    | (typeof TASK_BASES)[BuiltinTaskKey]
    | undefined;

  if (base) {
    return {
      key: raw.key,
      label: taskLabel(raw.key as BuiltinTaskKey, raw.shortName, target?.value ?? null),
      sub: base.sub,
      proof: raw.proof,
      target,
      tierStandard: raw.tierStandard ?? null,
      timerMinutes:
        target?.unit === 'minutes'
          ? target.value
          : base.timerUserSet
            ? 10
            : undefined,
      timerUserSet: base.timerUserSet,
    };
  }

  // custom-<uuid>. The name is in the snapshot; the sub-line is not.
  const custom = customs.find((c) => `custom-${c.id}` === raw.key);
  return {
    key: raw.key,
    label: custom?.name ?? raw.shortName,
    sub: custom?.sub ?? '',
    proof: raw.proof,
    target,
    tierStandard: null,
    timerMinutes: target?.unit === 'minutes' ? target.value : undefined,
  };
}

export function customToDef(c: CustomTask): TaskDef {
  return {
    key: `custom-${c.id}`,
    label: c.name,
    sub: c.sub,
    proof: c.proof,
    // One source of truth: a custom timer duration IS a minutes target.
    target: c.timerMinutes ? { value: c.timerMinutes, unit: 'minutes' } : null,
    tierStandard: null,
    timerMinutes: c.timerMinutes,
  };
}

/**
 * The live task set for a given day: tier tasks (with target overrides
 * resolved to values — snapshots store data, not references) + customs
 * active on that day.
 */
export function composeTaskSet(
  tier: Tier,
  day: number,
  { customTasks, targetOverrides }: TaskConfigInputs,
): TaskDef[] {
  const tierTasks = TIERS[tier].taskKeys.map((key) =>
    buildTierTask(tier, key, targetOverrides[key]),
  );
  const customs = customTasks
    .filter(
      (c) =>
        c.activeFromDay <= day &&
        (c.removedFromDay == null || c.removedFromDay > day),
    )
    .map(customToDef);
  return [...tierTasks, ...customs];
}

/** Target edits made today (they apply tomorrow). */
export function pendingTargetChanges(
  currentTier: Tier,
  targetOverrides: Partial<Record<TaskKey, number>>,
  overridesAtDayStart: Partial<Record<TaskKey, number>>,
): TargetChange[] {
  const keys = new Set([
    ...Object.keys(targetOverrides),
    ...Object.keys(overridesAtDayStart),
  ]) as Set<BuiltinTaskKey>;
  const changes: TargetChange[] = [];
  for (const key of keys) {
    const base = TASK_BASES[key];
    if (!base?.unit) continue;
    const standard = TIERS[currentTier].standards[key];
    const from = overridesAtDayStart[key] ?? standard;
    const to = targetOverrides[key] ?? standard;
    if (from != null && to != null && from !== to) {
      changes.push({
        taskKey: key,
        name: base.shortName,
        fromValue: from,
        toValue: to,
        unit: base.unit,
      });
    }
  }
  return changes;
}

export function tierStandards(tier: Tier): Partial<Record<TaskKey, TaskTarget>> {
  const out: Partial<Record<TaskKey, TaskTarget>> = {};
  for (const key of TIERS[tier].taskKeys) {
    const base = TASK_BASES[key];
    const value = TIERS[tier].standards[key];
    if (base.unit && value != null) out[key] = { value, unit: base.unit };
  }
  return out;
}

/** Default activity chips for the workout capture sheet. */
export const DEFAULT_ACTIVITY_TYPES = [
  'Push',
  'Pull',
  'Legs',
  'Full Body',
  'Run',
  'Walk',
  'Cycle',
  'Pilates',
  'Yoga',
  'Class',
];
