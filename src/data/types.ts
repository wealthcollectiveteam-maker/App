export type Tier = 'hard' | 'medium' | 'soft';

export type Scenario = 'day1' | 'day12' | 'missed' | 'day75';

export type TaskKey =
  | 'workout1'
  | 'workout2'
  | 'water'
  | 'read'
  | 'diet'
  | 'photo';

export interface TaskDef {
  key: TaskKey;
  label: string;
  sub: string;
  /** Camera tasks show an optional-proof affordance. */
  proof: boolean;
  /** Timed tasks: default countdown length in minutes. Absent = not timed. */
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

export interface Meal {
  id: string;
  text: string;
  timestamp: number;
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
  isSelf: boolean;
}

export type FeedKind = 'ping-in' | 'ping-out' | 'complete' | 'proof';

export interface FeedItem {
  id: string;
  kind: FeedKind;
  who: string;
  text: string;
  timestamp: number;
}

export interface LeaderRow {
  id: string;
  name: string;
  level: number;
  xp: number;
  isSelf: boolean;
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
  gallons: number;
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
