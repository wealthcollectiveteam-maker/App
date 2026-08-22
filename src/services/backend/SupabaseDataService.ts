import AsyncStorage from '@react-native-async-storage/async-storage';

import { CHALLENGE, XP } from '@/constants/challenge';
import { TIERS } from '@/constants/tiers';
import type {
  ActiveTimer,
  BuiltinTaskKey,
  CustomTask,
  DailyNutritionTotals,
  FinalResults,
  JournalEntry,
  LeaderRow,
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
  SquadMember,
  TargetChange,
  TaskDef,
  TaskKey,
  TaskTarget,
  Tier,
  WorkoutLog,
  WorkoutLogInput,
} from '@/data/types';
import type { FoodDetail, FoodSearchResult } from '@/lib/fdc';
import { api, type SquadStatusRow } from '@/services/backend/api';
import { getSupabase } from '@/services/backend/supabaseClient';
import { BackendError, type IDataService } from '@/services/contract';
import { NutritionService } from '@/services/NutritionService';
import {
  composeTaskSet,
  DEFAULT_ACTIVITY_TYPES,
  pendingTargetChanges,
  tierStandards,
} from '@/services/taskProjection';

const TIMER_STORAGE_KEY = 'ranked.activeTimer.v1';
const SAVED_MEALS_KEY = 'ranked.savedMeals.v1';

