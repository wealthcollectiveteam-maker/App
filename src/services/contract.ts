import type {
  ChallengeLength,
  ActiveTimer,
  BlockedUser,
  CustomTask,
  DailyNutritionTotals,
  FeedItem,
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
  SquadSummary,
  TaskDef,
  TaskKey,
  TaskTarget,
  Tier,
  WorkoutLog,
  WorkoutLogInput,
} from '@/data/types';
import type { RemotePreferences, SyncedPreferences } from '@/lib/serverPrefs';

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
 *
 * WHAT THIS CONTRACT CANNOT CATCH — read before adding a method.
 * It types the app's DOMAIN shapes, and both implementations are checked
 * against it. What it cannot see is the network boundary, where server JSON
 * is ASSERTED into a domain type: `unwrap(...) as DaySnapshotRow` is a
 * promise tsc has no way to verify. That is how a frozen task snapshot —
 * which carries no label and no sub-line, because those are presentation —
 * reached the UI typed as TaskDef and crashed on `task.label.split`.
 *
 * So: server row shapes are declared separately from domain shapes
 * (SnapshotTask in taskProjection.ts, SquadStatusRow in api.ts) and are
 * converted by an explicit mapper. Assert the WIRE shape, never the domain
 * one, and let the mapper be the thing tsc checks.
 */
/**
 * Which optimistic write the server refused, so the store can put back
 * exactly what it changed for it.
 *
 * Named rather than generic because the store's optimistic update is not
 * only the row — completing a task also adds XP, sealing a day also
 * increments the streak — and only the caller knows what to undo. `other`
 * covers writes whose visible state the store mirrors straight from the
 * service (blocked list, task config), which it re-reads wholesale.
 */
export type RejectedWrite =
  // `day` is present when the write was aimed at YESTERDAY during the grace
  // window. The store has two days on screen and must put back the one it
  // actually changed; a rollback that guessed "today" would silently re-tick
  // a task on the wrong day.
  | { op: 'complete'; taskKey: TaskKey; day?: number }
  | { op: 'uncomplete'; taskKey: TaskKey; day?: number }
  | { op: 'seal'; day?: number }
  | { op: 'journal' }
  | { op: 'milestone' }
  | { op: 'meal' }
  // The optimistic feed row for a ping, by id. A ping's rollback is NOT
  // "re-read the mirror": the service mirror never held the row — the store
  // composes "pinged Sam" locally the instant the button is tapped, and the
  // send is a fire-and-forget RPC. Before this existed the rollback was
  // `() => {}`, so a refused ping (offline, out of quota, recipient no longer
  // in the squad) left the sender's feed permanently showing a ping the
  // recipient never received. `feedItemId` is that local row, so the undo
  // removes the one row rather than replacing a feed that has moved on.
  | { op: 'ping'; feedItemId: string }
  // A preference the server refused. The device keeps the setting — it saved
  // locally and IS honoured here — so this op deliberately restores nothing;
  // see the store's listener.
  | { op: 'prefs' }
  | { op: 'other' };

