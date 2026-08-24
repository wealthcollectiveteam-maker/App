import AsyncStorage from '@react-native-async-storage/async-storage';

import { CHALLENGE } from '@/constants/challenge';
import { tierStandardTarget, tierTaskKeys } from '@/constants/tiers';
import { buildScenario } from '@/data/mock';
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
  TargetChange,
  TaskDef,
  TaskKey,
  TaskTarget,
  Tier,
  WorkoutLog,
  WorkoutLogInput,
} from '@/data/types';
import type { FoodDetail, FoodSearchResult } from '@/lib/fdc';
import { normalizeInviteCode } from '@/lib/inviteCode';
import type { IDataService } from '@/services/contract';
import { NutritionService } from '@/services/NutritionService';
import {
  composeTaskSet,
  DEFAULT_ACTIVITY_TYPES,
  pendingTargetChanges,
  tierStandards,
} from '@/services/taskProjection';

const TIMER_STORAGE_KEY = 'ranked.activeTimer.v1';

let uid = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now()}-${uid++}`;

export class MockDataService implements IDataService {
  private state: ScenarioState = buildScenario('day12');
  private feeling: { feeling: string | null; text: string } | null = null;
  private blocked: string[] = [];
  private reports: { feedItemId: string; reason: ReportReason }[] = [];
  private pings: { toName: string; message: string; at: number }[] = [];

  loadScenario(scenario: Scenario): ScenarioState {
    this.state = buildScenario(scenario);
    this.blocked = [];
    this.initTaskConfig(this.state.tier, this.state.day);
    return this.state;
  }

  // ---- Completion / seal / ping ----
  // The mock has no server to validate against, so it simply mirrors what
  // the store already shows. The point of these living on the interface at
  // all is that the Supabase implementation routes them through the RPCs
  // that DO validate.

  completeTask(taskKey: TaskKey, at: string): void {
    this.state.tasksDone = { ...this.state.tasksDone, [taskKey]: at };
  }

  uncompleteTask(taskKey: TaskKey): void {
    const next = { ...this.state.tasksDone };
    delete next[taskKey];
    this.state.tasksDone = next;
  }

  sealDay(): void {
    this.state.dayComplete = true;
  }

  sendPing(toName: string, message: string): void {
    this.pings.push({ toName, message, at: Date.now() });
  }

  saveJournalEntry(day: number, text: string): JournalEntry {
    const entry: JournalEntry = {
      id: nextId('j'),
      day,
      timestamp: Date.now(),
      text,
    };
    this.state.journal = [entry, ...this.state.journal];
    return entry;
  }

  getJournal(): JournalEntry[] {
    return this.state.journal;
  }

  logMeal(text: string, at: number = Date.now()): Meal {
    // Re-logging a meal (e.g. via a "recent" chip) carries its previously
    // attached nutrition forward automatically — no network call.
    const previous = this.state.meals.find(
      (m) =>
        m.text.trim().toLowerCase() === text.trim().toLowerCase() &&
        m.nutrition,
    );
    const meal: Meal = {
      id: nextId('ml'),
      day: this.state.day,
      text,
      timestamp: at,
      nutrition: previous?.nutrition ? { ...previous.nutrition } : null,
    };
    this.state.meals = [meal, ...this.state.meals];
    return meal;
  }

  /** TODAY's log by default — the same contract the backend now honours. */
  getMeals(day: number = this.state.day): Meal[] {
    return this.state.meals.filter((m) => m.day === day);
  }

  /** Unique meal texts, most recent first. */
  getRecentMeals(): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const m of this.state.meals) {
      const key = m.text.trim().toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(m.text);
      }
    }
    return out;
  }

  addMilestone(title: string): Milestone {
    const milestone: Milestone = { id: nextId('m'), title, done: false };
    this.state.milestones = [...this.state.milestones, milestone];
    return milestone;
  }

  toggleMilestone(id: string, day: number): Milestone[] {
    this.state.milestones = this.state.milestones.map((m) =>
      m.id === id
        ? {
            ...m,
            done: !m.done,
            meta: !m.done ? `Hit on Day ${day}` : undefined,
          }
        : m,
    );
    return this.state.milestones;
  }

  getFinalResults(): FinalResults {
    const workoutTasks = tierTaskKeys(this.state.tier).filter((k) =>
      k.startsWith('workout'),
    ).length;
    return {
      workouts: CHALLENGE.days * workoutTasks,
      pagesRead: CHALLENGE.days * 10,
      gallons: CHALLENGE.days,
      day1PhotoUri: null,
      day75PhotoUri: this.state.proofs.photo ?? null,
    };
  }

  saveCompletionFeeling(feeling: string | null, text: string): void {
    this.feeling = { feeling, text };
  }

  createSquad(name: string): Squad {
    const squad: Squad = {
      name,
      code: 'K7X2FD',
      streak: 0,
      members: [
        {
          id: 'you',
          name: 'You',
          initials: 'YO',
          level: 1,
          doneToday: 0,
          tasksToday: this.daySnapshots[this.state.day]?.length ?? 0,
          isSelf: true,
        },
      ],
    };
    this.state.squad = squad;
    return squad;
  }

  joinSquad(code: string): Squad {
    // Mock: any code joins the demo squad.
    const squad: Squad = {
      name: 'Group 1',
      code: normalizeInviteCode(code),
      streak: 9,
      members: [
        { id: 'you', name: 'You', initials: 'YO', level: 1, doneToday: 0, tasksToday: 6, isSelf: true },
        { id: 'maya', name: 'Maya', initials: 'MA', level: 4, doneToday: 1, tasksToday: 6, isSelf: false },
        { id: 'jordan', name: 'Jordan', initials: 'JO', level: 2, doneToday: 0, tasksToday: 5, isSelf: false },
        { id: 'sam', name: 'Sam', initials: 'SA', level: 2, doneToday: 0, tasksToday: 4, isSelf: false },
      ],
    };
    this.state.squad = squad;
    return squad;
  }

  getSquadState() {
    return {
      squad: this.state.squad,
      feed: this.state.feed,
      leaderboardWeek: this.state.leaderboardWeek,
      leaderboardAllTime: this.state.leaderboardAllTime,
    };
  }

  /** No server, so nothing ever arrives late. */
  onRemoteChange(_listener: () => void): () => void {
    return () => {};
  }

  leaveSquad(): void {
    this.state.squad = null;
  }

  reportContent(feedItemId: string, reason: ReportReason): void {
    this.reports.push({ feedItemId, reason });
  }

  blockUser(name: string): string[] {
    if (!this.blocked.includes(name)) this.blocked = [...this.blocked, name];
    return this.blocked;
  }

  unblockUser(name: string): string[] {
    this.blocked = this.blocked.filter((n) => n !== name);
    return this.blocked;
  }

  getBlockedUsers(): string[] {
    return this.blocked;
  }

  updateProfile(_name: string, why: string): void {
    // No profiles table to write to; the mock's own copy of "why" is all
    // there is, and the store holds the name.
    this.state.why = why;
  }

  deleteAccount(): void {
    this.state = buildScenario('day1');
    this.blocked = [];
    this.reports = [];
    this.pings = [];
    this.feeling = null;
    this.timedSessions = [];
    this.metricCheckins = [];
    this.savedMeals = [];
    this.workoutLogs = [];
    this.initTaskConfig(this.state.tier, this.state.day);
    AsyncStorage.removeItem(TIMER_STORAGE_KEY).catch(() => {});
    AsyncStorage.removeItem(MockDataService.SAVED_MEALS_KEY).catch(() => {});
    NutritionService.clearCache().catch(() => {});
  }

  // ---- Workout timer ----

  private timedSessions: { taskKey: TaskKey; durationSeconds: number; at: number }[] =
    [];

  private async persistTimer(timer: ActiveTimer): Promise<void> {
    await AsyncStorage.setItem(TIMER_STORAGE_KEY, JSON.stringify(timer));
  }

  startTimer(timer: ActiveTimer): Promise<void> {
    return this.persistTimer(timer);
  }

  pauseTimer(timer: ActiveTimer): Promise<void> {
    return this.persistTimer(timer);
  }

  resumeTimer(timer: ActiveTimer): Promise<void> {
    return this.persistTimer(timer);
  }

  async cancelTimer(): Promise<void> {
    await AsyncStorage.removeItem(TIMER_STORAGE_KEY);
  }

  async getActiveTimer(): Promise<ActiveTimer | null> {
    try {
      const raw = await AsyncStorage.getItem(TIMER_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as ActiveTimer;
      if (!parsed?.taskKey || !parsed?.startedAtISO) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  async completeTimedTask(
    taskKey: TaskKey,
    elapsedSeconds: number,
  ): Promise<void> {
    this.timedSessions.push({
      taskKey,
      durationSeconds: Math.round(elapsedSeconds),
      at: Date.now(),
    });
    await AsyncStorage.removeItem(TIMER_STORAGE_KEY);
  }

  // ---- Nutrition ----

  searchFoods(query: string): Promise<FoodSearchResult[]> {
    return NutritionService.searchFoods(query);
  }

  getFoodDetail(fdcId: number): Promise<FoodDetail> {
    return NutritionService.getFoodDetail(fdcId);
  }

  // ---- Saved meals (persisted locally; sync lands with the backend) ----

  private savedMeals: SavedMeal[] | null = null;
  private static SAVED_MEALS_KEY = 'ranked.savedMeals.v1';

  async getSavedMeals(): Promise<SavedMeal[]> {
    if (this.savedMeals) return this.savedMeals;
    try {
      const raw = await AsyncStorage.getItem(MockDataService.SAVED_MEALS_KEY);
      this.savedMeals = raw ? (JSON.parse(raw) as SavedMeal[]) : [];
    } catch {
      this.savedMeals = [];
    }
    return this.savedMeals;
  }

  async saveMealTemplate(
    name: string,
    nutrition: MealNutrition,
  ): Promise<SavedMeal[]> {
    const meals = await this.getSavedMeals();
    // Replace an existing template of the same name rather than duplicating.
    this.savedMeals = [
      { id: nextId('sm'), name: name.trim(), nutrition },
      ...meals.filter(
        (m) => m.name.trim().toLowerCase() !== name.trim().toLowerCase(),
      ),
    ].slice(0, 20);
    await AsyncStorage.setItem(
      MockDataService.SAVED_MEALS_KEY,
      JSON.stringify(this.savedMeals),
    ).catch(() => {});
    return this.savedMeals;
  }

  async removeSavedMeal(id: string): Promise<SavedMeal[]> {
    const meals = await this.getSavedMeals();
    this.savedMeals = meals.filter((m) => m.id !== id);
    await AsyncStorage.setItem(
      MockDataService.SAVED_MEALS_KEY,
      JSON.stringify(this.savedMeals),
    ).catch(() => {});
    return this.savedMeals;
  }

  attachNutrition(mealId: string, nutrition: MealNutrition): Meal[] {
    this.state.meals = this.state.meals.map((m) =>
      m.id === mealId ? { ...m, nutrition } : m,
    );
    return this.getMeals();
  }

  removeNutrition(mealId: string): Meal[] {
    this.state.meals = this.state.meals.map((m) =>
      m.id === mealId ? { ...m, nutrition: null } : m,
    );
    return this.getMeals();
  }

  getDailyNutritionTotals(): DailyNutritionTotals | null {
    const withNutrition = this.getMeals().filter((m) => m.nutrition);
    if (withNutrition.length === 0) return null;
    const totals = withNutrition.reduce(
      (acc, m) => ({
        calories: acc.calories + m.nutrition!.calories,
        protein: acc.protein + m.nutrition!.protein,
        carbs: acc.carbs + m.nutrition!.carbs,
        fat: acc.fat + m.nutrition!.fat,
        mealsWithNutrition: acc.mealsWithNutrition + 1,
      }),
      { calories: 0, protein: 0, carbs: 0, fat: 0, mealsWithNutrition: 0 },
    );
    return {
      ...totals,
      protein: Math.round(totals.protein),
      carbs: Math.round(totals.carbs),
      fat: Math.round(totals.fat),
    };
  }

  // ---- Weekly metric check-ins (owner-only; never social) ----

  private metricCheckins: MetricCheckin[] = [];

  saveMetricCheckin(
    weightKg: number | null,
    mood: number | null,
  ): MetricCheckin {
    const checkin: MetricCheckin = {
      id: nextId('mc'),
      timestamp: Date.now(),
      weightKg,
      mood,
    };
    this.metricCheckins = [checkin, ...this.metricCheckins];
    return checkin;
  }

  getMetricHistory(): MetricCheckin[] {
    return this.metricCheckins;
  }

  // ---- Editable daily tasks (day-start snapshots) ----

  private customTasks: CustomTask[] = [];
  /** Frozen task set per day. Once written, never rewritten. */
  private daySnapshots: Record<number, TaskDef[]> = {};
  private pendingTier: Tier | null = null;
  /** Tier-task target values differing from the tier standard. */
  private targetOverrides: Partial<Record<TaskKey, number>> = {};
  /** Copy taken at day start so UNDO can revert today's pending edits. */
  private overridesAtDayStart: Partial<Record<TaskKey, number>> = {};

  private composeTaskSet(tier: Tier, day: number): TaskDef[] {
    return composeTaskSet(tier, day, {
      customTasks: this.customTasks,
      targetOverrides: this.targetOverrides,
    });
  }

  initTaskConfig(tier: Tier, day: number): TaskDef[] {
    this.customTasks = [];
    this.pendingTier = null;
    this.targetOverrides = {};
    this.overridesAtDayStart = {};
    this.daySnapshots = { [day]: this.composeTaskSet(tier, day) };
    return this.daySnapshots[day];
  }

  getTodayTasks(tier: Tier, day: number): TaskDef[] {
    if (!this.daySnapshots[day]) {
      // Backfill for days that predate snapshotting: freeze the current set.
      this.daySnapshots[day] = this.composeTaskSet(tier, day);
    }
    return this.daySnapshots[day];
  }

  getTomorrowTasks(currentTier: Tier, day: number): TaskDef[] {
    return this.composeTaskSet(this.pendingTier ?? currentTier, day + 1);
  }

  getDaySnapshot(day: number): TaskDef[] | null {
    return this.daySnapshots[day] ?? null;
  }

  getCustomTasks(): CustomTask[] {
    return this.customTasks;
  }

  addCustomTask(
    input: { name: string; sub: string; proof: boolean; timerMinutes?: number },
    day: number,
  ): CustomTask {
    const task: CustomTask = {
      id: nextId('ct'),
      name: input.name.trim(),
      sub: input.sub.trim(),
      proof: input.proof,
      timerMinutes: input.timerMinutes,
      activeFromDay: day + 1,
      removedFromDay: null,
    };
    this.customTasks = [...this.customTasks, task];
    return task;
  }

  updateCustomTask(
    id: string,
    patch: Partial<Pick<CustomTask, 'name' | 'sub' | 'proof' | 'timerMinutes'>>,
  ): CustomTask[] {
    // Definitions can be edited freely — today's snapshot holds frozen
    // copies, so past and present days are untouched by design.
    this.customTasks = this.customTasks.map((c) =>
      c.id === id ? { ...c, ...patch, name: (patch.name ?? c.name).trim() } : c,
    );
    return this.customTasks;
  }

  removeCustomTask(id: string, day: number): CustomTask[] {
    const target = this.customTasks.find((c) => c.id === id);
    if (!target) return this.customTasks;
    if (target.activeFromDay > day) {
      // Pending add that was never in force — no history, safe to drop.
      this.customTasks = this.customTasks.filter((c) => c.id !== id);
    } else {
      // Has (potential) history: end it from tomorrow, never hard-delete.
      this.customTasks = this.customTasks.map((c) =>
        c.id === id ? { ...c, removedFromDay: day + 1 } : c,
      );
    }
    return this.customTasks;
  }

  changeTier(tier: Tier | null): void {
    this.pendingTier = tier;
  }

  private pendingTargetChanges(currentTier: Tier): TargetChange[] {
    return pendingTargetChanges(
      currentTier,
      this.targetOverrides,
      this.overridesAtDayStart,
    );
  }

  getPendingChanges(currentTier: Tier, day: number): PendingChanges {
    return {
      addedTomorrow: this.customTasks.filter(
        (c) => c.activeFromDay === day + 1 && c.removedFromDay == null,
      ),
      removedTomorrow: this.customTasks.filter(
        (c) => c.removedFromDay === day + 1 && c.activeFromDay <= day,
      ),
      pendingTier: this.pendingTier,
      targetChanges: this.pendingTargetChanges(currentTier),
      todayCount: this.getTodayTasks(currentTier, day).length,
      tomorrowCount: this.getTomorrowTasks(currentTier, day).length,
    };
  }

  undoPendingChanges(day: number): void {
    // Drop pending adds (never active, no history), reinstate pending
    // removals, revert target edits, and clear any pending tier change.
    this.customTasks = this.customTasks
      .filter((c) => c.activeFromDay !== day + 1)
      .map((c) =>
        c.removedFromDay === day + 1 ? { ...c, removedFromDay: null } : c,
      );
    this.pendingTier = null;
    this.targetOverrides = { ...this.overridesAtDayStart };
  }

  rolloverDay(
    currentTier: Tier,
    oldDay: number,
  ): { tier: Tier; day: number; todayTasks: TaskDef[] } {
    const tier = this.pendingTier ?? currentTier;
    this.pendingTier = null;
    this.overridesAtDayStart = { ...this.targetOverrides };
    const day = oldDay + 1;
    if (!this.daySnapshots[day]) {
      this.daySnapshots[day] = this.composeTaskSet(tier, day);
    }
    return { tier, day, todayTasks: this.daySnapshots[day] };
  }

  updateTaskTarget(taskKey: TaskKey, value: number, currentTier: Tier): void {
    // The tier standard in force decides both whether this task HAS an
    // editable quantity and what "back to standard" means.
    const standard = tierStandardTarget(currentTier, taskKey);
    if (!standard) return;
    if (value === standard.value) {
      delete this.targetOverrides[taskKey];
    } else {
      this.targetOverrides[taskKey] = value;
    }
    // Today's snapshot is already frozen; the change surfaces tomorrow.
  }

  getTierStandards(tier: Tier): Partial<Record<TaskKey, TaskTarget>> {
    return tierStandards(tier);
  }

  // ---- Workout log (owner-only; app-owned data only) ----

  private workoutLogs: WorkoutLog[] = [];

  saveWorkoutLog(input: WorkoutLogInput): WorkoutLog {
    const log: WorkoutLog = { ...input, id: nextId('wl'), loggedAt: Date.now() };
    this.workoutLogs = [log, ...this.workoutLogs];
    return log;
  }

  getWorkoutLogs(): WorkoutLog[] {
    return this.workoutLogs;
  }

  getActivityTypes(): string[] {
    // Learned types first (most recently used), then the unused defaults.
    const used: string[] = [];
    for (const l of this.workoutLogs) {
      if (!used.some((u) => u.toLowerCase() === l.activityType.toLowerCase())) {
        used.push(l.activityType);
      }
    }
    const defaults = DEFAULT_ACTIVITY_TYPES.filter(
      (d) => !used.some((u) => u.toLowerCase() === d.toLowerCase()),
    );
    return [...used, ...defaults];
  }
}
