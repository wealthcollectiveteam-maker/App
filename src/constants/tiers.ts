import type {
  BuiltinTaskKey,
  PendingChanges,
  TaskDef,
  TaskTarget,
  Tier,
} from '@/data/types';

/**
 * Tier-independent task metadata: the things that are true of a task in
 * every tier. Everything that VARIES by tier — its name, its descriptor and
 * its standard quantity — lives in TIERS below, because that variation is
 * what makes one tier a different challenge rather than a shorter list.
 */
interface TaskBase {
  key: BuiltinTaskKey;
  /**
   * Neutral short name for editors and feed entries ("Read", "Water").
   * The tier's own `name` is what the LABEL is rendered from.
   */
  shortName: string;
  /** Fallback descriptor for a snapshot rendered without a known tier. */
  sub: string;
  proof: boolean;
  /** User picks the duration before starting (e.g. reading). */
  timerUserSet?: boolean;
}

export const TASK_BASES: Record<BuiltinTaskKey, TaskBase> = {
  workout1: {
    key: 'workout1',
    shortName: 'Workout 1',
    sub: 'Indoors or out. No skipping.',
    proof: true,
  },
  workout2: {
    key: 'workout2',
    shortName: 'Workout 2',
    sub: 'The second session of the day.',
    proof: true,
  },
  water: {
    key: 'water',
    shortName: 'Water',
    sub: 'Across the whole day.',
    proof: false,
  },
  read: {
    key: 'read',
    shortName: 'Read',
    sub: 'Pages of a real book.',
    proof: false,
    timerUserSet: true,
  },
  diet: {
    key: 'diet',
    shortName: 'Diet',
    sub: 'Hold the line at every meal.',
    proof: false,
  },
  photo: {
    key: 'photo',
    shortName: 'Progress photo',
    sub: 'One photo. Same spot every day.',
    proof: true,
  },
};

/** "15 pages", "60 min", "1 gallon", "3 litres", "3". */
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
 * Render a builtin task's display label from the tier's name for it and the
 * target in force.
 *
 * Split out from buildTierTask because the SERVER's frozen snapshot carries
 * the tier's name (tier_standards.short_name) but not the tier, and both
 * sources must produce the identical string — the label is derived
 * presentation, never stored.
 */
export function taskLabel(
  key: BuiltinTaskKey,
  name: string,
  target: TaskTarget | null,
): string {
  switch (key) {
    case 'workout1':
    case 'workout2':
      return target ? `${name} — ${targetText(target)}` : name;
    case 'water':
      if (!target) return name;
      // "Gallon of water" is the 75 Hard phrase; everything else is counted.
      return target.unit === 'gallons' && target.value === 1
        ? 'Gallon of water'
        : `${targetText(target)} of water`;
    case 'read':
      return target ? `Read ${targetText(target)}` : name;
    case 'diet':
    case 'photo':
      // The tier's own name IS the label — "Follow the diet", "Eat well".
      return name;
  }
}

/**
 * One task as a tier defines it.
 *
 * The descriptor is not decoration. "No cheat meals, no alcohol" versus
 * "one planned cheat meal a week" is the entire difference between Hard and
 * Medium on the same task key, so it is data here and it is rendered on the
 * task row and the check-in card.
 */
export interface TierTaskDef {
  key: BuiltinTaskKey;
  /** The tier's name for this task — mirrors tier_standards.short_name. */
  name: string;
  sub: string;
  /** This tier's standard quantity. null = the task carries no quantity. */
  standard: TaskTarget | null;
}

export interface TierDef {
  key: Tier;
  label: string;
  /** Two-word descriptor shown beside the tier name on the picker. */
  tagline: string;
  /** One line on what the tier asks of you, for the picker card. */
  promise: string;
  tasks: TierTaskDef[];
  missedDay: {
    /** Hard: the whole challenge restarts at Day 1. */
    restartsChallenge: boolean;
    /** All tiers reset the streak flame on a miss. */
    resetsStreak: boolean;
    /** Banner body copy; `{day}` is replaced with the current day. */
    copy: string;
  };
}

/**
 * The tier defaults.
 *
 * DEFAULTS, not rules: every target here can be edited in My Challenge, and
 * lowering one relabels the challenge CUSTOM. What they set is what a tier
 * means before anybody touches it — and the tiers differ in what the tasks
 * DEMAND, not only in how many there are.
 */
