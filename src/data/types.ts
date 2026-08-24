export type Tier = 'hard' | 'medium' | 'soft';

export type Scenario = 'day1' | 'day12' | 'missed' | 'day75';

export type BuiltinTaskKey =
  | 'workout1'
  | 'workout2'
  | 'water'
  | 'read'
  | 'diet'
  | 'photo';

/** Tier task keys plus user-defined `custom-<id>` keys. */
export type TaskKey = BuiltinTaskKey | (string & {});

/**
 * A user-defined daily task. Never hard-deleted once it has been active —
 * `removedFromDay` ends it so history stays reconstructable.
 */
export interface CustomTask {
  id: string;
  name: string;
  sub: string;
  proof: boolean;
  timerMinutes?: number;
  /** First day this task counts. Edits always start tomorrow. */
  activeFromDay: number;
  /** Day from which it no longer counts; null = still active. */
  removedFromDay: number | null;
}

/** A target edit taking effect tomorrow. */
export interface TargetChange {
  taskKey: TaskKey;
  name: string;
  fromValue: number;
  toValue: number;
  unit: TargetUnit;
}

/** Pending edits that take effect at the next day rollover. */
export interface PendingChanges {
  addedTomorrow: CustomTask[];
  removedTomorrow: CustomTask[];
  pendingTier: Tier | null;
  targetChanges: TargetChange[];
  todayCount: number;
  tomorrowCount: number;
}

export type TargetUnit = 'pages' | 'minutes' | 'gallons' | 'litres' | 'count';

/** A structured task quantity. Null = no meaningful quantity (diet, photo). */
export interface TaskTarget {
  value: number;
  unit: TargetUnit;
}

export interface TaskDef {
  key: TaskKey;
  /** Rendered FROM the target (e.g. "Read 15 pages") — never hand-edited. */
  label: string;
  sub: string;
  /** Camera tasks show an optional-proof affordance. */
  proof: boolean;
  /** The quantity in force. Snapshots store the resolved value. */
  target?: TaskTarget | null;
  /** The tier's standard for this task, for comparison and restoration. */
  tierStandard?: TaskTarget | null;
  /**
   * Timed tasks: countdown length in minutes. Derived from `target` when
   * its unit is minutes (one source of truth). Absent = not timed.
   */
  timerMinutes?: number;
  /** User picks the duration before starting (e.g. reading). */
  timerUserSet?: boolean;
}

/**
 * The active countdown, persisted to AsyncStorage the moment it starts.
 * Remaining time is always computed from wall-clock timestamps — never by
 * decrementing a counter — so backgrounding cannot freeze or drift it.
 */
export interface ActiveTimer {
  taskKey: TaskKey;
  /** Task label frozen at start (survives tier changes mid-timer). */
  label: string;
  startedAtISO: string;
  durationSeconds: number;
  pausedAtISO: string | null;
  accumulatedPauseSeconds: number;
}

export interface JournalEntry {
  id: string;
  day: number;
  timestamp: number;
  text: string;
}

/** One food in a multi-component meal ("Chicken, broiled — 6 oz"). */
export interface MealComponent {
  fdcId: number;
  description: string;
  quantity: number;
  unit: string;
  /** Resolved grams for the whole component — the scaling ground truth. */
  gramWeight: number;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

/**
 * Optional nutrition enrichment for a logged meal. Never required.
 * Totals are the sum of components (or direct entry via Quick Add).
 */
export interface MealNutrition {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  components?: MealComponent[];
  /** Entered by hand — no search, no network. */
  quickAdd?: boolean;
}

/** A built meal saved for one-tap re-logging. */
export interface SavedMeal {
  id: string;
  name: string;
  nutrition: MealNutrition;
}

/**
 * One completed workout, as recorded by the user. Every field is app-owned:
 * duration comes from our own timer (or is typed on the swipe path), and
 * type/effort/notes are user-authored. NO HealthKit value is ever stored
 * here — see PRIVACY_NOTES.md.
 */
export interface WorkoutLog {
  id: string;
  day: number;
  taskKey: TaskKey;
  activityType: string;
  durationSeconds: number;
  /** Optional 1–5. */
  effort: number | null;
  notes: string | null;
  loggedAt: number;
}

export type WorkoutLogInput = Omit<WorkoutLog, 'id' | 'loggedAt'>;

export interface Meal {
  id: string;
  /**
   * Challenge day this meal belongs to. The backend stores meals for the
   * whole challenge, so without this the "today" list and the daily
   * nutrition totals would accumulate every meal ever logged.
   */
  day: number;
  text: string;
  timestamp: number;
  nutrition?: MealNutrition | null;
}

export interface DailyNutritionTotals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  mealsWithNutrition: number;
}

