import type { TaskDef, TaskKey, Tier } from '@/data/types';

/**
 * The full task library. Tiers select from it; labels can be overridden per
 * tier (e.g. a single-workout tier drops the "Workout 1" numbering).
 */
export const TASK_LIBRARY: Record<TaskKey, TaskDef> = {
  workout1: {
    key: 'workout1',
    label: 'Workout 1 — 45 min',
    sub: '45 minutes. Indoors or out. No skipping.',
    proof: true,
  },
  workout2: {
    key: 'workout2',
    label: 'Workout 2 — outdoors',
    sub: 'Outdoors, whatever the weather.',
    proof: true,
  },
  water: {
    key: 'water',
    label: 'Gallon of water',
    sub: 'One gallon across the day.',
    proof: false,
  },
  read: {
    key: 'read',
    label: 'Read 10 pages',
    sub: 'Ten pages of a real book.',
    proof: false,
  },
  diet: {
    key: 'diet',
    label: 'Follow the diet',
    sub: 'No cheat meals. No alcohol.',
    proof: false,
  },
  photo: {
    key: 'photo',
    label: 'Progress photo',
    sub: 'One photo. Same spot every day.',
    proof: true,
  },
};

export interface TierDef {
  key: Tier;
  label: string;
  taskKeys: TaskKey[];
  labelOverrides?: Partial<Record<TaskKey, string>>;
  workoutMinutes: number;
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
    taskKeys: ['workout1', 'workout2', 'water', 'read', 'diet', 'photo'],
    workoutMinutes: 45,
    missedDay: {
      restartsChallenge: true,
      resetsStreak: true,
      copy: 'Hard rules: the clock resets. Day 1 — again.',
    },
  },
  medium: {
    key: 'medium',
    label: 'Medium',
    taskKeys: ['workout1', 'water', 'read', 'diet', 'photo'],
    labelOverrides: { workout1: 'Workout — 45 min' },
    workoutMinutes: 45,
    missedDay: {
      restartsChallenge: false,
      resetsStreak: true,
      copy: 'Streak broken. Day {day} still counts. Lock back in.',
    },
  },
  soft: {
    key: 'soft',
    label: 'Soft',
    taskKeys: ['workout1', 'water', 'read', 'diet'],
    labelOverrides: { workout1: 'Workout — 45 min' },
    workoutMinutes: 45,
    missedDay: {
      restartsChallenge: false,
      resetsStreak: true,
      copy: 'A miss, not a quit. Pick it back up today.',
    },
  },
};

/** Precomputed per-tier task arrays with stable references (safe for zustand selectors). */
export const TIER_TASKS: Record<Tier, TaskDef[]> = Object.fromEntries(
  (Object.keys(TIERS) as Tier[]).map((tier) => [
    tier,
    TIERS[tier].taskKeys.map((key) => ({
      ...TASK_LIBRARY[key],
      label: TIERS[tier].labelOverrides?.[key] ?? TASK_LIBRARY[key].label,
    })),
  ]),
) as Record<Tier, TaskDef[]>;

export const tierTaskCount = (tier: Tier) => TIER_TASKS[tier].length;

export const missedDayCopy = (tier: Tier, day: number) =>
  TIERS[tier].missedDay.copy.replace('{day}', String(day));
