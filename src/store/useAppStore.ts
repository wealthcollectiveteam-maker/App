import { create } from 'zustand';

import { TASKS, XP } from '@/data/mock';
import type {
  FeedItem,
  JournalEntry,
  Meal,
  Milestone,
  Scenario,
  ScenarioState,
  TaskKey,
} from '@/data/types';
import { DataService } from '@/services/DataService';

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

let feedId = 0;

interface AppState extends ScenarioState {
  scenario: Scenario;
  deferred: TaskKey[];
  finishFeeling: string | null;
  finishFeelingText: string;

  loadScenario: (scenario: Scenario) => void;
  completeTask: (key: TaskKey) => void;
  uncompleteTask: (key: TaskKey) => void;
  deferTask: (key: TaskKey) => void;
  attachProof: (key: TaskKey) => void;
  sealDay: () => void;
  saveJournal: (text: string) => JournalEntry;
  logMeal: (text: string) => Meal;
  addMilestone: (title: string) => Milestone;
  toggleMilestone: (id: string) => void;
  sendPing: (toName: string, text: string) => void;
  setFinishFeeling: (feeling: string | null) => void;
  setFinishFeelingText: (text: string) => void;
  saveCompletionFeeling: () => void;
}

function fromScenario(scenario: Scenario): ScenarioState {
  return DataService.loadScenario(scenario);
}

export const useAppStore = create<AppState>((set, get) => ({
  scenario: 'day1',
  deferred: [],
  finishFeeling: null,
  finishFeelingText: '',
  ...fromScenario('day1'),

  loadScenario: (scenario) =>
    set({
      scenario,
      deferred: [],
      finishFeeling: null,
      finishFeelingText: '',
      ...fromScenario(scenario),
    }),

  completeTask: (key) => {
    const { tasksDone, feed } = get();
    if (tasksDone[key]) return;
    const label = TASKS.find((t) => t.key === key)?.label ?? key;
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
    const { feed } = get();
    const label = TASKS.find((t) => t.key === key)?.label ?? key;
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
    const item: FeedItem = {
      id: `f-local-${++feedId}`,
      kind: 'complete',
      who: 'You',
      text: `locked in Day ${s.day} — 6 of 6.`,
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
    const item: FeedItem = {
      id: `f-local-${++feedId}`,
      kind: 'ping-out',
      who: 'You',
      text: `pinged ${toName} — \u201C${text}\u201D`,
      timestamp: Date.now(),
    };
    set((s) => ({ feed: [item, ...s.feed] }));
  },

  setFinishFeeling: (feeling) => set({ finishFeeling: feeling }),
  setFinishFeelingText: (text) => set({ finishFeelingText: text }),
  saveCompletionFeeling: () => {
    const { finishFeeling, finishFeelingText } = get();
    DataService.saveCompletionFeeling(finishFeeling, finishFeelingText);
  },
}));

// ---- Derived selectors ----

export const selectLevel = (xp: number) => Math.floor(xp / XP.perLevel) + 1;
export const selectXpIntoLevel = (xp: number) => xp % XP.perLevel;
export const selectXpToNext = (xp: number) => XP.perLevel - (xp % XP.perLevel);

export const selectDoneCount = (s: Pick<ScenarioState, 'tasksDone'>) =>
  TASKS.filter((t) => s.tasksDone[t.key]).length;

/** Pending tasks in deck order: undeferred first, deferred at the back. */
export const selectQueue = (s: {
  tasksDone: Partial<Record<TaskKey, string>>;
  deferred: TaskKey[];
}): TaskKey[] => {
  const pending = TASKS.map((t) => t.key).filter((k) => !s.tasksDone[k]);
  const fresh = pending.filter((k) => !s.deferred.includes(k));
  const deferred = s.deferred.filter((k) => pending.includes(k));
  return [...fresh, ...deferred];
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