export interface IDataService {
  loadScenario(scenario: Scenario): ScenarioState;
  /**
   * Task completion. The server validates the key against ITS frozen
   * snapshot for the day being written to, so a modified client cannot
   * complete a task that day does not require. `at` is the display clock
   * label the mirror carries until the next hydrate — the authoritative
   * timestamp is the server's.
   *
   * `day` names the day being written to. Every caller in this client passes
   * it, today included (Phase 20): during the grace window two days are open,
   * and "today" is exactly the value that changes underneath a tap. It stays
   * optional in the type only for the mock. It is a REQUEST: the server
   * re-derives the open window from the challenge's own timezone and refuses
   * anything outside it, so naming a day that has closed gets an error, not a
   * write.
   */
  completeTask(taskKey: TaskKey, at: string, day?: number): void;
  uncompleteTask(taskKey: TaskKey, day?: number): void;
  /**
   * Seals a day — the server's current one unless `day` says otherwise. The
   * server re-counts completions against its own snapshot and recomputes
   * flame, so a client cannot seal an incomplete day or a closed one.
   */
  sealDay(day?: number): void;
  /**
   * Ping a squadmate by display name. The daily quota is enforced by the
   * server; the client's own count is a courtesy pre-check, never authority.
   *
   * `feedItemId` is the id of the optimistic "pinged Sam" row the caller has
   * already put in its own feed. It is carried so a refusal can name that row
   * back to the caller (RejectedWrite `ping`) and the row can be removed.
   * Without it a ping the server never accepted stays on screen for good.
   */
  sendPing(toName: string, message: string, feedItemId?: string): void;
  saveJournalEntry(day: number, text: string): JournalEntry;
  getJournal(): JournalEntry[];
  logMeal(text: string, at?: number): Meal;
  getMeals(day?: number): Meal[];
  getRecentMeals(): string[];
  addMilestone(title: string): Milestone;
  toggleMilestone(id: string, day: number): Milestone[];
  /**
   * The Day 75 figures, counted from the day snapshots and the completions
   * actually recorded — not from the tier's nominal totals. Async because it
   * is the one read in the app that spans the whole challenge rather than
   * today, so the mirror cannot answer it: it is opened once, on one screen,
   * at the end.
   */
  loadFinalResults(): Promise<FinalResults>;
  saveCompletionFeeling(feeling: string | null, text: string): void;
  /**
   * Display name + "why I started". The name is the squad-visible surface
   * (`profiles`); "why" is owner-only. A name kept in the store alone is a
   * name nobody else can see.
   */
  updateProfile(name: string, why: string): void;
  /**
   * PREFERENCES THAT BELONG TO THE ACCOUNT, NOT TO THE PHONE.
   *
   * Units, notification switches, health prompts and the weekly check-in card
   * were device-only: the columns to hold them have existed since 0003/0004
   * and nothing had ever written one. A friend moving to the native build
   * therefore arrived with their unit preference re-derived from the phone's
   * locale and every switch back at its default.
   *
   * Returns what the SERVER holds, MERGED OVER `current` — the caller's own
   * values, which stand in for any column that is absent or of the wrong
   * type. Null when there is no server to ask (the mock) or the account has
   * not been hydrated yet. `synced: false` on the result means those values
   * are DDL defaults rather than choices and must not be adopted over the
   * device's own either — see lib/serverPrefs.ts.
   */
  getRemotePreferences(current: SyncedPreferences): RemotePreferences | null;
  /**
   * Save preferences — ALL of them, every time. Optimistic like every other
   * write here: the setting has already been applied on the device, and a
   * refusal is reported rather than reverted, because a preference that saved
   * locally IS in force locally.
   *
   * The whole set rather than the one that changed, because the write may be
   * the INSERT that creates the row, and a column left out of an INSERT takes
   * a DDL default the app does not agree with — see lib/serverPrefs.ts.
   */
  savePreferences(prefs: SyncedPreferences): void;
  // Squad membership. Solo mode is squads === [] and squad === null; a user
  // may now hold several at once, and exactly one of them is ACTIVE.
  /**
   * These four are async, unlike most of this contract, and deliberately so.
   *
   * Everything else here is optimistic — mutate the mirror, fire the write,
   * roll back if the server refuses — because the cost of guessing wrong is
   * a flicker. Squad membership is not like that. The invite code is minted
   * by the server and cannot be guessed, which is exactly how a provisional
   * placeholder once ended up rendered (and copied) as six dots; and joining,
   * renaming and leaving all have refusals the client cannot predict — a
   * used code, a squad you do not administer. So they wait for the answer.
   */
  createSquad(name: string): Promise<Squad>;
  joinSquad(code: string): Promise<Squad>;
  renameSquad(squadId: string, name: string): Promise<void>;
  leaveSquad(squadId: string): Promise<void>;
  /** Switch which squad the tab is showing, loading its roster and feed. */
  setActiveSquad(squadId: string): Promise<void>;
  /**
   * Squad-derived view state, straight from the service. Used to re-read
   * after the server has reconciled something the client could not predict.
   *
   * `squads` is every membership (the switcher); `squad` is the active one
   * in full. They are separate because a roster per squad is a read per
   * squad, and the switcher only needs names.
   */
  getSquadState(): {
    squads: SquadSummary[];
    activeSquadId: string | null;
    squad: Squad | null;
    feed: FeedItem[];
    leaderboardWeek: LeaderRow[];
    leaderboardAllTime: LeaderRow[];
  };
  /**
   * Fires when the server changed mirror state no local write predicted —
   * an invite code being minted, a joined squad's roster arriving. Returns
   * an unsubscribe. Without this the store keeps whatever the optimistic
   * write guessed, forever: the invite code stayed a placeholder that could
   * be neither read out nor copied.
   */
  onRemoteChange(listener: () => void): () => void;
  /**
   * Fires when the server REFUSED a write and the mirror was rolled back.
   *
   * The mirror rolling back is not enough on its own: the screen reads the
   * Zustand store, not the mirror, and the store applied its own optimistic
   * update before the call. Without this the checkbox stayed ticked, the XP
   * stayed added and the streak stayed incremented for a write the server
   * never accepted — a toast was the only evidence, and it disappeared. The
   * one place this matters most is a task completed with no signal: the user
   * has to know it did not save while they are still standing there.
   *
   * Returns an unsubscribe. The mock never refuses anything, so it never
   * fires there.
   */
  onWriteRejected(listener: (write: RejectedWrite) => void): () => void;
  // UGC moderation + compliance
  reportContent(feedItemId: string, reason: ReportReason): void;
  /**
   * Block a squadmate. `id` is the feed row's author id where there is one;
   * the name is a fallback for locally-composed rows and for the mock. An
   * id that cannot be established is an error, not a silent no-op.
   */
  blockUser(user: { id?: string; name: string }): BlockedUser[];
  /** Unblock by id — display names are neither unique nor always readable. */
  unblockUser(id: string): BlockedUser[];
  getBlockedUsers(): BlockedUser[];
  /**
   * Guideline 5.1.1(v) account deletion. Resolves only once the server has
   * accepted the delete and the session has been ended; THROWS otherwise, so
   * no caller can report success for a delete that did not happen. Local
   * state is cleared on the same success, never before it.
   */
  deleteAccount(): Promise<void>;
  // Workout timer — client-owned state; only the finished session syncs.
  startTimer(timer: ActiveTimer): Promise<void>;
  pauseTimer(timer: ActiveTimer): Promise<void>;
  resumeTimer(timer: ActiveTimer): Promise<void>;
  cancelTimer(): Promise<void>;
  getActiveTimer(): Promise<ActiveTimer | null>;
  /**
   * Records real elapsed training seconds against the completed task.
   *
   * `day` is not optional in practice — every caller names it (Phase 20).
   * It stays optional in the type only so the mock and older callers keep
   * compiling; a caller that omits it is asking the server to choose, and
   * the server choosing is the whole defect this phase removes.
   */
  completeTimedTask(
    taskKey: TaskKey,
    elapsedSeconds: number,
    day?: number,
  ): Promise<void>;
  // Nutrition — optional enrichment on meals; owner-read-only when synced.
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
   * Correct or remove a past check-in.
   *
   * Both are async and both REJECT on refusal, unlike the optimistic writes
   * above. A weight typed in the wrong unit is corrected once, deliberately,
   * possibly weeks later — the one thing the screen must not do is show the
   * new number, revert a moment later, and leave the user unsure which value
   * is now in their history. So the mirror changes only after the server has
   * said yes. Resolving means it happened; rejecting means nothing changed.
   */
  updateMetricCheckin(
    id: string,
    weightKg: number | null,
    mood: number | null,
  ): Promise<void>;
  deleteMetricCheckin(id: string): Promise<void>;
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
  /**
   * Move the finish line to 30, 45 or 75 days.
   *
   * Async and server-owned, unlike every other task-config edit here,
   * because the answer the caller needs back is one only the server can
   * give: whether shortening the run ENDED it. A challenge on day 52 asked
   * to become 45 days long has no future left to run, and the app must be
   * able to say so afterwards as well as warn beforehand.
   *
   * It never rewrites history. No day snapshot is touched, re-scored or
   * deleted — the only thing that changes is where the run stops.
   */
  setChallengeDuration(days: ChallengeLength): Promise<{ completed: boolean }>;
  /**
   * 0018: reopen the missed day that ended the challenge this one replaced.
   * Async and server-owned like setChallengeDuration, and for the same
   * reason: it changes which challenge is alive, and the mirror must not
   * guess that. It changes no flame. The caller re-hydrates afterwards.
   */
  restoreMissedDay(): Promise<void>;
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

/**
 * Postgres / PostgREST codes worth classifying precisely. Everything else
 * falls through to the message heuristics in toBackendError().
 */
const ERROR_CODES: Record<string, BackendErrorKind> = {
  '42501': 'auth', // insufficient_privilege — a missing GRANT or an RLS refusal
  '28000': 'auth', // invalid_authorization_specification
  PGRST301: 'auth', // JWT expired / not verifiable
  '23505': 'conflict', // unique_violation
  '23503': 'conflict', // foreign_key_violation
  '23514': 'conflict', // check_violation
};

/** Readable text out of any of the shapes an error reaches us in. */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    // Supabase returns PostgrestError as a PLAIN OBJECT, not an Error, so
    // String(error) would read "[object Object]" and lose the whole reason.
    const e = error as { message?: unknown; details?: unknown; hint?: unknown };
    const parts = [e.message, e.details, e.hint].filter(
      (part): part is string => typeof part === 'string' && part.length > 0,
    );
    if (parts.length) return parts.join(' — ');
  }
  return String(error ?? 'unknown error');
}

/**
 * Normalise anything thrown or returned as `.error` into a typed
 * BackendError. Shared by the read layer (api.ts) and the write layer
 * (SupabaseDataService) so a failure is described the same way whichever
 * side it came from.
 */
export function toBackendError(error: unknown, context?: string): BackendError {
  // Already typed (e.g. requireUser()) — never re-classify and lose the kind.
  if (error instanceof BackendError) return error;

  const detail = messageOf(error);
  const message = context ? `${context}: ${detail}` : detail;
  const code =
    error &&
    typeof error === 'object' &&
    typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code
      : null;
  const byCode = code ? ERROR_CODES[code] : undefined;
  if (byCode) return new BackendError(byCode, message);

  if (/jwt|token|not authenticated|not signed in|session/i.test(detail)) {
    return new BackendError('auth', message);
  }
  if (/network|fetch|timeout|offline/i.test(detail)) {
    return new BackendError('network', message);
  }
  if (/duplicate|conflict|immutable|already/i.test(detail)) {
    return new BackendError('conflict', message);
  }
  return new BackendError('unknown', message);
}
