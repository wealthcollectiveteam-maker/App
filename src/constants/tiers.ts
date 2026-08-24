import type {
  BuiltinTaskKey,
  TaskDef,
  TaskTarget,
  TargetUnit,
  Tier,
} from '@/data/types';

/**
 * Base (target-independent) task metadata. Labels are RENDERED from the
 * task's target — the quantity is data, not text baked into a string.
 */
interface TaskBase {
  key: BuiltinTaskKey;
  /** Short name used in feed entries and target editors ("Read"). */
  shortName: string;
  sub: string;
  proof: boolean;
  /** Unit of this task's quantity; null = no meaningful quantity. */
  unit: TargetUnit | null;
  timerUserSet?: boolean;
}

export const TASK_BASES: Record<BuiltinTaskKey, TaskBase> = {
  workout1: {
    key: 'workout1',
    shortName: 'Workout 1',
    sub: 'Indoors or out. No skipping.',
    proof: true,
    unit: 'minutes',
  },
  workout2: {
    key: 'workout2',
    shortName: 'Workout 2',
    sub: 'Outdoors, whatever the weather.',
    proof: true,
    unit: 'minutes',
  },
  water: {
    key: 'water',
    shortName: 'Water',
    sub: 'Across the whole day.',
    proof: false,
    unit: 'gallons',
  },
  read: {
    key: 'read',
    shortName: 'Read',
    sub: 'Pages of a real book.',
    proof: false,
    unit: 'pages',
    timerUserSet: true,
  },
  diet: {
    key: 'diet',
    shortName: 'Diet',
    sub: 'No cheat meals. No alcohol.',
    proof: false,
    unit: null,
  },
  photo: {
    key: 'photo',
    shortName: 'Progress photo',
    sub: 'One photo. Same spot every day.',
    proof: true,
    unit: null,
  },
};

/** "15 pages", "60 min", "1 gallon", "2 gallons", "3". */
export function targetText(target: TaskTarget): string {
  switch (target.unit) {
    case 'minutes':
      return `${target.value} min`;
    case 'pages':
      return `${target.value} page${target.value === 1 ? '' : 's'}`;
    case 'gallons':
      return `${target.value} gallon${target.value === 1 ? '' : 's'}`;
    case 'litres':
      return `${target.value} litre${target.value === 1 ? '' : 's'}`;
    case 'count':
      return String(target.value);
  }
}

/**
 * Render a builtin task's display label from its short name and target.
 *
 * Split out from renderTaskLabel because the SERVER's frozen snapshot
 * carries the short name (tier_standards.short_name) but not the tier, and
 * both sources must produce the identical string — the label is derived
 * presentation, never stored.
 */
export function taskLabel(
  key: BuiltinTaskKey,
  shortName: string,
  value: number | null,
): string {
  switch (key) {
    case 'workout1':
      return `${shortName} — ${value} min`;
    case 'workout2':
      // Descriptive label by design; its minutes drive the timer + editor.
      return 'Workout 2 — outdoors';
    case 'water':
      return value === 1 ? 'Gallon of water' : `${value} gallons of water`;
    case 'read':
      return `Read ${value} page${value === 1 ? '' : 's'}`;
    case 'diet':
      return 'Follow the diet';
    case 'photo':
      return 'Progress photo';
  }
}

/** The same label, for a tier task built locally. */
export function renderTaskLabel(
  key: BuiltinTaskKey,
  tier: Tier,
  value: number | null,
): string {
  // The only name that varies by tier: a single-workout tier drops the "1".
  const shortName =
    key === 'workout1' && !TIERS[tier].taskKeys.includes('workout2')
      ? 'Workout'
      : TASK_BASES[key].shortName;
  return taskLabel(key, shortName, value);
}

export interface TierDef {
  key: Tier;
  label: string;
  /** Two-word descriptor shown beside the tier name on the picker. */
  tagline: string;
  taskKeys: BuiltinTaskKey[];
  workoutMinutes: number;
  /** Standard target values per task for this tier. */
  standards: Partial<Record<BuiltinTaskKey, number>>;
  missedDay: {
    /** Hard: the whole challenge restarts at Day 1. */
    restartsChallenge: boolean;
    /** All tiers reset the streak flame on a miss. */
    resetsStreak: boolean;
    /** Banner body copy; `{day}` is replaced with the current day. */
    copy: string;
  };
}