let uid = 0;
const localId = (prefix: string) => `${prefix}-${Date.now()}-${uid++}`;

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .map((p) => p[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'YO';

function classify(error: unknown): BackendError {
  const message =
    error instanceof Error ? error.message : String(error ?? 'unknown error');
  if (/jwt|token|not authenticated|session/i.test(message)) {
    return new BackendError('auth', message);
  }
  if (/network|fetch|timeout|offline/i.test(message)) {
    return new BackendError('network', message);
  }
  if (/duplicate|conflict|immutable|already/i.test(message)) {
    return new BackendError('conflict', message);
  }
  return new BackendError('unknown', message);
}

/**
 * Supabase-backed DataService.
 *
 * ARCHITECTURE — why there is a mirror:
 * `IDataService` is largely synchronous, and the contract may not change. So
 * this class keeps an in-memory mirror of the signed-in user's data,
 * hydrated once at sign-in (and refreshed by realtime), answers every read
 * from it, and applies writes OPTIMISTICALLY: mutate the mirror, return
 * immediately, fire the network call, and roll the mirror back if the server
 * rejects it. That is also exactly what the spec asks for elsewhere —
 * optimistic task toggling with rollback, and no flash of empty state on
 * relaunch.
 *
 * AUTHORITY — what the server owns:
 * Today's task set is the SERVER's frozen snapshot, never composed locally.
 * Tier changes, target overrides, custom tasks and rollover all go through
 * SECURITY DEFINER RPCs that only ever write the server-computed current day.
 * The local projection in taskProjection.ts is used ONLY to preview
 * tomorrow — the same inputs the server's compose_task_set() uses at
 * rollover, so the preview matches what will actually be frozen.
 *
 * PRIVACY — what never leaves the device:
 * No HealthKit-derived value is written by any method here. Health
 * PREFERENCES (the user's own toggles) sync; health DATA does not.
 */
export class SupabaseDataService implements IDataService {
  private userId: string | null = null;
  private challengeId: string | null = null;
  private state: ScenarioState = {
    tier: 'hard',
    day: 1,
    flame: 0,
    bestFlame: 0,
    perfectDays: 0,
    xp: 0,
    missedDay: false,
    dayComplete: false,
    tasksDone: {},
    proofs: {},
    why: '',
    journal: [],
    meals: [],
    milestones: [],
    squad: null,
    feed: [],
    leaderboardWeek: [],
    leaderboardAllTime: [],
  };

  private metricCheckins: MetricCheckin[] = [];
  private workoutLogs: WorkoutLog[] = [];
  private savedMeals: SavedMeal[] = [];
  private blocked: { id: string; name: string }[] = [];
  private customTasks: CustomTask[] = [];
  private daySnapshots: Record<number, TaskDef[]> = {};
  private targetOverrides: Partial<Record<TaskKey, number>> = {};
  private overridesAtDayStart: Partial<Record<TaskKey, number>> = {};
  private pendingTier: Tier | null = null;
  private squadId: string | null = null;

  /** Surfaced to the UI so a rejected optimistic write is never silent. */
  onError: ((error: BackendError) => void) | null = null;

  private fail(error: unknown): void {
    const backendError = classify(error);
    this.onError?.(backendError);
  }

  /** Fire a write, roll the mirror back if the server rejects it. */
  private write(
    run: () => PromiseLike<{ error: unknown } | void>,
    rollback: () => void,
  ): void {
    Promise.resolve(run())
      .then((result) => {
        const error = result && 'error' in result ? result.error : null;
        if (error) {
          rollback();
          this.fail(error);
        }
      })
      .catch((error) => {
        rollback();
        this.fail(error);
      });
  }

  // ===================== session bootstrap (not IDataService) =============

  /**
   * Loads everything the app renders for the signed-in user. Called once
   * after sign-in and on cold launch with a restored session, BEFORE the
   * first render reads the mirror — hence no empty-state flash.
   */
  async hydrate(userId: string): Promise<void> {
    this.userId = userId;

    const [profile, priv, day, squadStatus] = await Promise.all([
      api.getProfile(userId),
      api.getProfilePrivate(userId),
      api.getOrFreezeToday(),
      api.getSquadStatus().catch(() => null),
    ]);

    this.challengeId = day?.challenge_id ?? null;
    this.state.day = day?.day ?? 1;
    this.daySnapshots = day ? { [day.day]: day.task_snapshot } : {};
    this.state.dayComplete = !!day?.sealed_at;
    this.state.xp = profile?.xp ?? 0;
    this.state.why = typeof priv?.why === 'string' ? priv.why : '';

    const [journal, meals, milestones, metrics, logs, completions, config] =
      await Promise.all([
        api.listJournal(userId),
        api.listMeals(userId),
        api.listMilestones(userId),
        api.listMetricCheckins(userId),
        api.listWorkoutLogs(userId),
        this.challengeId
          ? api.listTodayCompletions(this.challengeId, this.state.day)
          : Promise.resolve({} as Partial<Record<TaskKey, string>>),
        this.challengeId
          ? api.getChallengeConfig(this.challengeId, this.state.day)
          : null,
      ]);

    this.state.journal = journal;
    this.state.meals = meals;
    this.state.milestones = milestones;
    this.metricCheckins = metrics;
    this.workoutLogs = logs;
    this.state.tasksDone = completions;
    this.state.tier = config?.tier ?? 'hard';
    this.state.flame = config?.flame ?? 0;
    this.customTasks = config?.customTasks ?? [];
    this.targetOverrides = config?.targetOverrides ?? {};
    this.overridesAtDayStart = { ...this.targetOverrides };
    this.pendingTier = config?.pendingTier ?? null;
    this.blocked = await api.listBlockedUsers(userId);

    if (squadStatus?.length) {
      this.squadId = squadStatus[0].squad_id;
      this.applySquadStatus(squadStatus);
      this.state.feed = this.squadId ? await api.listFeed(this.squadId) : [];
    } else {
      // Solo is a first-class state, not a degraded one.
      this.squadId = null;
      this.state.squad = null;
      this.state.feed = [];
      this.state.leaderboardWeek = [];
      this.state.leaderboardAllTime = [];
    }

    this.savedMeals = await this.readSavedMeals();
  }

  /** Realtime + refresh entry point: recompute squad-derived view state. */
  private applySquadStatus(rows: SquadStatusRow[]): void {
    const first = rows[0];
    const members: SquadMember[] = rows.map((r) => ({
      id: r.user_id,
      name: r.user_id === this.userId ? 'You' : r.name,
      initials: initials(r.name),
      level: Math.floor(r.xp / XP.perLevel) + 1,
      doneToday: r.done_today,
      isSelf: r.user_id === this.userId,
    }));
    this.state.squad = {
      name: first.squad_name,
      code: first.invite_code,
      // A squad's streak is only as long as its shortest individual one.
      streak: Math.min(...rows.map((r) => r.flame)),
      members,
    };
    const leaderboard: LeaderRow[] = rows.map((r) => ({
      id: r.user_id,
      name: r.user_id === this.userId ? 'You' : r.name,
      level: Math.floor(r.xp / XP.perLevel) + 1,
      xp: r.xp,
      isSelf: r.user_id === this.userId,
      tierLabel: r.tier_label,
    }));
    // Week board ranks by current flame; all-time by lifetime XP.
    const flameOf = new Map(rows.map((r) => [r.user_id, r.flame]));
    this.state.leaderboardWeek = [...leaderboard].sort(
      (a, b) => (flameOf.get(b.id) ?? 0) - (flameOf.get(a.id) ?? 0),
    );
    this.state.leaderboardAllTime = [...leaderboard].sort((a, b) => b.xp - a.xp);
  }

  /**
   * Squad-scoped realtime: completions, feed activity and pings. Returns an
   * unsubscribe. Solo users subscribe to nothing — there is no squad row.
   */
  subscribeSquad(onChange: () => void): () => void {
    if (!this.squadId) return () => {};
    const squadId = this.squadId;
    const refresh = () => {
      api
        .getSquadStatus()
        .then((rows) => {
          if (rows?.length) this.applySquadStatus(rows);
          return api.listFeed(squadId);
        })
        .then((feed) => {
          if (feed) this.state.feed = feed;
          onChange();
        })
        .catch((error) => this.fail(error));
    };
    const client = getSupabase();
    if (!client) return () => {};
    const channel = client
      .channel(`squad:${squadId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'feed_items', filter: `squad_id=eq.${squadId}` },
        refresh,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'task_completions' },
        refresh,
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'pings', filter: `to_user=eq.${this.userId}` },
        refresh,
      )
      .subscribe();
    return () => {
      client.removeChannel(channel);
    };
  }

  // ===================== reads (from the mirror) ==========================

  loadScenario(_scenario: Scenario): ScenarioState {
    // Scenario switching is a mock-only dev affordance. On the real backend
    // the signed-in user's hydrated state IS the scenario.
    return this.state;
  }

  getJournal(): JournalEntry[] {
    return this.state.journal;
  }

  getMeals(): Meal[] {
    return this.state.meals;
  }

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

  getFinalResults(): FinalResults {
    const workoutTasks = TIERS[this.state.tier].taskKeys.filter((k) =>
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

  getBlockedUsers(): string[] {
    return this.blocked.map((b) => b.name);
  }

  getMetricHistory(): MetricCheckin[] {
    return this.metricCheckins;
  }

  getWorkoutLogs(): WorkoutLog[] {
    return this.workoutLogs;
  }

  getActivityTypes(): string[] {
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

  // ===================== optimistic writes ===============================

  saveJournalEntry(day: number, text: string): JournalEntry {
    const entry: JournalEntry = {
      id: localId('j'),
      day,
      timestamp: Date.now(),
      text,
    };
    const previous = this.state.journal;
    this.state.journal = [entry, ...previous];
    this.write(
      () => api.saveJournalEntry(this.requireUser(), day, text),
      () => {
        this.state.journal = previous;
      },
    );
    return entry;
  }

  logMeal(text: string, at: number = Date.now()): Meal {
    const carried = this.state.meals.find(
      (m) => m.text.trim().toLowerCase() === text.trim().toLowerCase() && m.nutrition,
    );
    const meal: Meal = {
      id: localId('ml'),
      text,
      timestamp: at,
      nutrition: carried?.nutrition ? { ...carried.nutrition } : null,
    };
    const previous = this.state.meals;
    this.state.meals = [meal, ...previous];
    this.write(
      () =>
        api.logMeal(this.requireUser(), this.state.day, text, meal.nutrition ?? null),
      () => {
        this.state.meals = previous;
      },
    );
    return meal;
  }

  attachNutrition(mealId: string, nutrition: MealNutrition): Meal[] {
    const previous = this.state.meals;
    this.state.meals = previous.map((m) =>
      m.id === mealId ? { ...m, nutrition } : m,
    );
    // Components ride along inside the nutrition jsonb — see A6 in the
    // report: a meal's components are always read and written with the meal,
    // never queried independently, so they stay one owner-only column.
    this.write(
      () => api.setMealNutrition(mealId, nutrition),
      () => {
        this.state.meals = previous;
      },
    );
    return this.state.meals;
  }

  removeNutrition(mealId: string): Meal[] {
    const previous = this.state.meals;
    this.state.meals = previous.map((m) =>
      m.id === mealId ? { ...m, nutrition: null } : m,
    );
    this.write(
      () => api.setMealNutrition(mealId, null),
      () => {
        this.state.meals = previous;
      },
    );
    return this.state.meals;
  }

  addMilestone(title: string): Milestone {
    const milestone: Milestone = { id: localId('m'), title, done: false };
    const previous = this.state.milestones;
    this.state.milestones = [...previous, milestone];
    this.write(
      () => api.addMilestone(this.requireUser(), title),
      () => {
        this.state.milestones = previous;
      },
    );
    return milestone;
  }

  toggleMilestone(id: string, day: number): Milestone[] {
    const previous = this.state.milestones;
    const target = previous.find((m) => m.id === id);
    this.state.milestones = previous.map((m) =>
      m.id === id
        ? { ...m, done: !m.done, meta: !m.done ? `Hit on Day ${day}` : undefined }
        : m,
    );
    this.write(
      () => api.setMilestoneDone(id, !target?.done, day),
      () => {
        this.state.milestones = previous;
      },
    );
    return this.state.milestones;
  }

  saveMetricCheckin(weightKg: number | null, mood: number | null): MetricCheckin {
    // weightKg is canonical kg — conversion happened at the input boundary.
    const checkin: MetricCheckin = {
      id: localId('mc'),
      timestamp: Date.now(),
      weightKg,
      mood,
    };
    const previous = this.metricCheckins;
    this.metricCheckins = [checkin, ...previous];
    this.write(
      () => api.saveMetricCheckin(this.requireUser(), weightKg, mood),
      () => {
        this.metricCheckins = previous;
      },
    );
    return checkin;
  }

  saveWorkoutLog(input: WorkoutLogInput): WorkoutLog {
    const log: WorkoutLog = { ...input, id: localId('wl'), loggedAt: Date.now() };
    const previous = this.workoutLogs;
    this.workoutLogs = [log, ...previous];
    // Every field here is app-owned: duration from our timer or typed by the
    // user, type/effort/notes user-authored. No HealthKit value is included.
    this.write(
      () =>
        api.saveWorkoutLog(this.requireUser(), this.requireChallenge(), {
          day: input.day,
          taskKey: input.taskKey,
          activityType: input.activityType,
          durationSeconds: input.durationSeconds,
          effort: input.effort,
          notes: input.notes,
        }),
      () => {
        this.workoutLogs = previous;
      },
    );
    return log;
  }

  saveCompletionFeeling(feeling: string | null, text: string): void {
    this.write(
      () => api.saveCompletionFeeling(this.requireUser(), feeling, text),
      () => {},
    );
  }

  // ===================== squad ===========================================

  createSquad(name: string): Squad {
    // Server generates the invite code, so this one cannot be faked
    // optimistically: show the user's own row immediately, then reconcile.
    const provisional: Squad = {
      name,
      code: '······',
      streak: 0,
      members: [
        {
          id: this.userId ?? 'you',
          name: 'You',
          initials: 'YO',
          level: Math.floor(this.state.xp / XP.perLevel) + 1,
          doneToday: 0,
          isSelf: true,
        },
      ],
    };
    this.state.squad = provisional;
    api
      .createSquad(name)
      .then(() => api.getSquadStatus())
      .then((rows) => {
        if (rows?.length) {
          this.squadId = rows[0].squad_id;
          this.applySquadStatus(rows);
        }
      })
      .catch((error) => {
        this.state.squad = null;
        this.fail(error);
      });
    return provisional;
  }

  joinSquad(code: string): Squad {
    const provisional: Squad = {
      name: 'Joining…',
      code: code.toUpperCase(),
      streak: 0,
      members: [],
    };
    this.state.squad = provisional;
    api
      .joinSquad(code.trim().toUpperCase())
      .then(() => api.getSquadStatus())
      .then((rows) => {
        if (rows?.length) {
          this.squadId = rows[0].squad_id;
          this.applySquadStatus(rows);
        }
      })
      .catch((error) => {
        this.state.squad = null;
        this.fail(error);
      });
    return provisional;
  }

  leaveSquad(): void {
    const previous = this.state.squad;
    const previousId = this.squadId;
    this.state.squad = null;
    this.state.feed = [];
    this.state.leaderboardWeek = [];
    this.state.leaderboardAllTime = [];
    this.squadId = null;
    this.write(
      () => api.leaveSquad(),
      () => {
        this.state.squad = previous;
        this.squadId = previousId;
      },
    );
  }

  // ===================== moderation / compliance =========================

  reportContent(feedItemId: string, reason: ReportReason): void {
    this.write(
      () => api.reportContent(this.requireUser(), feedItemId, reason),
      () => {},
    );
  }

  /** The UI blocks by display name; the table keys by user id. */
  private resolveMemberId(name: string): string | null {
    const member = this.state.squad?.members.find((m) => m.name === name);
    return member?.id ?? null;
  }

  blockUser(name: string): string[] {
    const id = this.resolveMemberId(name);
    if (!id) {
      this.fail(new BackendError('unknown', `No squadmate named ${name}`));
      return this.getBlockedUsers();
    }
    const previous = this.blocked;
    if (!previous.some((b) => b.id === id)) {
      this.blocked = [...previous, { id, name }];
    }
    this.write(
      () => api.blockUser(this.requireUser(), id),
      () => {
        this.blocked = previous;
      },
    );
    return this.getBlockedUsers();
  }

  unblockUser(name: string): string[] {
    const previous = this.blocked;
    const target = previous.find((b) => b.name === name);
    this.blocked = previous.filter((b) => b.name !== name);
    if (target) {
      this.write(
        () => api.unblockUser(this.requireUser(), target.id),
        () => {
          this.blocked = previous;
        },
      );
    }
    return this.getBlockedUsers();
  }

  deleteAccount(): void {
    const userId = this.userId;
    this.state.journal = [];
    this.state.meals = [];
    this.state.milestones = [];
    this.metricCheckins = [];
    this.workoutLogs = [];
    this.savedMeals = [];
    this.blocked = [];
    AsyncStorage.multiRemove([TIMER_STORAGE_KEY, SAVED_MEALS_KEY]).catch(() => {});
    NutritionService.clearCache().catch(() => {});
    if (!userId) return;
    // Cascades from auth.users; the RPC also signs the session out.
    Promise.resolve(api.deleteAccount()).catch((error: unknown) => this.fail(error));
  }

  // ===================== timer (device-local) ============================

  private persistTimer(timer: ActiveTimer): Promise<void> {
    return AsyncStorage.setItem(TIMER_STORAGE_KEY, JSON.stringify(timer));
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

  /**
   * Completion goes through the RPC, which validates the task against the
   * server's frozen snapshot for the server's current day — a lying client
   * cannot complete a task that today doesn't require.
   */
  async completeTimedTask(taskKey: TaskKey, elapsedSeconds: number): Promise<void> {
    await AsyncStorage.removeItem(TIMER_STORAGE_KEY);
    const { error } = await api.completeTask(taskKey, Math.round(elapsedSeconds));
    if (error) throw classify(error);
  }

  // ===================== nutrition (external API) ========================

  searchFoods(query: string): Promise<FoodSearchResult[]> {
    return NutritionService.searchFoods(query);
  }

  getFoodDetail(fdcId: number): Promise<FoodDetail> {
    return NutritionService.getFoodDetail(fdcId);
  }

  // Saved meal templates stay device-local by design: they are a typing
  // shortcut, not user history, and keeping them off the server avoids
  // syncing a second copy of nutrition data that already lives on meals.
  private async readSavedMeals(): Promise<SavedMeal[]> {
    try {
      const raw = await AsyncStorage.getItem(SAVED_MEALS_KEY);
      return raw ? (JSON.parse(raw) as SavedMeal[]) : [];
    } catch {
      return [];
    }
  }

  async getSavedMeals(): Promise<SavedMeal[]> {
    if (!this.savedMeals.length) this.savedMeals = await this.readSavedMeals();
    return this.savedMeals;
  }

  async saveMealTemplate(name: string, nutrition: MealNutrition): Promise<SavedMeal[]> {
    const meals = await this.getSavedMeals();
    this.savedMeals = [
      { id: localId('sm'), name: name.trim(), nutrition },
      ...meals.filter((m) => m.name.trim().toLowerCase() !== name.trim().toLowerCase()),
    ].slice(0, 20);
    await AsyncStorage.setItem(SAVED_MEALS_KEY, JSON.stringify(this.savedMeals)).catch(
      () => {},
    );
    return this.savedMeals;
  }

  async removeSavedMeal(id: string): Promise<SavedMeal[]> {
    this.savedMeals = (await this.getSavedMeals()).filter((m) => m.id !== id);
    await AsyncStorage.setItem(SAVED_MEALS_KEY, JSON.stringify(this.savedMeals)).catch(
      () => {},
    );
    return this.savedMeals;
  }

  // ===================== task configuration ==============================

  initTaskConfig(_tier: Tier, day: number): TaskDef[] {
    // The server already froze today when hydrate() called get_or_freeze_today.
    return this.daySnapshots[day] ?? [];
  }

  getTodayTasks(tier: Tier, day: number): TaskDef[] {
    const snapshot = this.daySnapshots[day];
    if (snapshot) return snapshot;
    // No local freezing: an absent snapshot means hydration has not finished.
    // Project the same inputs the server would, purely so the UI can render.
    return composeTaskSet(tier, day, {
      customTasks: this.customTasks,
      targetOverrides: this.targetOverrides,
    });
  }

  getTomorrowTasks(currentTier: Tier, day: number): TaskDef[] {
    return composeTaskSet(this.pendingTier ?? currentTier, day + 1, {
      customTasks: this.customTasks,
      targetOverrides: this.targetOverrides,
    });
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
      id: localId('ct'),
      name: input.name.trim(),
      sub: input.sub.trim(),
      proof: input.proof,
      timerMinutes: input.timerMinutes,
      activeFromDay: day + 1,
      removedFromDay: null,
    };
    const previous = this.customTasks;
    this.customTasks = [...previous, task];
    this.write(
      () => api.addCustomTask(input),
      () => {
        this.customTasks = previous;
      },
    );
    return this.customTasks[this.customTasks.length - 1];
  }

  updateCustomTask(
    id: string,
    patch: Partial<Pick<CustomTask, 'name' | 'sub' | 'proof' | 'timerMinutes'>>,
  ): CustomTask[] {
    const previous = this.customTasks;
    this.customTasks = previous.map((c) =>
      c.id === id ? { ...c, ...patch, name: (patch.name ?? c.name).trim() } : c,
    );
    const updated = this.customTasks.find((c) => c.id === id);
    this.write(
      () =>
        api.updateCustomTask(id, {
          name: updated?.name ?? '',
          sub: updated?.sub ?? '',
          proof: !!updated?.proof,
          timerMinutes: updated?.timerMinutes,
        }),
      () => {
        this.customTasks = previous;
      },
    );
    return this.customTasks;
  }

  removeCustomTask(id: string, day: number): CustomTask[] {
    const previous = this.customTasks;
    const target = previous.find((c) => c.id === id);
    if (!target) return previous;
    this.customTasks =
      target.activeFromDay > day
        ? previous.filter((c) => c.id !== id)
        : previous.map((c) => (c.id === id ? { ...c, removedFromDay: day + 1 } : c));
    this.write(
      () => api.removeCustomTask(id),
      () => {
        this.customTasks = previous;
      },
    );
    return this.customTasks;
  }

  changeTier(tier: Tier | null): void {
    const previous = this.pendingTier;
    this.pendingTier = tier;
    if (tier == null) return; // clearing is local-only until rollover
    this.write(
      () => api.changeTier(tier),
      () => {
        this.pendingTier = previous;
      },
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

  private pendingTargetChanges(currentTier: Tier): TargetChange[] {
    return pendingTargetChanges(
      currentTier,
      this.targetOverrides,
      this.overridesAtDayStart,
    );
  }

  undoPendingChanges(day: number): void {
    const previousTasks = this.customTasks;
    const previousOverrides = this.targetOverrides;
    const previousTier = this.pendingTier;
    const reinstated = previousTasks.filter((c) => c.activeFromDay === day + 1);
    this.customTasks = previousTasks
      .filter((c) => c.activeFromDay !== day + 1)
      .map((c) => (c.removedFromDay === day + 1 ? { ...c, removedFromDay: null } : c));
    this.targetOverrides = { ...this.overridesAtDayStart };
    this.pendingTier = null;

    const rollback = () => {
      this.customTasks = previousTasks;
      this.targetOverrides = previousOverrides;
      this.pendingTier = previousTier;
    };
    // Undo is several server operations; any failure restores everything.
    this.write(
      () => api.undoPendingChanges(reinstated.map((c) => c.id), this.overridesAtDayStart),
      rollback,
    );
  }

  rolloverDay(
    currentTier: Tier,
    oldDay: number,
  ): { tier: Tier; day: number; todayTasks: TaskDef[] } {
    // Rollover is the SERVER's decision (its clock, its timezone). This
    // refreshes from the server rather than advancing anything locally.
    const tier = this.pendingTier ?? currentTier;
    api
      .getOrFreezeToday()
      .then((day) => {
        if (!day) return;
        this.state.day = day.day;
        this.daySnapshots[day.day] = day.task_snapshot;
        this.overridesAtDayStart = { ...this.targetOverrides };
        this.pendingTier = null;
      })
      .catch((error) => this.fail(error));
    const day = oldDay + 1;
    return {
      tier,
      day,
      todayTasks:
        this.daySnapshots[day] ??
        composeTaskSet(tier, day, {
          customTasks: this.customTasks,
          targetOverrides: this.targetOverrides,
        }),
    };
  }

  updateTaskTarget(taskKey: TaskKey, value: number, currentTier: Tier): void {
    const standard = TIERS[currentTier].standards[taskKey as BuiltinTaskKey];
    const previous = { ...this.targetOverrides };
    if (value === standard) delete this.targetOverrides[taskKey];
    else this.targetOverrides[taskKey] = value;
    this.write(
      () => api.setTargetOverride(taskKey, value),
      () => {
        this.targetOverrides = previous;
      },
    );
  }

  getTierStandards(tier: Tier): Partial<Record<TaskKey, TaskTarget>> {
    return tierStandards(tier);
  }

  // ===================== helpers =========================================

  private requireUser(): string {
    if (!this.userId) throw new BackendError('auth', 'Not signed in');
    return this.userId;
  }

  private requireChallenge(): string {
    if (!this.challengeId) throw new BackendError('auth', 'No active challenge');
    return this.challengeId;
  }

  /** Mirror access for the store's own reads (task completions, etc.). */
  get snapshot(): ScenarioState {
    return this.state;
  }

  /** Optimistic task toggle used by the store's completeTask path. */
  completeTaskOptimistic(taskKey: TaskKey, at: string): void {
    const previous = { ...this.state.tasksDone };
    this.state.tasksDone = { ...previous, [taskKey]: at };
    this.write(
      () => api.completeTask(taskKey),
      () => {
        this.state.tasksDone = previous;
      },
    );
  }

  uncompleteTaskOptimistic(taskKey: TaskKey): void {
    const previous = { ...this.state.tasksDone };
    const next = { ...previous };
    delete next[taskKey];
    this.state.tasksDone = next;
    this.write(
      () => api.uncompleteTask(taskKey),
      () => {
        this.state.tasksDone = previous;
      },
    );
  }
}
