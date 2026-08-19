import AsyncStorage from '@react-native-async-storage/async-storage';

import { CHALLENGE } from '@/constants/challenge';
import { TIER_TASKS, TIERS } from '@/constants/tiers';
import { buildScenario } from '@/data/mock';
import type {
  ActiveTimer,
  CustomTask,
  DailyNutritionTotals,
  FinalResults,
  FoodSearchResult,
  JournalEntry,
  Meal,
  MealNutrition,
  MetricCheckin,
  Milestone,
  PendingChanges,
  ReportReason,
  Scenario,
  ScenarioState,
  Squad,
  TaskDef,
  TaskKey,
  Tier,
} from '@/data/types';
import { NutritionService } from '@/services/NutritionService';

const TIMER_STORAGE_KEY = 'ranked.activeTimer.v1';

/**
 * DataService contract. The app talks to this interface only; the shipped
 * implementation below is the mock-data service. A real backend implements
 * the same surface.
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
  attachNutrition(mealId: string, nutrition: MealNutrition): Meal[];
  removeNutrition(mealId: string): Meal[];
  getDailyNutritionTotals(): DailyNutritionTotals | null;
  // Optional weekly metrics — private to the owner, never social.
  saveMetricCheckin(weightKg: number | null, mood: number | null): MetricCheckin;
  getMetricHistory(): MetricCheckin[];
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
}

let uid = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now()}-${uid++}`;

class MockDataService implements IDataService {
  private state: ScenarioState = buildScenario('day12');
  private feeling: { feeling: string | null; text: string } | null = null;
  private blocked: string[] = [];
  private reports: { feedItemId: string; reason: ReportReason }[] = [];

  loadScenario(scenario: Scenario): ScenarioState {
    this.state = buildScenario(scenario);
    this.blocked = [];
    this.initTaskConfig(this.state.tier, this.state.day);
    return this.state;
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
      text,
      timestamp: at,
      nutrition: previous?.nutrition ? { ...previous.nutrition } : null,
    };
    this.state.meals = [meal, ...this.state.meals];
    return meal;
  }

  getMeals(): Meal[] {
    return this.state.meals;
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
    const tier = TIERS[this.state.tier];
    const workoutTasks = tier.taskKeys.filter((k) =>
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
      code: code.toUpperCase(),
      streak: 9,
      members: [
        { id: 'you', name: 'You', initials: 'YO', level: 1, doneToday: 0, isSelf: true },
        { id: 'maya', name: 'Maya', initials: 'MA', level: 4, doneToday: 1, isSelf: false },
        { id: 'jordan', name: 'Jordan', initials: 'JO', level: 2, doneToday: 0, isSelf: false },
        { id: 'sam', name: 'Sam', initials: 'SA', level: 2, doneToday: 0, isSelf: false },
      ],
    };
    this.state.squad = squad;
    return squad;
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

  deleteAccount(): void {
    this.state = buildScenario('day1');
    this.blocked = [];
    this.reports = [];
    this.feeling = null;
    this.timedSessions = [];
    this.metricCheckins = [];
    this.initTaskConfig(this.state.tier, this.state.day);
    AsyncStorage.removeItem(TIMER_STORAGE_KEY).catch(() => {});
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

  attachNutrition(mealId: string, nutrition: MealNutrition): Meal[] {
    this.state.meals = this.state.meals.map((m) =>
      m.id === mealId ? { ...m, nutrition } : m,
    );
    return this.state.meals;
  }

  removeNutrition(mealId: string): Meal[] {
    this.state.meals = this.state.meals.map((m) =>
      m.id === mealId ? { ...m, nutrition: null } : m,
    );
    return this.state.meals;
  }

  getDailyNutritionTotals(): DailyNutritionTotals | null {
    const withNutrition = this.state.meals.filter((m) => m.nutrition);
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

  private customToDef(c: CustomTask): TaskDef {
    return {
      key: `custom-${c.id}`,
      label: c.name,
      sub: c.sub,
      proof: c.proof,
      timerMinutes: c.timerMinutes,
    };
  }

  /** The live task set for a given day: tier tasks + customs active then. */
  private composeTaskSet(tier: Tier, day: number): TaskDef[] {
    const customs = this.customTasks
      .filter(
        (c) =>
          c.activeFromDay <= day &&
          (c.removedFromDay == null || c.removedFromDay > day),
      )
      .map((c) => this.customToDef(c));
    return [...TIER_TASKS[tier], ...customs];
  }

  initTaskConfig(tier: Tier, day: number): TaskDef[] {
    this.customTasks = [];
    this.pendingTier = null;
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

  getPendingChanges(currentTier: Tier, day: number): PendingChanges {
    return {
      addedTomorrow: this.customTasks.filter(
        (c) => c.activeFromDay === day + 1 && c.removedFromDay == null,
      ),
      removedTomorrow: this.customTasks.filter(
        (c) => c.removedFromDay === day + 1 && c.activeFromDay <= day,
      ),
      pendingTier: this.pendingTier,
      todayCount: this.getTodayTasks(currentTier, day).length,
      tomorrowCount: this.getTomorrowTasks(currentTier, day).length,
    };
  }

  undoPendingChanges(day: number): void {
    // Drop pending adds (never active, no history) and reinstate pending
    // removals; clear any pending tier change.
    this.customTasks = this.customTasks
      .filter((c) => c.activeFromDay !== day + 1)
      .map((c) =>
        c.removedFromDay === day + 1 ? { ...c, removedFromDay: null } : c,
      );
    this.pendingTier = null;
  }

  rolloverDay(
    currentTier: Tier,
    oldDay: number,
  ): { tier: Tier; day: number; todayTasks: TaskDef[] } {
    const tier = this.pendingTier ?? currentTier;
    this.pendingTier = null;
    const day = oldDay + 1;
    if (!this.daySnapshots[day]) {
      this.daySnapshots[day] = this.composeTaskSet(tier, day);
    }
    return { tier, day, todayTasks: this.daySnapshots[day] };
  }
}

// The backend does not exist yet; EXPO_PUBLIC_USE_MOCK=false is accepted but
// falls back to the mock with a warning rather than crashing.
const USE_MOCK = (process.env.EXPO_PUBLIC_USE_MOCK ?? 'true') !== 'false';
if (!USE_MOCK) {
  console.warn(
    'EXPO_PUBLIC_USE_MOCK=false requested, but no backend implementation exists yet — using mock DataService.',
  );
}

export const DataService: IDataService = new MockDataService();
