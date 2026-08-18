import AsyncStorage from '@react-native-async-storage/async-storage';

import { CHALLENGE } from '@/constants/challenge';
import { TIERS } from '@/constants/tiers';
import { buildScenario } from '@/data/mock';
import type {
  ActiveTimer,
  FinalResults,
  JournalEntry,
  Meal,
  Milestone,
  ReportReason,
  Scenario,
  ScenarioState,
  Squad,
  TaskKey,
} from '@/data/types';

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
    const meal: Meal = { id: nextId('ml'), text, timestamp: at };
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
    AsyncStorage.removeItem(TIMER_STORAGE_KEY).catch(() => {});
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