export const TIERS: Record<Tier, TierDef> = {
  hard: {
    key: 'hard',
    label: 'Hard',
    tagline: 'The original',
    taskKeys: ['workout1', 'workout2', 'water', 'read', 'diet', 'photo'],
    workoutMinutes: 45,
    standards: { workout1: 45, workout2: 45, water: 1, read: 10 },
    missedDay: {
      restartsChallenge: true,
      resetsStreak: true,
      copy: 'Hard rules: the clock resets. Day 1 — again.',
    },
  },
  medium: {
    key: 'medium',
    label: 'Medium',
    tagline: 'Build the base',
    taskKeys: ['workout1', 'water', 'read', 'diet', 'photo'],
    workoutMinutes: 45,
    standards: { workout1: 45, water: 1, read: 10 },
    missedDay: {
      restartsChallenge: false,
      resetsStreak: true,
      copy: 'Streak broken. Day {day} still counts. Lock back in.',
    },
  },
  soft: {
    key: 'soft',
    label: 'Soft',
    tagline: 'Keep the habit',
    taskKeys: ['workout1', 'water', 'read', 'diet'],
    workoutMinutes: 45,
    standards: { workout1: 45, water: 1, read: 10 },
    missedDay: {
      restartsChallenge: false,
      resetsStreak: true,
      copy: 'A miss, not a quit. Pick it back up today.',
    },
  },
};

/**
 * Build a tier task's resolved TaskDef for a given target value (override
 * or standard). Snapshots store this resolved form — value, not reference.
 */
export function buildTierTask(
  tier: Tier,
  key: BuiltinTaskKey,
  overrideValue?: number,
): TaskDef {
  const base = TASK_BASES[key];
  const standardValue = TIERS[tier].standards[key] ?? null;
  const value = overrideValue ?? standardValue;
  const target: TaskTarget | null =
    base.unit && value != null ? { value, unit: base.unit } : null;
  const tierStandard: TaskTarget | null =
    base.unit && standardValue != null
      ? { value: standardValue, unit: base.unit }
      : null;
  return {
    key,
    label: renderTaskLabel(key, tier, value),
    sub: base.sub,
    proof: base.proof,
    target,
    tierStandard,
    timerMinutes:
      target?.unit === 'minutes'
        ? target.value
        : base.timerUserSet
          ? 10
          : undefined,
    timerUserSet: base.timerUserSet,
  };
}

/** Per-tier task arrays at STANDARD targets (stable references). */
export const TIER_TASKS: Record<Tier, TaskDef[]> = Object.fromEntries(
  (Object.keys(TIERS) as Tier[]).map((tier) => [
    tier,
    TIERS[tier].taskKeys.map((key) => buildTierTask(tier, key)),
  ]),
) as Record<Tier, TaskDef[]>;

export const tierTaskCount = (tier: Tier) => TIER_TASKS[tier].length;

export const missedDayCopy = (tier: Tier, day: number) =>
  TIERS[tier].missedDay.copy.replace('{day}', String(day));

/**
 * The consequence line shown INSIDE a tier's card on the picker.
 *
 * Derived from that tier's missed-day rules, never from a hardcoded string
 * per tier: "miss a task, restart at day one" is true of hard alone, and as
 * a blanket line under the heading it was simply false for the other two.
 */
export function missedDayLine(tier: Tier): string {
  const { restartsChallenge, resetsStreak } = TIERS[tier].missedDay;
  if (restartsChallenge) return 'Miss a task, restart at day one.';
  if (resetsStreak) {
    return 'Miss a task, the streak resets. Your day count continues.';
  }
  return 'Miss a task, the day still counts.';
}

/** Every task in a tier, at standard targets, as one readable line. */
export const tierTaskSummary = (tier: Tier): string =>
  TIER_TASKS[tier].map((t) => t.label).join(' · ');

/**
 * The displayed tier label for a task set: any tier task below its
 * standard relabels the challenge CUSTOM. The label describes the targets;
 * the base tier keeps owning the rules (missed-day penalty).
 */
export function displayTierLabel(tasks: TaskDef[], baseTier: Tier): string {
  const belowStandard = tasks.some(
    (t) =>
      t.target &&
      t.tierStandard &&
      t.target.value < t.tierStandard.value,
  );
  return belowStandard ? 'Custom' : TIERS[baseTier].label;
}

/** True when a task runs above its tier standard (quiet accent marker). */
export function isAboveStandard(task: TaskDef): boolean {
  return !!(
    task.target &&
    task.tierStandard &&
    task.target.value > task.tierStandard.value
  );
}