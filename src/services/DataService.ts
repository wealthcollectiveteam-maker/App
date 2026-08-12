import { buildScenario } from '@/data/mock';
import type {
  FinalResults,
  JournalEntry,
  Meal,
  Milestone,
  Scenario,
  ScenarioState,
} from '@/data/types';

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
}

let uid = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now()}-${uid++}`;

class MockDataService implements IDataService {
  private state: ScenarioState = buildScenario('day12');
  private feeling: { feeling: string | null; text: string } | null = null;

  loadScenario(scenario: Scenario): ScenarioState {
    this.state = buildScenario(scenario);
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
    return {
      workouts: 150,
      pagesRead: 750,
      gallons: 75,
      day1PhotoUri: null,
      day75PhotoUri: this.state.proofs.photo ?? null,
    };
  }

  saveCompletionFeeling(feeling: string | null, text: string): void {
    this.feeling = { feeling, text };
  }
}

export const DataService: IDataService = new MockDataService();
