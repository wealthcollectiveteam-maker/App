import type {
  ActiveTimer,
  CustomTask,
  DailyNutritionTotals,
  FinalResults,
  JournalEntry,
  Meal,
  MealNutrition,
  MetricCheckin,
  Milestone,
  PendingChanges,
  ReportReason,
  SavedMeal,
  Scenario,
  ScenarioState,
  Squad,
  TaskDef,
  TaskKey,
  TaskTarget,
  Tier,
  WorkoutLog,
  WorkoutLogInput,
} from '@/data/types';
import type { FoodDetail, FoodSearchResult } from '@/lib/fdc';

/**
 * DataService contract. The app talks to this interface only; both the mock
 * and the Supabase-backed implementation satisfy it exactly.
 *
 * NOTE ON SYNCHRONY: most methods are synchronous and return data directly.
 * That is deliberate and preserved by the backend implementation, which keeps
 * an in-memory mirror hydrated at sign-in, answers reads from it, and applies
 * writes optimistically while the network round trip happens in the
 * background (rolling the mirror back if the write is rejected). Making these
 * async would have rewritten every call site in the store for no user-visible
 * gain — and the mirror is what makes optimistic toggling and "no flash of
 * empty state" on relaunch possible in the first place.
 */
export interface IDataService {
  loadScenario(scenario: Scenario): ScenarioState;
  saveJournalEntry(day: number, text: string): JournalEntry;
  getJournal(): JournalEntry[];
  logMeal(text: string, at?: number): Meal;
  getMeals(day?: number): Meal[];
  getRecentMeals(): string[];
  addMilestone(title: string): Milestone;
  toggleMilestone(id: string, day: number): Milestone[];
  getFinalResults(): FinalResults;
  saveCompletionFeeling(feeling: string | null, text: string): void;
  // Squad membership (solo mode is squad === null)
  createSquad(name: string): Squad;
  joinSquad(code: string): Squad;
  leaveSquad(): void;
  // UGC moderation + compliance
  reportContent(feedItemId: string, reason: ReportReason): void;
  blockUser(name: string): string[];
  unblockUser(name: string): string[];
  getBlockedUsers(): string[];
  deleteAccount(): void;
  // Workout timer — client-owned state; only the finished session syncs.
  startTimer(timer: ActiveTimer): Promise<void>;
  pauseTimer(timer: ActiveTimer): Promise<void>;
  resumeTimer(timer: ActiveTimer): Promise<void>;
  cancelTimer(): Promise<void>;
  getActiveTimer(): Promise<ActiveTimer | null>;
  /** Records real elapsed training seconds against the completed task. */
  completeTimedTask(taskKey: TaskKey, elapsedSeconds: number): Promise<void>;
  // Nutrition — optional enrichment on meals; owner-read-only when synced.
  searchFoods(query: string): Promise<FoodSearchResult[]>;
  getFoodDetail(fdcId: number): Promise<FoodDetail>;
  attachNutrition(mealId: string, nutrition: MealNutrition): Meal[];
  removeNutrition(mealId: string): Meal[];
  getDailyNutritionTotals(): DailyNutritionTotals | null;
  // Saved meals: one-tap re-logging. Persisted locally.
  getSavedMeals(): Promise<SavedMeal[]>;
  saveMealTemplate(name: string, nutrition: MealNutrition): Promise<SavedMeal[]>;
  removeSavedMeal(id: string): Promise<SavedMeal[]>;
  // Optional weekly metrics — private to the owner, never social.
  saveMetricCheckin(weightKg: number | null, mood: number | null): MetricCheckin;
  getMetricHistory(): MetricCheckin[];
  /**
   * Workout log — owner-only history of what was actually done. Composed
   * ONLY of app-owned data (our timer's duration, user-picked type, effort,
   * note). Never HealthKit-derived values: see PRIVACY_NOTES.md.
   */
  saveWorkoutLog(input: WorkoutLogInput): WorkoutLog;
  getWorkoutLogs(): WorkoutLog[];
  /** Default chips plus every type this user has entered before. */
  getActivityTypes(): string[];
  // Editable daily tasks. Edits never affect today or the past: today's set
  // is a day-start snapshot; every change takes effect at the next rollover.
  initTaskConfig(tier: Tier, day: number): TaskDef[];
  getTodayTasks(tier: Tier, day: number): TaskDef[];
  getTomorrowTasks(currentTier: Tier, day: number): TaskDef[];
  getDaySnapshot(day: number): TaskDef[] | null;
  getCustomTasks(): CustomTask[];
  addCustomTask(
    input: { name: string; sub: string; proof: boolean; timerMinutes?: number },
    day: number,
  ): CustomTask;
  updateCustomTask(
    id: string,
    patch: Partial<Pick<CustomTask, 'name' | 'sub' | 'proof' | 'timerMinutes'>>,
  ): CustomTask[];
  removeCustomTask(id: string, day: number): CustomTask[];
  changeTier(tier: Tier | null): void;
  getPendingChanges(currentTier: Tier, day: number): PendingChanges;
  undoPendingChanges(day: number): void;
  /** Applies pending changes and freezes the new day's snapshot. */
  rolloverDay(currentTier: Tier, oldDay: number): { tier: Tier; day: number; todayTasks: TaskDef[] };
  /**
   * Set a tier task's target value (effective tomorrow like all edits).
   * Passing the tier standard clears the override.
   */
  updateTaskTarget(taskKey: TaskKey, value: number, currentTier: Tier): void;
  getTierStandards(tier: Tier): Partial<Record<TaskKey, TaskTarget>>;
}

/** Errors surfaced to the existing screen error states. */
export type BackendErrorKind = 'network' | 'auth' | 'conflict' | 'unknown';

export class BackendError extends Error {
  constructor(
    public kind: BackendErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'BackendError';
  }
}
