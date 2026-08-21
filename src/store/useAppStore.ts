import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import { create } from 'zustand';

import { PINGS, XP } from '@/constants/challenge';
import type { UnitPreference } from '@/lib/units';
import {
  displayTierLabel,
  targetText,
  TASK_BASES,
  TIERS,
} from '@/constants/tiers';
import type {
  BuiltinTaskKey,
  CustomTask,
  FeedItem,
  HealthPrefs,
  JournalEntry,
  Meal,
  MealNutrition,
  MetricCheckin,
  Milestone,
  NotificationPrefs,
  PendingChanges,
  ReportReason,
  SavedMeal,
  Scenario,
  ScenarioState,
  TaskDef,
  TaskKey,
  Tier,
} from '@/data/types';
import { DataService } from '@/services/DataService';
import {
  getHealthService,
  isHealthSimulated,
  setHealthSimulation,
  type BodyMassSample,
  type HealthWorkout,
} from '@/services/HealthService';

export function formatClock(ts: number = Date.now()): string {
  const d = new Date(ts);
  let h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}

export function relativeTime(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Local calendar date (YYYY-MM-DD) — ping allowance is keyed to this. */
export function localDateKey(ts: number = Date.now()): string {
  const d = new Date(ts);
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Coarse local week key — gates the weekly check-in card. */
export function localWeekKey(ts: number = Date.now()): string {
  const d = new Date(ts);
  const start = new Date(d.getFullYear(), 0, 1);
  const week = Math.floor((d.getTime() - start.getTime()) / (7 * 86_400_000));
  return `${d.getFullYear()}-W${week}`;
}

/** On-device Apple Health readings. Render-only; never synced or logged. */
export interface HealthReadings {
  dietaryKcal: number | null;
  steps: number | null;
  activeEnergyKcal: number | null;
  workouts: HealthWorkout[];
  bodyMass: BodyMassSample | null;
}

const EMPTY_READINGS: HealthReadings = {
  dietaryKcal: null,
  steps: null,
  activeEnergyKcal: null,
  workouts: [],
  bodyMass: null,
};

const DEFAULT_HEALTH_PREFS: HealthPrefs = {
  healthEnabled: true,
  dietPromptEnabled: true,
  workoutPromptEnabled: true,
  weightPrefillEnabled: true,
};

let feedId = 0;

export type ScreenStateKind = 'ready' | 'loading' | 'error';

interface AppState extends ScenarioState {
  scenario: Scenario;
  deferred: TaskKey[];
  finishFeeling: string | null;
  finishFeelingText: string;
  profileName: string;
  notificationPrefs: NotificationPrefs;
  blockedUsers: string[];
  /** Pings spent on `date` (local calendar day). Restores at local midnight. */
  pingsUsed: { date: string; count: number };
  /** Dev-forced screen state for QA of loading/error UI. */
  screenState: ScreenStateKind;
  healthPrefs: HealthPrefs;
  /** On-device only. Never written to a backend or log. */
  healthReadings: HealthReadings;
  /** Whether a HealthKit source can be queried right now. */
  healthAvailable: boolean;
  /** Health prompt dismissals: 'diet' | 'workout' -> local date dismissed. */
  healthPromptDismissed: Partial<Record<'diet' | 'workout', string>>;
  /**
   * Start times of Health workouts already used to confirm a task — one
   * recorded activity vouches for at most one completion.
   */
  healthWorkoutsConsumed: string[];
  healthSimulated: boolean;
  metricCheckins: MetricCheckin[];
  savedMeals: SavedMeal[];
  /** Display preference only — storage is ALWAYS kg/cm (see lib/units.ts). */
  unitPreference: UnitPreference;
  /** Week key when the check-in card was dismissed or saved. */
  checkinHandledWeek: string | null;
  /** Settings: permanently hide the weekly check-in card. */
  weeklyCheckinEnabled: boolean;
  /**
   * TODAY's task set, frozen at day start. Every count, completion check
   * and streak evaluation reads this snapshot — never the live task list —
   * so edits can never alter today or the past.
   */
  todayTasks: TaskDef[];
  /** Tomorrow's set, reflecting pending adds/removals and tier change. */
  tomorrowTasks: TaskDef[];
  customTasks: CustomTask[];
  pendingChanges: PendingChanges;

  loadScenario: (scenario: Scenario) => void;
  setTier: (tier: Tier) => void;
  applyMissedDay: () => void;
  completeTask: (key: TaskKey) => void;
  uncompleteTask: (key: TaskKey) => void;
  deferTask: (key: TaskKey) => void;
  attachProof: (key: TaskKey) => void;
  sealDay: () => void;
  saveJournal: (text: string) => JournalEntry;
  logMeal: (text: string) => Meal;
  addMilestone: (title: string) => Milestone;
  toggleMilestone: (id: string) => void;
  /** Returns false when the daily ping allowance is spent. */
  sendPing: (toName: string, text: string) => boolean;
  createSquad: (name: string) => void;
  joinSquad: (code: string) => void;
  leaveSquad: () => void;
  reportFeedItem: (id: string, reason: ReportReason) => void;
  blockUser: (name: string) => void;
  unblockUser: (name: string) => void;
  updateProfile: (name: string, why: string) => void;
  setNotificationPref: (key: keyof NotificationPrefs, value: boolean) => void;
  attachNutrition: (mealId: string, nutrition: MealNutrition) => void;
  removeNutrition: (mealId: string) => void;
  saveMealTemplate: (name: string, nutrition: MealNutrition) => void;
  removeSavedMeal: (id: string) => void;
  /** One-tap log of a saved meal (name + attached nutrition). */
  logSavedMeal: (id: string) => void;
  setHealthPref: (key: keyof HealthPrefs, value: boolean) => void;
  refreshHealth: () => Promise<void>;
  dismissHealthPrompt: (kind: 'diet' | 'workout') => void;
  /** Mark a Health workout as used for a confirmed completion. */
  consumeHealthWorkout: (startISO: string) => void;
  toggleHealthSimulation: () => void;
  saveMetricCheckin: (weightKg: number | null, mood: number | null) => void;
  dismissCheckinCard: () => void;
  setWeeklyCheckinEnabled: (enabled: boolean) => void;
  setUnitPreference: (pref: UnitPreference) => void;
  /** Load persisted preference + check-ins (call once at app start). */
  hydratePersisted: () => Promise<void>;
  /** Returns false when the 4-custom-task cap is hit. */
  addCustomTask: (input: {
    name: string;
    sub: string;
    proof: boolean;
    timerMinutes?: number;
  }) => boolean;
  updateCustomTask: (
    id: string,
    patch: Partial<Pick<CustomTask, 'name' | 'sub' | 'proof' | 'timerMinutes'>>,
  ) => void;
  removeCustomTask: (id: string) => void;
  /** Pending tier change — takes effect at the next rollover. */
  requestTierChange: (tier: Tier) => void;
  /** Set a tier task's target — effective tomorrow, like every edit. */
  updateTaskTarget: (taskKey: TaskKey, value: number) => void;
  undoPendingChanges: () => void;
  /** Dev: simulate the local-midnight rollover. */
  advanceDay: () => void;
  deleteAccount: () => void;
  setScreenState: (state: ScreenStateKind) => void;
  setFinishFeeling: (feeling: string | null) => void;
  setFinishFeelingText: (text: string) => void;
  saveCompletionFeeling: () => void;
}

function fromScenario(scenario: Scenario): ScenarioState {
  return DataService.loadScenario(scenario);
}

/** Everything DataService owns about the editable task config, mirrored. */
function taskConfigMirror(tier: Tier, day: number) {
  return {
    todayTasks: DataService.getTodayTasks(tier, day),
    tomorrowTasks: DataService.getTomorrowTasks(tier, day),
    customTasks: [...DataService.getCustomTasks()],
    pendingChanges: DataService.getPendingChanges(tier, day),
  };
}

const MAX_CUSTOM_TASKS = 4;

const DEFAULT_PREFS: NotificationPrefs = {
  pings: true,
  squadActivity: true,
  dailyReminder: false,
  timerAlerts: true,
};

const UNIT_PREF_KEY = 'ranked.unitPreference.v1';
const CHECKINS_KEY = 'ranked.metricCheckins.v1';

/** Seed from the device locale; the user can change it in Settings. */
function localeUnitPreference(): UnitPreference {
  try {
    const system = getLocales()[0]?.measurementSystem;
    return system === 'us' ? 'imperial' : 'metric';
  } catch {
    return 'metric';
  }
}

const initialScenario = fromScenario('day1');
const initialTaskConfig = taskConfigMirror(
  initialScenario.tier,
  initialScenario.day,
);

export const useAppStore = create<AppState>((set, get) => ({
  scenario: 'day1',
  deferred: [],
  finishFeeling: null,
  finishFeelingText: '',
  profileName: 'You',
  notificationPrefs: DEFAULT_PREFS,
  blockedUsers: [],
  pingsUsed: { date: localDateKey(), count: 0 },
  screenState: 'ready',
  healthPrefs: DEFAULT_HEALTH_PREFS,
  healthReadings: EMPTY_READINGS,
  healthAvailable: false,
  healthPromptDismissed: {},
  healthWorkoutsConsumed: [],
  healthSimulated: false,
  metricCheckins: [],
  savedMeals: [],
  unitPreference: localeUnitPreference(),
  checkinHandledWeek: null,
  weeklyCheckinEnabled: true,
  ...initialScenario,
  ...initialTaskConfig,

  loadScenario: (scenario) => {
    const st = fromScenario(scenario);
    set({
      scenario,
      deferred: [],
      finishFeeling: null,
      finishFeelingText: '',
      blockedUsers: [],
      pingsUsed: { date: localDateKey(), count: 0 },
      screenState: 'ready',
      ...st,
      ...taskConfigMirror(st.tier, st.day),
    });
  },

  // Dev/QA tier switch: instant, re-freezes today's snapshot for the new
  // tier and drops custom tasks. User-facing tier changes go through
  // requestTierChange and take effect tomorrow.
  setTier: (tier) => {
    const s = get();
    DataService.initTaskConfig(tier, s.day);
    const config = taskConfigMirror(tier, s.day);
    const allowed = new Set(config.todayTasks.map((t) => t.key));
    const tasksDone: Partial<Record<TaskKey, string>> = {};
    for (const [k, v] of Object.entries(s.tasksDone)) {
      if (allowed.has(k)) tasksDone[k] = v;
    }
    const count = config.todayTasks.length;
    set({
      tier,
      ...config,
      tasksDone,
      deferred: s.deferred.filter((k) => allowed.has(k)),
      squad: s.squad
        ? {
            ...s.squad,
            members: s.squad.members.map((m) => ({
              ...m,
              doneToday: Math.min(m.doneToday, count),
            })),
          }
        : null,
    });
  },

  /** Apply the active tier's missed-day penalty. */
  applyMissedDay: () => {
    const s = get();
    const penalty = TIERS[s.tier].missedDay;
    set({
      missedDay: true,
      dayComplete: false,
      tasksDone: {},
      deferred: [],
      flame: penalty.resetsStreak ? 0 : s.flame,
      day: penalty.restartsChallenge ? 1 : s.day,
    });
  },

  completeTask: (key) => {
    const { tasksDone, feed, todayTasks } = get();
    if (tasksDone[key]) return;
    const label = todayTasks.find((t) => t.key === key)?.label ?? key;
    const item: FeedItem = {
      id: `f-local-${++feedId}`,
      kind: 'complete',
      who: 'You',
      text: `checked off ${label}.`,
      timestamp: Date.now(),
    };
    set((s) => ({
      tasksDone: { ...s.tasksDone, [key]: formatClock() },
      deferred: s.deferred.filter((k) => k !== key),
      xp: s.xp + XP.task,
      feed: [item, ...feed],
    }));
  },

  uncompleteTask: (key) => {
    const { tasksDone } = get();
    if (!tasksDone[key]) return;
    set((s) => {
      const next = { ...s.tasksDone };
      delete next[key];
      return { tasksDone: next, xp: Math.max(0, s.xp - XP.task) };
    });
  },

  deferTask: (key) =>
    set((s) => ({
      deferred: [...s.deferred.filter((k) => k !== key), key],
    })),

  attachProof: (key) => {
    const { feed, todayTasks } = get();
    const label = todayTasks.find((t) => t.key === key)?.label ?? key;
    const item: FeedItem = {
      id: `f-local-${++feedId}`,
      kind: 'proof',
      who: 'You',
      text: `attached proof — ${label}.`,
      timestamp: Date.now(),
    };
    set((s) => ({
      proofs: { ...s.proofs, [key]: `mock://proof-${key}` },
      feed: [item, ...feed],
    }));
  },

  sealDay: () => {
    const s = get();
    if (s.dayComplete) return;
    const count = s.todayTasks.length;
    const item: FeedItem = {
      id: `f-local-${++feedId}`,
      kind: 'complete',
      who: 'You',
      text: `locked in Day ${s.day} — ${count} of ${count}.`,
      timestamp: Date.now(),
    };
    set({
      dayComplete: true,
      xp: s.xp + XP.dayComplete,
      flame: s.flame + 1,
      bestFlame: Math.max(s.bestFlame, s.flame + 1),
      perfectDays: s.perfectDays + 1,
      missedDay: false,
      feed: [item, ...s.feed],
    });
  },

  saveJournal: (text) => {
    const entry = DataService.saveJournalEntry(get().day, text);
    set((s) => ({
      journal: [entry, ...s.journal],
      xp: s.xp + XP.journal,
    }));
    return entry;
  },

  logMeal: (text) => {
    const meal = DataService.logMeal(text);
    set((s) => ({ meals: [meal, ...s.meals] }));
    return meal;
  },

  addMilestone: (title) => {
    const milestone = DataService.addMilestone(title);
    set((s) => ({ milestones: [...s.milestones, milestone] }));
    return milestone;
  },

  toggleMilestone: (id) => {
    const s = get();
    const target = s.milestones.find((m) => m.id === id);
    const milestones = DataService.toggleMilestone(id, s.day);
    set({
      milestones,
      xp: target && !target.done ? s.xp + XP.milestone : s.xp,
    });
  },

  sendPing: (toName, text) => {
    const s = get();
    const today = localDateKey();
    const used = s.pingsUsed.date === today ? s.pingsUsed.count : 0;
    if (used >= PINGS.maxPerDay) return false;
    const item: FeedItem = {
      id: `f-local-${++feedId}`,
      kind: 'ping-out',
      who: 'You',
      text: `pinged ${toName} — \u201C${text}\u201D`,
      timestamp: Date.now(),
    };
    set({
      feed: [item, ...s.feed],
      pingsUsed: { date: today, count: used + 1 },
    });
    return true;
  },

  createSquad: (name) => set({ squad: DataService.createSquad(name) }),
  joinSquad: (code) => set({ squad: DataService.joinSquad(code) }),
  leaveSquad: () => {
    DataService.leaveSquad();
    set({ squad: null });
  },

  reportFeedItem: (id, reason) => {
    DataService.reportContent(id, reason);
  },

  blockUser: (name) => set({ blockedUsers: DataService.blockUser(name) }),
  unblockUser: (name) => set({ blockedUsers: DataService.unblockUser(name) }),

  updateProfile: (name, why) =>
    set({ profileName: name.trim() || 'You', why: why.trim() || get().why }),

  setNotificationPref: (key, value) =>
    set((s) => ({
      notificationPrefs: { ...s.notificationPrefs, [key]: value },
    })),

  attachNutrition: (mealId, nutrition) =>
    set({ meals: [...DataService.attachNutrition(mealId, nutrition)] }),

  removeNutrition: (mealId) =>
    set({ meals: [...DataService.removeNutrition(mealId)] }),

  saveMealTemplate: (name, nutrition) => {
    DataService.saveMealTemplate(name, nutrition)
      .then((savedMeals) => set({ savedMeals }))
      .catch(() => {});
  },

  removeSavedMeal: (id) => {
    DataService.removeSavedMeal(id)
      .then((savedMeals) => set({ savedMeals }))
      .catch(() => {});
  },

  logSavedMeal: (id) => {
    const template = get().savedMeals.find((m) => m.id === id);
    if (!template) return;
    const meal = DataService.logMeal(template.name);
    DataService.attachNutrition(meal.id, template.nutrition);
    set({ meals: [...DataService.getMeals()] });
  },

  setHealthPref: (key, value) => {
    set((s) => ({ healthPrefs: { ...s.healthPrefs, [key]: value } }));
    if (key === 'healthEnabled') {
      if (value) {
        const service = getHealthService();
        service
          .requestReadPermissions()
          .then(() => get().refreshHealth())
          .catch(() => {});
      } else {
        set({ healthReadings: EMPTY_READINGS });
      }
    }
  },

  refreshHealth: async () => {
    // Defence in depth: nothing from the health layer may ever propagate
    // into app startup. Any failure degrades to "no health data".
    try {
      const service = getHealthService();
      const available = service.isAvailable();
      const { healthPrefs } = get();
      if (!available || !healthPrefs.healthEnabled) {
        set({ healthReadings: EMPTY_READINGS, healthAvailable: available });
        return;
      }
      const [dietaryKcal, steps, activeEnergyKcal, workouts, bodyMass] =
        await Promise.all([
          service.getTodayDietaryEnergyKcal(),
          service.getTodaySteps(),
          service.getTodayActiveEnergyKcal(),
          service.getTodayWorkouts(),
          service.getLatestBodyMass(),
        ]);
      set({
        healthReadings: { dietaryKcal, steps, activeEnergyKcal, workouts, bodyMass },
        healthAvailable: true,
      });
    } catch {
      set({ healthReadings: EMPTY_READINGS });
    }
  },

  dismissHealthPrompt: (kind) =>
    set((s) => ({
      healthPromptDismissed: {
        ...s.healthPromptDismissed,
        [kind]: localDateKey(),
      },
    })),

  consumeHealthWorkout: (startISO) =>
    set((s) => ({
      healthWorkoutsConsumed: [...s.healthWorkoutsConsumed, startISO],
    })),

  toggleHealthSimulation: () => {
    const next = !isHealthSimulated();
    setHealthSimulation(next);
    set({
      healthSimulated: next,
      healthPromptDismissed: {},
      healthWorkoutsConsumed: [],
    });
    get().refreshHealth();
  },

  saveMetricCheckin: (weightKg, mood) => {
    // weightKg is ALWAYS canonical kg — conversion happened at the input
    // boundary via lib/units.ts. Never store display units.
    const checkin = DataService.saveMetricCheckin(weightKg, mood);
    set((s) => {
      const metricCheckins = [checkin, ...s.metricCheckins];
      AsyncStorage.setItem(CHECKINS_KEY, JSON.stringify(metricCheckins)).catch(
        () => {},
      );
      return { metricCheckins, checkinHandledWeek: localWeekKey() };
    });
  },

  dismissCheckinCard: () => set({ checkinHandledWeek: localWeekKey() }),

  setWeeklyCheckinEnabled: (enabled) =>
    set({ weeklyCheckinEnabled: enabled }),

  setUnitPreference: (pref) => {
    set({ unitPreference: pref });
    AsyncStorage.setItem(UNIT_PREF_KEY, pref).catch(() => {});
  },

  hydratePersisted: async () => {
    try {
      const [pref, checkins] = await Promise.all([
        AsyncStorage.getItem(UNIT_PREF_KEY),
        AsyncStorage.getItem(CHECKINS_KEY),
      ]);
      const updates: Partial<AppState> = {};
      if (pref === 'metric' || pref === 'imperial') {
        updates.unitPreference = pref;
      }
      if (checkins) {
        const parsed = JSON.parse(checkins) as MetricCheckin[];
        if (Array.isArray(parsed)) {
          updates.metricCheckins = parsed;
          if (parsed[0] && localWeekKey(parsed[0].timestamp) === localWeekKey()) {
            updates.checkinHandledWeek = localWeekKey();
          }
        }
      }
      if (Object.keys(updates).length) set(updates);
      const savedMeals = await DataService.getSavedMeals();
      if (savedMeals.length) set({ savedMeals });
    } catch {
      // persisted state is a convenience; never block startup on it
    }
  },

  addCustomTask: (input) => {
    const s = get();
    const activeTomorrow = DataService.getCustomTasks().filter(
      (c) =>
        c.activeFromDay <= s.day + 1 &&
        (c.removedFromDay == null || c.removedFromDay > s.day + 1),
    );
    if (activeTomorrow.length >= MAX_CUSTOM_TASKS) return false;
    DataService.addCustomTask(input, s.day);
    const config = taskConfigMirror(s.tier, s.day);
    const updates: Partial<AppState> = { ...config };
    if (s.squad) {
      const item: FeedItem = {
        id: `f-local-${++feedId}`,
        kind: 'change',
        who: 'You',
        text: `added \u201C${input.name.trim()}\u201D — ${config.pendingChanges.tomorrowCount} tasks from tomorrow.`,
        timestamp: Date.now(),
      };
      updates.feed = [item, ...s.feed];
    }
    set(updates);
    return true;
  },

  updateCustomTask: (id, patch) => {
    const s = get();
    DataService.updateCustomTask(id, patch);
    set(taskConfigMirror(s.tier, s.day));
  },

  removeCustomTask: (id) => {
    const s = get();
    const target = DataService.getCustomTasks().find((c) => c.id === id);
    if (!target) return;
    const wasActive = target.activeFromDay <= s.day;
    DataService.removeCustomTask(id, s.day);
    const config = taskConfigMirror(s.tier, s.day);
    const updates: Partial<AppState> = { ...config };
    // Retracting a not-yet-active pending add is silent; removing a live
    // task is visible to the squad — accountability, not punishment.
    if (s.squad && wasActive) {
      const item: FeedItem = {
        id: `f-local-${++feedId}`,
        kind: 'change',
        who: 'You',
        text: `removed \u201C${target.name}\u201D — ${config.pendingChanges.tomorrowCount} tasks from tomorrow.`,
        timestamp: Date.now(),
      };
      updates.feed = [item, ...s.feed];
    }
    set(updates);
  },

  requestTierChange: (tier) => {
    const s = get();
    DataService.changeTier(tier === s.tier ? null : tier);
    const config = taskConfigMirror(s.tier, s.day);
    const updates: Partial<AppState> = { ...config };
    if (s.squad && tier !== s.tier) {
      const item: FeedItem = {
        id: `f-local-${++feedId}`,
        kind: 'change',
        who: 'You',
        text: `changed tier to ${TIERS[tier].label} — starts tomorrow.`,
        timestamp: Date.now(),
      };
      updates.feed = [item, ...s.feed];
    }
    set(updates);
  },

  updateTaskTarget: (taskKey, value) => {
    const s = get();
    const before = s.tomorrowTasks.find((t) => t.key === taskKey);
    if (!before?.target || value === before.target.value || value < 1) return;
    DataService.updateTaskTarget(taskKey, value, s.tier);
    const config = taskConfigMirror(s.tier, s.day);
    const updates: Partial<AppState> = { ...config };
    if (s.squad) {
      const name =
        TASK_BASES[taskKey as BuiltinTaskKey]?.shortName ?? before.label;
      const raised = value > before.target.value;
      const effectiveTier = config.pendingChanges.pendingTier ?? s.tier;
      const becomesCustom =
        displayTierLabel(config.tomorrowTasks, effectiveTier) === 'Custom' &&
        displayTierLabel(s.tomorrowTasks, effectiveTier) !== 'Custom';
      const item: FeedItem = {
        id: `f-local-${++feedId}`,
        kind: 'change',
        who: 'You',
        text: `${raised ? 'raised' : 'lowered'} ${name} to ${targetText({
          value,
          unit: before.target.unit,
        })}${becomesCustom ? ' — challenge now CUSTOM' : ''}.`,
        timestamp: Date.now(),
      };
      updates.feed = [item, ...s.feed];
    }
    set(updates);
  },

  undoPendingChanges: () => {
    const s = get();
    DataService.undoPendingChanges(s.day);
    set(taskConfigMirror(s.tier, s.day));
  },

  /**
   * Simulates the local-midnight rollover: pending changes take effect,
   * the new day's task set freezes, and today's progress resets.
   */
  advanceDay: () => {
    const s = get();
    const next = DataService.rolloverDay(s.tier, s.day);
    set({
      day: next.day,
      tier: next.tier,
      tasksDone: {},
      deferred: [],
      dayComplete: false,
      missedDay: false,
      healthPromptDismissed: {},
      healthWorkoutsConsumed: [],
      ...taskConfigMirror(next.tier, next.day),
    });
  },

  deleteAccount: () => {
    DataService.deleteAccount();
    AsyncStorage.multiRemove([UNIT_PREF_KEY, CHECKINS_KEY]).catch(() => {});
    const st = fromScenario('day1');
    set({
      scenario: 'day1',
      deferred: [],
      finishFeeling: null,
      finishFeelingText: '',
      profileName: 'You',
      notificationPrefs: DEFAULT_PREFS,
      blockedUsers: [],
      pingsUsed: { date: localDateKey(), count: 0 },
      screenState: 'ready',
      healthPrefs: DEFAULT_HEALTH_PREFS,
      healthReadings: EMPTY_READINGS,
      healthPromptDismissed: {},
      healthWorkoutsConsumed: [],
      metricCheckins: [],
      savedMeals: [],
      unitPreference: localeUnitPreference(),
      checkinHandledWeek: null,
      weeklyCheckinEnabled: true,
      ...st,
      ...taskConfigMirror(st.tier, st.day),
    });
  },

  setScreenState: (screenState) => set({ screenState }),
  setFinishFeeling: (feeling) => set({ finishFeeling: feeling }),
  setFinishFeelingText: (text) => set({ finishFeelingText: text }),
  saveCompletionFeeling: () => {
    const { finishFeeling, finishFeelingText } = get();
    DataService.saveCompletionFeeling(finishFeeling, finishFeelingText);
  },
}));

// ---- Derived selectors ----

/**
 * TODAY's task set — the day-start snapshot, never the live list. All
 * counts, completion checks and streak logic must read through this.
 */
export const selectTasks = (s: { todayTasks: TaskDef[] }): TaskDef[] =>
  s.todayTasks;

/**
 * The tier tag the app displays: the base tier's label, or CUSTOM when any
 * of TODAY's tier tasks runs below its standard. Derived from the snapshot,
 * so a lowered target only relabels the challenge from tomorrow.
 */
export const selectTierLabel = (s: {
  todayTasks: TaskDef[];
  tier: Tier;
}): string => displayTierLabel(s.todayTasks, s.tier);

export const selectTaskCount = (s: { todayTasks: TaskDef[] }) =>
  s.todayTasks.length;

export const selectLevel = (xp: number) => Math.floor(xp / XP.perLevel) + 1;
export const selectXpIntoLevel = (xp: number) => xp % XP.perLevel;
export const selectXpToNext = (xp: number) => XP.perLevel - (xp % XP.perLevel);

export const selectDoneCount = (s: {
  todayTasks: TaskDef[];
  tasksDone: Partial<Record<TaskKey, string>>;
}) => s.todayTasks.filter((t) => s.tasksDone[t.key]).length;

/** Pending tasks in deck order: undeferred first, deferred at the back. */
export const selectQueue = (s: {
  todayTasks: TaskDef[];
  tasksDone: Partial<Record<TaskKey, string>>;
  deferred: TaskKey[];
}): TaskKey[] => {
  const pending = s.todayTasks
    .map((t) => t.key)
    .filter((k) => !s.tasksDone[k]);
  const fresh = pending.filter((k) => !s.deferred.includes(k));
  const deferred = s.deferred.filter((k) => pending.includes(k));
  return [...fresh, ...deferred];
};

/** Pings remaining today, respecting the local-midnight reset. */
export const selectPingsLeft = (s: {
  pingsUsed: { date: string; count: number };
}) => {
  const used = s.pingsUsed.date === localDateKey() ? s.pingsUsed.count : 0;
  return Math.max(0, PINGS.maxPerDay - used);
};

/**
 * Match today's HealthKit workouts to incomplete workout tasks.
 * Chronological, one workout per task, qualifying = duration >= the task's
 * snapshot target. Suggestions only — the user always confirms (never
 * auto-complete), and completion goes through the existing path.
 */
export const selectWorkoutSuggestions = (s: {
  healthPrefs: HealthPrefs;
  healthReadings: HealthReadings;
  healthWorkoutsConsumed: string[];
  todayTasks: TaskDef[];
  tasksDone: Partial<Record<TaskKey, string>>;
}): Partial<Record<TaskKey, HealthWorkout>> => {
  if (!s.healthPrefs.healthEnabled || !s.healthPrefs.workoutPromptEnabled) {
    return {};
  }
  const pendingWorkoutTasks = s.todayTasks.filter(
    (t) => t.key.startsWith('workout') && !s.tasksDone[t.key],
  );
  if (pendingWorkoutTasks.length === 0) return {};
  const out: Partial<Record<TaskKey, HealthWorkout>> = {};
  // Chronological, minus workouts already used to confirm a completion.
  const unclaimed = s.healthReadings.workouts.filter(
    (w) => !s.healthWorkoutsConsumed.includes(w.startISO),
  );
  for (const task of pendingWorkoutTasks) {
    const required =
      task.target?.unit === 'minutes' ? task.target.value : Infinity;
    const idx = unclaimed.findIndex((w) => w.minutes >= required);
    if (idx >= 0) {
      out[task.key] = unclaimed[idx];
      unclaimed.splice(idx, 1);
    }
  }
  return out;
};

/** Body-mass prefill: only a sample from the last 7 days qualifies. */
export const selectWeightPrefillKg = (s: {
  healthPrefs: HealthPrefs;
  healthReadings: HealthReadings;
}): { kg: number; dateISO: string } | null => {
  if (!s.healthPrefs.healthEnabled || !s.healthPrefs.weightPrefillEnabled) {
    return null;
  }
  const sample = s.healthReadings.bodyMass;
  if (!sample) return null;
  const ageMs = Date.now() - Date.parse(sample.dateISO);
  if (ageMs > 7 * 86_400_000) return null;
  return { kg: sample.kg, dateISO: sample.dateISO };
};

export const selectRecentMeals = (meals: Meal[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of meals) {
    const key = m.text.trim().toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(m.text);
    }
  }
  return out;
};