export interface HealthPrefs {
  healthEnabled: boolean;
  dietPromptEnabled: boolean;
  workoutPromptEnabled: boolean;
  weightPrefillEnabled: boolean;
}

/** Optional weekly weight+mood check-in. Private to the owner, always skippable. */
export interface MetricCheckin {
  id: string;
  timestamp: number;
  weightKg: number | null;
  mood: number | null; // 1–5
}

export interface Milestone {
  id: string;
  title: string;
  done: boolean;
  meta?: string;
}

export interface SquadMember {
  id: string;
  name: string;
  initials: string;
  level: number;
  doneToday: number;
  /**
   * How many tasks THIS member's day holds. Squadmates run their own tiers,
   * so the viewer's own task count is not a stand-in for it.
   */
  tasksToday: number;
  isSelf: boolean;
}

export type FeedKind = 'ping-in' | 'ping-out' | 'complete' | 'proof' | 'change';

export interface FeedItem {
  id: string;
  kind: FeedKind;
  /** Display name, or a fallback when RLS will not resolve one. */
  who: string;
  /**
   * The author's user id, which is what blocking is actually keyed to.
   *
   * `who` is not identity: profiles_select only exposes yourself and current
   * squadmates, so someone you blocked and then stopped sharing a squad with
   * reads as the literal string "Squadmate" — and a name-keyed filter matched
   * nothing and showed you their posts. Two squadmates can also share a
   * display name. Absent on locally-composed rows (the mock, and this
   * device's own optimistic entries), which are matched by name instead.
   */
  authorId?: string;
  text: string;
  timestamp: number;
}

/** A blocked user. Held as a pair because the id is the durable half. */
export interface BlockedUser {
  id: string;
  name: string;
}

export interface LeaderRow {
  id: string;
  name: string;
  level: number;
  xp: number;
  isSelf: boolean;
  /** What each person is actually running — HARD/MEDIUM/SOFT/CUSTOM. */
  tierLabel: string;
}

export interface Squad {
  name: string;
  code: string;
  streak: number;
  members: SquadMember[];
}

export interface FinalResults {
  workouts: number;
  pagesRead: number;
  /**
   * Total water, in the unit the TIER counts it in — Hard counts gallons,
   * Medium and Soft litres. A bare number labelled "Gallons" was true of
   * one tier and wrong for the other two.
   */
  water: TaskTarget;
  day1PhotoUri: string | null;
  day75PhotoUri: string | null;
}

export type ReportReason =
  | 'Spam'
  | 'Harassment'
  | 'Inappropriate content'
  | 'Other';

export interface NotificationPrefs {
  pings: boolean;
  squadActivity: boolean;
  dailyReminder: boolean;
  /** Running/halfway/5-min/completion timer notifications. */
  timerAlerts: boolean;
}

export interface ScenarioState {
  tier: Tier;
  day: number;
  flame: number;
  bestFlame: number;
  perfectDays: number;
  xp: number;
  missedDay: boolean;
  dayComplete: boolean;
  tasksDone: Partial<Record<TaskKey, string>>; // key -> completion time label
  proofs: Partial<Record<TaskKey, string>>;
  why: string;
  journal: JournalEntry[];
  meals: Meal[];
  milestones: Milestone[];
  /** null = solo mode. A squad is optional, not assumed. */
  squad: Squad | null;
  feed: FeedItem[];
  leaderboardWeek: LeaderRow[];
  leaderboardAllTime: LeaderRow[];
}
