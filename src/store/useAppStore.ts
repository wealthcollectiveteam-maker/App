import { create } from 'zustand';

import { PINGS, XP } from '@/constants/challenge';
import { TIER_TASKS, TIERS } from '@/constants/tiers';
import type {
  FeedItem,
  HealthPrefs,
  JournalEntry,
  Meal,
  MealNutrition,
  MetricCheckin,
  Milestone,
  NotificationPrefs,
  ReportReason,
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
  bodyMassKg: number | null;
  workoutMinutes: number | null;
}

const EMPTY_READINGS: HealthReadings = {
  dietaryKcal: null,
  bodyMassKg: null,
  workoutMinutes: null,
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
  /** Health prompt dismissals: 'diet' | 'workout' -> local date dismissed. */
  healthPromptDismissed: Partial<Record<'diet' | 'workout', string>>;
  healthSimulated: boolean;
  metricCheckins: MetricCheckin[];
  /** Week key when the check-in card was dismissed or saved. */
  checkinHandledWeek: string | null;
  /** Settings: permanently hide the weekly check-in card. */
  weeklyCheckinEnabled: boolean;

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
  setHealthPref: (key: keyof HealthPrefs, value: boolean) => void;
  refreshHealth: () => Promise<void>;
  dismissHealthPrompt: (kind: 'diet' | 'workout') => void;
  toggleHealthSimulation: () => void;
  saveMetricCheckin: (weightKg: number | null, mood: number | null) => void;
  dismissCheckinCard: () => void;
  setWeeklyCheckinEnabled: (enabled: boolean) => void;
  deleteAccount: () => void;
  setScreenState: (state: ScreenStateKind) => void;
  setFinishFeeling: (feeling: string | null) => void;
  setFinishFeelingText: (text: string) => void;
  saveCompletionFeeling: () => void;
}

function fromScenario(scenario: Scenario): ScenarioState {
  return DataService.loadScenario(scenario);
}

const DEFAULT_PREFS: NotificationPrefs = {
  pings: true,
  squadActivity: true,
  dailyReminder: false,
};

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
  healthPromptDismissed: {},
  healthSimulated: false,
  metricCheckins: [],
  checkinHandledWeek: null,
  weeklyCheckinEnabled: true,
  ...fromScenario('day1'),

  loadScenario: (scenario) =>
    set({
      scenario,
      deferred: [],
      finishFeeling: null,
      finishFeelingText: '',
      blockedUsers: [],
      pingsUsed: { date: localDateKey(), count: 0 },
      screenState: 'ready',
      ...fromScenario(scenario),
    }),

  setTier: (tier) => {
    const s = get();
    const allowed = new Set(TIERS[tier].taskKeys);
    const tasksDone: Partial<Record<TaskKey, string>> = {};
    for (const [k, v] of Object.entries(s.tasksDone)) {
      if (allowed.has(k as TaskKey)) tasksDone[k as TaskKey] = v;
    }
    const count = TIERS[tier].taskKeys.length;
    set({
      tier,
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
    const { tasksDone, feed, tier } = get();
    if (tasksDone[key]) return;
    const label =
      TIER_TASKS[tier].find((t) => t.key === key)?.label ?? key;
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
    const { feed, tier } = get();
    const label =
      TIER_TASKS[tier].find((t) => t.key === key)?.label ?? key;
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
    const count = TIER_TASKS[s.tier].length;
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
    const { healthPrefs } = get();
    if (!healthPrefs.healthEnabled) {
      set({ healthReadings: EMPTY_READINGS });
      return;
    }
    const service = getHealthService();
    if (!service.isAvailable()) {
      set({ healthReadings: EMPTY_READINGS });
      return;
    }
    const [dietaryKcal, bodyMassKg, workoutMinutes] = await Promise.all([
      service.getTodayDietaryEnergyKcal(),
      service.getLatestBodyMassKg(),
      service.getTodayLongestWorkoutMinutes(),
    ]);
    set({ healthReadings: { dietaryKcal, bodyMassKg, workoutMinutes } });
  },

  dismissHealthPrompt: (kind) =>
    set((s) => ({
      healthPromptDismissed: {
        ...s.healthPromptDismissed,
        [kind]: localDateKey(),
      },
    })),

  toggleHealthSimulation: () => {
    const next = !isHealthSimulated();
    setHealthSimulation(next);
    set({ healthSimulated: next, healthPromptDismissed: {} });
    get().refreshHealth();
  },

  saveMetricCheckin: (weightKg, mood) => {
    const checkin = DataService.saveMetricCheckin(weightKg, mood);
    set((s) => ({
      metricCheckins: [checkin, ...s.metricCheckins],
      checkinHandledWeek: localWeekKey(),
    }));
  },

  dismissCheckinCard: () => set({ checkinHandledWeek: localWeekKey() }),

  setWeeklyCheckinEnabled: (enabled) =>
    set({ weeklyCheckinEnabled: enabled }),

  deleteAccount: () => {
    DataService.deleteAccount();
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
      metricCheckins: [],
      checkinHandledWeek: null,
      weeklyCheckinEnabled: true,
      ...fromScenario('day1'),
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

/** Active tier's task list (stable array reference per tier). */
export const selectTasks = (s: { tier: Tier }): TaskDef[] =>
  TIER_TASKS[s.tier];

export const selectTaskCount = (s: { tier: Tier }) =>
  TIER_TASKS[s.tier].length;

export const selectLevel = (xp: number) => Math.floor(xp / XP.perLevel) + 1;
export const selectXpIntoLevel = (xp: number) => xp % XP.perLevel;
export const selectXpToNext = (xp: number) => XP.perLevel - (xp % XP.perLevel);

export const selectDoneCount = (
  s: Pick<ScenarioState, 'tasksDone' | 'tier'>,
) => TIER_TASKS[s.tier].filter((t) => s.tasksDone[t.key]).length;

/** Pending tasks in deck order: undeferred first, deferred at the back. */
export const selectQueue = (s: {
  tier: Tier;
  tasksDone: Partial<Record<TaskKey, string>>;
  deferred: TaskKey[];
}): TaskKey[] => {
  const pending = TIER_TASKS[s.tier]
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