export const TIERS: Record<Tier, TierDef> = {
  hard: {
    key: 'hard',
    label: 'Hard',
    tagline: 'The original',
    promise: 'The traditional 75 Hard.',
    tasks: [
      {
        key: 'workout1',
        name: 'Workout 1',
        sub: 'Indoors or out. No skipping.',
        standard: { value: 45, unit: 'minutes' },
      },
      {
        key: 'workout2',
        name: 'Workout 2',
        sub: 'Outdoors, whatever the weather.',
        standard: { value: 45, unit: 'minutes' },
      },
      {
        key: 'water',
        name: 'Water',
        sub: 'Across the whole day.',
        standard: { value: 1, unit: 'gallons' },
      },
      {
        key: 'read',
        name: 'Read',
        sub: 'Non-fiction. A real book.',
        standard: { value: 10, unit: 'pages' },
      },
      {
        key: 'diet',
        name: 'Follow the diet',
        sub: 'No cheat meals. No alcohol.',
        standard: null,
      },
      {
        key: 'photo',
        name: 'Progress photo',
        sub: 'One photo. Same spot every day.',
        standard: null,
      },
    ],
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
    promise: 'Serious, sustainable.',
    tasks: [
      {
        key: 'workout1',
        name: 'Workout',
        sub: 'Indoors or out. No skipping.',
        standard: { value: 45, unit: 'minutes' },
      },
      {
        key: 'workout2',
        name: 'Move again',
        sub: 'Any form. A walk counts.',
        standard: { value: 30, unit: 'minutes' },
      },
      {
        key: 'water',
        name: 'Water',
        sub: 'Across the whole day.',
        standard: { value: 3, unit: 'litres' },
      },
      {
        key: 'read',
        name: 'Read',
        sub: 'Pages of a real book.',
        standard: { value: 10, unit: 'pages' },
      },
      {
        key: 'diet',
        name: 'Follow the diet',
        sub: 'One planned cheat meal a week.',
        standard: null,
      },
    ],
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
    promise: 'Real, but survivable alongside a life.',
    tasks: [
      {
        key: 'workout1',
        name: 'Workout',
        sub: 'One rest day a week.',
        standard: { value: 45, unit: 'minutes' },
      },
      {
        key: 'water',
        name: 'Water',
        sub: 'Across the whole day.',
        standard: { value: 3, unit: 'litres' },
      },
      {
        key: 'read',
        name: 'Read',
        sub: 'Pages of a real book.',
        standard: { value: 10, unit: 'pages' },
      },
      {
        key: 'diet',
        name: 'Eat well',
        sub: 'Alcohol only on social occasions.',
        standard: null,
      },
    ],
    missedDay: {
      restartsChallenge: false,
      resetsStreak: true,
      copy: 'A miss, not a quit. Pick it back up today.',
    },
  },
};

/** The tier's task keys, in order. Derived — never a second list. */
export const tierTaskKeys = (tier: Tier): BuiltinTaskKey[] =>
  TIERS[tier].tasks.map((t) => t.key);

/** How a tier defines one task; undefined when the tier does not carry it. */
export const tierTaskDef = (
  tier: Tier,
  key: BuiltinTaskKey | string,
): TierTaskDef | undefined => TIERS[tier].tasks.find((t) => t.key === key);

/** A tier's standard target for a task. null = no quantity, or not in tier. */
export const tierStandardTarget = (
  tier: Tier,
  key: BuiltinTaskKey | string,
): TaskTarget | null => tierTaskDef(tier, key)?.standard ?? null;

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
  const def = tierTaskDef(tier, key);
  const tierStandard = def?.standard ?? null;
  // The UNIT is the tier's; only the VALUE can be overridden.
  const target: TaskTarget | null = tierStandard
    ? { value: overrideValue ?? tierStandard.value, unit: tierStandard.unit }
    : null;
  return {
    key,
    label: taskLabel(key, def?.name ?? base.shortName, target),
    sub: def?.sub ?? base.sub,
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
    TIERS[tier].tasks.map((t) => buildTierTask(tier, t.key)),
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

/**
 * Whether anything is queued for the next rollover. One predicate, so no
 * screen invents its own idea of "there is a pending change".
 */
export function hasPendingChanges(p: PendingChanges): boolean {
  return (
    p.pendingTier != null ||
    p.addedTomorrow.length > 0 ||
    p.removedTomorrow.length > 0 ||
    p.targetChanges.length > 0
  );
}

/**
 * The sentence that says what changes tomorrow and what is still true
 * today.
 *
 * Derived entirely from the pending-change state the service already owns —
 * no second source of truth. The day-start snapshot is what makes "your
 * edit lands tomorrow" correct; this is what makes it VISIBLE, which is the
 * part that was missing.
 */
export function pendingChangeLine(
  p: PendingChanges,
  currentTier: Tier,
): string | null {
  if (!hasPendingChanges(p)) return null;
  const parts: string[] = [];
  const tasks = (n: number) => `${n} task${n === 1 ? '' : 's'}`;

  if (p.pendingTier) {
    parts.push(
      `${TIERS[p.pendingTier].label} starts tomorrow — ${tasks(p.tomorrowCount)}. ` +
        `Today is still ${TIERS[currentTier].label}, ${p.todayCount}.`,
    );
  } else if (p.tomorrowCount !== p.todayCount) {
    parts.push(
      `Tomorrow: ${tasks(p.tomorrowCount)}. Today is still ${p.todayCount}.`,
    );
  } else if (p.addedTomorrow.length > 0 || p.removedTomorrow.length > 0) {
    // An add and a removal can cancel out in the count and still change
    // WHICH tasks tomorrow holds.
    parts.push(`Your task list changes tomorrow — still ${tasks(p.tomorrowCount)}.`);
  }

  for (const c of p.targetChanges) {
    parts.push(
      `${c.name} → ${targetText({ value: c.toValue, unit: c.unit })} tomorrow ` +
        `(today: ${targetText({ value: c.fromValue, unit: c.unit })}).`,
    );
  }

  return parts.join(' ');
}

/** What tomorrow reverts to once pending changes are cancelled. */
export function cancelledChangeLine(
  p: PendingChanges,
  currentTier: Tier,
): string {
  return `Cancelled — tomorrow stays ${TIERS[currentTier].label}, ${p.todayCount} tasks.`;
}
