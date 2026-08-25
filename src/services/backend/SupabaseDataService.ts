import AsyncStorage from '@react-native-async-storage/async-storage';

import { CHALLENGE, XP } from '@/constants/challenge';
import { tierStandardTarget } from '@/constants/tiers';
import type {
  ChallengeLength,
  SquadSummary,
  ActiveTimer,
  BlockedUser,
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
import { normalizeInviteCode } from '@/lib/inviteCode';
import {
  api,
  type MySquadRow,
  type SquadStatusRow,
} from '@/services/backend/api';
import { AuthService } from '@/services/backend/AuthService';
import { getSupabase } from '@/services/backend/supabaseClient';
import {
  BackendError,
  toBackendError,
  type IDataService,
  type RejectedWrite,
} from '@/services/contract';
import {
  composeTaskSet,
  DEFAULT_ACTIVITY_TYPES,
  pendingTargetChanges,
  tallyFinalResults,
  taskFromSnapshot,
  tierStandards,
} from '@/services/taskProjection';

const TIMER_STORAGE_KEY = 'ranked.activeTimer.v1';
const SAVED_MEALS_KEY = 'ranked.savedMeals.v1';

let uid = 0;
const localId = (prefix: string) => `${prefix}-${Date.now()}-${uid++}`;

/** my_squads() / create_squad() row -> the shape the switcher renders. */
function toSummary(row: MySquadRow): SquadSummary {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    isCreator: row.is_creator,
    memberCount: row.member_count,
  };
}

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .map((p) => p[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'YO';

/** A mirror holding nobody: the pre-hydrate and post-sign-out state. */
function emptyState(): ScenarioState {
  return {
    tier: 'hard',
    day: 1,
    durationDays: CHALLENGE.defaultDays,
    flame: 0,
    bestFlame: 0,
    perfectDays: 0,
    xp: 0,
    missedDay: false,
    dayComplete: false,
    tasksDone: {},
    why: '',
    journal: [],
    meals: [],
    milestones: [],
    squad: null,
    feed: [],
    leaderboardWeek: [],
    leaderboardAllTime: [],
  };
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
  private state: ScenarioState = emptyState();

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
  private squads: SquadSummary[] = [];

  /** Surfaced to the UI so a rejected optimistic write is never silent. */
  onError: ((error: BackendError) => void) | null = null;

  /**
   * Listeners for state the SERVER decided and no local write could guess —
   * chiefly the invite code, which create_squad() mints. The optimistic
   * squad returned to the store is a placeholder; without a way to say "the
   * real one has landed", the store shows the placeholder for ever.
   */
  private remoteListeners = new Set<() => void>();

  onRemoteChange(listener: () => void): () => void {
    this.remoteListeners.add(listener);
    return () => {
      this.remoteListeners.delete(listener);
    };
  }

  private emitRemoteChange(): void {
    for (const listener of this.remoteListeners) {
      try {
        listener();
      } catch {
        // A bad listener must never break a server reconciliation.
      }
    }
  }

  /**
   * Listeners for a REFUSED write. Separate from remoteListeners on purpose:
   * a reconciliation replaces squad-derived view state wholesale, which would
   * also wipe the store's optimistic local feed rows. A rejection needs to
   * touch only what that one write changed.
   */
  private rejectionListeners = new Set<(write: RejectedWrite) => void>();

  onWriteRejected(listener: (write: RejectedWrite) => void): () => void {
    this.rejectionListeners.add(listener);
    return () => {
      this.rejectionListeners.delete(listener);
    };
  }

  private emitRejected(write: RejectedWrite): void {
    for (const listener of this.rejectionListeners) {
      try {
        listener(write);
      } catch {
        // A bad listener must never swallow the rollback itself.
      }
    }
  }

  getSquadState() {
    return {
      squads: this.squads,
      activeSquadId: this.squadId,
      squad: this.state.squad,
      feed: this.state.feed,
      leaderboardWeek: this.state.leaderboardWeek,
      leaderboardAllTime: this.state.leaderboardAllTime,
    };
  }

  private fail(error: unknown): void {
    const backendError = toBackendError(error);
    this.onError?.(backendError);
  }

  /**
   * Fire a write, roll the mirror back if the server rejects it.
   *
   * `run()` is invoked inside the try — it can throw SYNCHRONOUSLY (
   * requireUser() and requireChallenge() both do, and sb() throws when the
   * backend is unconfigured). Before, that exception escaped past the
   * promise chain entirely: no rollback, no fail(), and an uncaught throw in
   * whatever UI handler called the setter. Every failure now takes the same
   * road out — rollback, then a typed BackendError to onError.
   *
   * `op` names the write for the store's own rollback. It defaults to
   * `other` — the store re-reads the mirror wholesale for those — and the
   * writes with hand-rolled optimistic state (a ticked task, an added XP
   * total, an incremented streak) pass their own.
   */
  private write(
    run: () => PromiseLike<{ error: unknown } | void>,
    rollback: () => void,
    op: RejectedWrite = { op: 'other' },
  ): void {
    const undo = (error: unknown) => {
      rollback();
      this.fail(error);
      // AFTER the mirror is consistent again: the listener reads it.
      this.emitRejected(op);
    };
    let pending: PromiseLike<{ error: unknown } | void> | void;
    try {
      pending = run();
    } catch (error) {
      undo(error);
      return;
    }
    Promise.resolve(pending)
      .then((result) => {
        const error = result && 'error' in result ? result.error : null;
        if (error) undo(error);
      })
      .catch(undo);
  }

  /**
   * Client-minted id -> the id the server actually assigned.
   *
   * An optimistic row enters the mirror under a local id (`ml-…`, `m-…`,
   * `ct-…`) that the database has never seen. Sending that id back in an
   * UPDATE matches zero rows and — the dangerous part — returns NO error, so
   * nothing rolls back and the UI keeps showing a change the server never
   * received. Quick Add hit this every time: it logs a meal and attaches
   * nutrition in the same tick, so the nutrition went to an id that did not
   * exist yet.
   *
   * Entries are never removed: the store copies mirror arrays by value, so a
   * screen can still be holding the local id long after the mirror row was
   * re-keyed. The stored promise never rejects — it resolves to null on
   * failure — so an unawaited entry can't raise an unhandled rejection.
   */
  private serverIds = new Map<string, Promise<string | null>>();

  /** The id to send the server, waiting if the insert is still in flight. */
  private async resolveId(id: string): Promise<string> {
    const pending = this.serverIds.get(id);
    if (!pending) return id;
    return (await pending) ?? id;
  }

  /**
   * An optimistic INSERT whose server id is needed later. Same rollback
   * contract as write(), plus: the local id is registered synchronously
   * BEFORE returning, so a follow-up write issued in the same tick already
   * finds the in-flight resolution and queues behind it.
   */
  private insertRow(
    localIdValue: string,
    run: () => PromiseLike<{ data: unknown; error: unknown }>,
    adopt: (serverId: string) => void,
    rollback: () => void,
    op: RejectedWrite = { op: 'other' },
  ): void {
    const undo = (error: unknown) => {
      rollback();
      this.fail(error);
      this.emitRejected(op);
    };
    let pending: PromiseLike<{ data: unknown; error: unknown }>;
    try {
      pending = run();
    } catch (error) {
      undo(error);
      return;
    }
    const resolution = Promise.resolve(pending).then(
      ({ data, error }) => {
        if (error) {
          undo(error);
          return null;
        }
        // RPCs return the uuid directly; table inserts return { id }.
        const serverId =
          typeof data === 'string'
            ? data
            : ((data as { id?: string } | null)?.id ?? null);
        if (!serverId) {
          // The row WAS written — we just cannot address it until the next
          // hydrate. Rolling back here would delete a row that exists.
          this.fail(
            new BackendError('unknown', 'server accepted the row but returned no id'),
          );
          return null;
        }
        adopt(serverId);
        return serverId;
      },
      (error: unknown) => {
        undo(error);
        return null;
      },
    );
    this.serverIds.set(localIdValue, resolution);
  }

  // ===================== session bootstrap (not IDataService) =============

  /**
   * Loads everything the app renders for the signed-in user. Called once
   * after sign-in and on cold launch with a restored session, BEFORE the
   * first render reads the mirror — hence no empty-state flash.
   *
   * TWO CLASSES OF READ, and the difference is the whole point:
   *
   * ESSENTIAL — the challenge, today's frozen snapshot, its completions and
   * its config. Without these there is no day to show, and the caller's
   * session error screen with Retry is the honest answer. These throw.
   *
   * OPTIONAL — journal, meals, milestones, check-ins, workout logs, squad
   * roster, feed, blocked list, saved meals. Each is one surface. A failure
   * leaves that surface as it was and is collected into a single quiet
   * notice at the end; it never stops the rest of the app from loading. On
   * day 12 of a real challenge, one flaky read must not read as "your
   * challenge is gone" — which is exactly what the blocked-users read did.
   */
  async hydrate(userId: string): Promise<void> {
    this.userId = userId;
    const failed: string[] = [];

    // Started first so they run alongside the essential reads. optional()
    // attaches its catch synchronously, so an essential failure below can
    // never leave one of these as an unhandled rejection.
    const personal = Promise.all([
      this.optional('profile', api.getProfile(userId), failed),
      this.optional('your why', api.getProfilePrivate(userId), failed),
      this.optional('squads', api.mySquads(), failed),
      this.optional('journal', api.listJournal(userId), failed),
      this.optional('meals', api.listMeals(userId), failed),
      this.optional('milestones', api.listMilestones(userId), failed),
      this.optional('check-ins', api.listMetricCheckins(userId), failed),
      this.optional('workouts', api.listWorkoutLogs(userId), failed),
      this.optional('blocked list', api.listBlockedUsers(userId), failed),
    ]);

    // ---- ESSENTIAL ----
    const day = await api.getOrFreezeToday();
    this.challengeId = day?.challenge_id ?? null;
    this.state.day = day?.day ?? 1;
    this.state.dayComplete = !!day?.sealed_at;

    const [completions, config] = await Promise.all([
      this.challengeId
        ? api.listTodayCompletions(this.challengeId, this.state.day)
        : Promise.resolve({} as Partial<Record<TaskKey, string>>),
      this.challengeId
        ? api.getChallengeConfig(this.challengeId, this.state.day)
        : Promise.resolve(null),
    ]);

    this.state.tasksDone = completions;
    this.state.tier = config?.tier ?? 'hard';
    this.state.durationDays = config?.durationDays ?? CHALLENGE.defaultDays;
    this.state.flame = config?.flame ?? 0;
    this.state.bestFlame = config?.bestFlame ?? 0;
    this.state.perfectDays = config?.perfectDays ?? 0;
    // Server-owned. The penalty that set it was applied at local midnight by
    // the scheduled evaluator, which the user was almost certainly not
    // present for — so this is the only thing that can tell them.
    this.state.missedDay = config?.missedDay ?? false;
    this.customTasks = config?.customTasks ?? [];
    this.targetOverrides = config?.targetOverrides ?? {};
    this.overridesAtDayStart = { ...this.targetOverrides };
    this.pendingTier = config?.pendingTier ?? null;

    // The snapshot is data; the UI needs a TaskDef. Mapped after the config
    // lands because a custom task's sub-line lives on custom_tasks, not in
    // the frozen snapshot.
    this.daySnapshots = day
      ? {
          [day.day]: day.task_snapshot.map((t) =>
            taskFromSnapshot(t, this.customTasks, this.state.tier),
          ),
        }
      : {};

    // ---- OPTIONAL ----
    // Each assignment is guarded: a read that failed leaves the mirror's
    // existing value alone rather than overwriting real data with empty.
    // (profile and profile_private also answer null when the row simply
    // does not exist yet; both cases want the same "change nothing".)
    const [profile, priv, squadStatus, journal, meals, milestones, metrics, logs, blocked] =
      await personal;

    if (profile) this.state.xp = profile.xp;
    if (priv) this.state.why = typeof priv.why === 'string' ? priv.why : '';
    if (journal) this.state.journal = journal;
    if (meals) this.state.meals = meals;
    if (milestones) this.state.milestones = milestones;
    if (metrics) this.metricCheckins = metrics;
    if (logs) this.workoutLogs = logs;
    if (blocked) this.blocked = blocked;

    if (squadStatus === null) {
      // The list did not load. That is not the same as having no squad, so
      // nothing here is cleared — the squad tab keeps its empty state.
    } else if (squadStatus.length) {
      this.squads = squadStatus.map(toSummary);
      // Which squad to open on. A remembered choice only counts if the user
      // is still IN it — they may have left it on another device, and
      // opening onto a squad they are no longer a member of would render an
      // empty roster with no way to explain itself.
      const remembered = await this.readRememberedSquad(userId);
      const active =
        this.squads.find((q) => q.id === remembered) ?? this.squads[0];
      await this.loadSquad(active, userId, failed);
    } else {
      // Solo is a first-class state, not a degraded one.
      this.squadId = null;
      this.state.squad = null;
      this.state.feed = [];
      this.state.leaderboardWeek = [];
      this.state.leaderboardAllTime = [];
    }

    const savedMeals = await this.optional(
      'saved meals',
      this.readSavedMeals(),
      failed,
    );
    if (savedMeals) this.savedMeals = savedMeals;

    this.reportDegraded(failed);
  }

  /**
   * Re-read the day the SERVER thinks it is, plus everything keyed to it.
   *
   * Two things need this and neither one is exotic. The local date rolls over
   * while the app is simply left open — nothing else in the app ever asks the
   * server for the day again, so an app open at midnight kept showing
   * yesterday's number and yesterday's ticked tasks until it was force-quit.
   * And a session that came back from no signal had no way to catch up on
   * what it missed short of a relaunch.
   *
   * Throws on failure, and the caller's job is to do NOTHING with that: the
   * mirror keeps whatever it already had. A refresh that degraded to
   * `day = 1, flame = 0` on a flaky connection would tell a user on day 40
   * that their streak was gone, which is the one thing this must never do.
   */
  async refreshToday(): Promise<void> {
    if (!this.userId) return;
    const day = await api.getOrFreezeToday();
    if (!day) return;
    const [completions, config, profile] = await Promise.all([
      api.listTodayCompletions(day.challenge_id, day.day),
      api.getChallengeConfig(day.challenge_id, day.day),
      api.getProfile(this.userId),
    ]);

    this.challengeId = day.challenge_id;
    this.state.day = day.day;
    this.state.dayComplete = !!day.sealed_at;
    this.state.tasksDone = completions;
    this.state.tier = config?.tier ?? this.state.tier;
    this.state.durationDays = config?.durationDays ?? this.state.durationDays;
    this.state.flame = config?.flame ?? this.state.flame;
    this.state.bestFlame = config?.bestFlame ?? this.state.bestFlame;
    this.state.perfectDays = config?.perfectDays ?? this.state.perfectDays;
    this.state.missedDay = config?.missedDay ?? this.state.missedDay;
    this.customTasks = config?.customTasks ?? this.customTasks;
    this.targetOverrides = config?.targetOverrides ?? this.targetOverrides;
    this.overridesAtDayStart = { ...this.targetOverrides };
    this.pendingTier = config?.pendingTier ?? null;
    if (profile) this.state.xp = profile.xp;

    // Only today's snapshot is replaced. Past days stay as they were frozen.
    this.daySnapshots[day.day] = day.task_snapshot.map((t) =>
      taskFromSnapshot(t, this.customTasks, this.state.tier),
    );
  }

  /**
   * An optional read. Failure costs one surface, not the session.
   *
   * NOT silence — that is the D7 bug, where a failed read was
   * indistinguishable from an empty one. The reason goes to the console in
   * full, and the label joins a single user-facing notice.
   */
  private async optional<T>(
    label: string,
    read: Promise<T>,
    failed: string[],
  ): Promise<T | null> {
    try {
      return await read;
    } catch (error) {
      console.warn(`[hydrate:optional] ${label}: ${toBackendError(error).message}`);
      failed.push(label);
      return null;
    }
  }

  /** One quiet line for everything that did not load, or nothing at all. */
  private reportDegraded(failed: string[]): void {
    if (failed.length === 0) return;
    const detail = `Couldn’t load: ${failed.join(', ')}`;
    // Over ~70 characters the toast layer replaces the text with a generic
    // line, so a long list gets its own short one instead.
    this.onError?.(
      new BackendError(
        'network',
        detail.length <= 70 ? detail : 'Some of your data didn’t load.',
      ),
    );
  }

  /**
   * Sign-out: forget the user completely.
   *
   * The mirror answers every read in the app, so leaving it populated after
   * a sign-out would show the previous account's day, streak, journal and
   * meals to whoever signs in next on this device. The two AsyncStorage keys
   * this service owns hold the same kind of data (a running timer, saved
   * meals) and go with it.
   */
  reset(): void {
    this.userId = null;
    this.challengeId = null;
    this.squadId = null;
    this.state = emptyState();
    this.metricCheckins = [];
    this.workoutLogs = [];
    this.savedMeals = [];
    this.blocked = [];
    this.customTasks = [];
    this.daySnapshots = {};
    this.targetOverrides = {};
    this.overridesAtDayStart = {};
    this.pendingTier = null;
    this.serverIds.clear();
    AsyncStorage.multiRemove([TIMER_STORAGE_KEY, SAVED_MEALS_KEY]).catch(() => {});
  }

  /**
   * When the roster RPC comes back empty but the squad exists — it
   * inner-joins profiles, so one missing profile row empties it — take at
   * least the name and the invite code from the squad row itself. Anything
   * rather than leaving the user holding a squad with no code to share.
   */
  private fillSquadFromSummary(summary: SquadSummary): void {
    this.squadId = summary.id;
    this.state.squad = {
      id: summary.id,
      name: summary.name,
      code: summary.code,
      isCreator: summary.isCreator,
      streak: 0,
      members: [],
    };
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
      // Per member, from get_squad_status — a squadmate on Soft has four
      // tasks whatever tier the viewer runs.
      tasksToday: r.tasks_today,
      // Also per member: they choose their own length and may change it.
      day: r.day,
      durationDays: r.duration_days,
      isSelf: r.user_id === this.userId,
    }));
    this.state.squad = {
      id: first.squad_id,
      name: first.squad_name,
      code: first.invite_code,
      isCreator:
        this.squads.find((q) => q.id === first.squad_id)?.isCreator ?? false,
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
        .getSquadStatus(squadId)
        .then((rows) => {
          if (rows?.length) this.applySquadStatus(rows);
          return api.listFeed(squadId, this.userId);
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

  // ===================== completion / seal / ping ========================
  // All four go through the same optimistic path as every other write:
  // mutate the mirror, fire the RPC, roll back if the server refuses. The
  // SERVER decides what "today" is and which keys today's frozen snapshot
  // allows — complete_task() rejects a key that isn't in it, and seal_day()
  // re-counts completions itself rather than trusting a client's tally.

  completeTask(taskKey: TaskKey, at: string): void {
    const previous = { ...this.state.tasksDone };
    this.state.tasksDone = { ...previous, [taskKey]: at };
    this.write(
      () => api.completeTask(taskKey),
      () => {
        this.state.tasksDone = previous;
      },
      { op: 'complete', taskKey },
    );
  }

  uncompleteTask(taskKey: TaskKey): void {
    const previous = { ...this.state.tasksDone };
    const next = { ...previous };
    delete next[taskKey];
    this.state.tasksDone = next;
    this.write(
      () => api.uncompleteTask(taskKey),
      () => {
        this.state.tasksDone = previous;
      },
      { op: 'uncomplete', taskKey },
    );
  }

  sealDay(): void {
    const previous = this.state.dayComplete;
    this.state.dayComplete = true;
    this.write(
      () => api.sealDay(),
      () => {
        this.state.dayComplete = previous;
      },
      { op: 'seal' },
    );
  }

  /**
   * The UI pings by display name; `pings` keys by user id, so the squad
   * roster resolves one to the other — the same bridge blockUser() uses.
   * The daily quota is the server's to enforce (send_ping raises when it is
   * spent); a rejection surfaces through onError like any other write.
   */
  sendPing(toName: string, message: string): void {
    const id = this.resolveMemberId(toName);
    if (!id) {
      this.fail(new BackendError('unknown', `No squadmate named ${toName}`));
      return;
    }
    const squadId = this.squadId;
    if (!squadId) {
      this.fail(new BackendError('unknown', 'No squad to ping into'));
      return;
    }
    this.write(
      () => api.sendPing(id, message, squadId),
      () => {},
    );
  }

  getJournal(): JournalEntry[] {
    return this.state.journal;
  }

  /**
   * TODAY's log by default. The mirror holds every meal of the challenge —
   * getRecentMeals() needs the history — but the Track screen and the daily
   * totals mean today, and against the mock (whose whole dataset is one
   * day) the difference never showed.
   */
  getMeals(day: number = this.state.day): Meal[] {
    return this.state.meals.filter((m) => m.day === day);
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

  /**
   * What this user actually did over the whole challenge.
   *
   * Was `75 × the tier standard`: the totals of a flawless run, shown to
   * everyone whatever they had done. Now every day's own frozen snapshot
   * supplies the target that day was worth, and only tasks with a completion
   * row against them count.
   */
  async loadFinalResults(): Promise<FinalResults> {
    const waterUnit = tierStandardTarget(this.state.tier, 'water')?.unit ?? 'litres';
    if (!this.challengeId) {
      return {
        workouts: 0,
        pagesRead: 0,
        water: { value: 0, unit: waterUnit },
      };
    }
    const { days, completions } = await api.listChallengeHistory(this.challengeId);
    const tally = tallyFinalResults(
      days.map((d) => ({
        day: d.day,
        tasks: d.task_snapshot.map((t) => ({ key: t.key, target: t.target })),
      })),
      completions.map((c) => ({ day: c.day, taskKey: c.task_key as TaskKey })),
      waterUnit,
    );
    return {
      ...tally,
    };
  }

  getBlockedUsers(): BlockedUser[] {
    return this.blocked;
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
      { op: 'journal' },
    );
    return entry;
  }

  logMeal(text: string, at: number = Date.now()): Meal {
    const carried = this.state.meals.find(
      (m) => m.text.trim().toLowerCase() === text.trim().toLowerCase() && m.nutrition,
    );
    const meal: Meal = {
      id: localId('ml'),
      day: this.state.day,
      text,
      timestamp: at,
      nutrition: carried?.nutrition ? { ...carried.nutrition } : null,
    };
    const previous = this.state.meals;
    this.state.meals = [meal, ...previous];
    this.insertRow(
      meal.id,
      () =>
        api.logMeal(this.requireUser(), this.state.day, text, meal.nutrition ?? null),
      (serverId) => {
        this.state.meals = this.state.meals.map((m) =>
          m.id === meal.id ? { ...m, id: serverId } : m,
        );
      },
      () => {
        this.state.meals = previous;
      },
      { op: 'meal' },
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
      () => this.resolveId(mealId).then((id) => api.setMealNutrition(id, nutrition)),
      () => {
        this.state.meals = previous;
      },
      { op: 'meal' },
    );
    return this.getMeals();
  }

  removeNutrition(mealId: string): Meal[] {
    const previous = this.state.meals;
    this.state.meals = previous.map((m) =>
      m.id === mealId ? { ...m, nutrition: null } : m,
    );
    this.write(
      () => this.resolveId(mealId).then((id) => api.setMealNutrition(id, null)),
      () => {
        this.state.meals = previous;
      },
      { op: 'meal' },
    );
    return this.getMeals();
  }

  addMilestone(title: string): Milestone {
    const milestone: Milestone = { id: localId('m'), title, done: false };
    const previous = this.state.milestones;
    this.state.milestones = [...previous, milestone];
    this.insertRow(
      milestone.id,
      () => api.addMilestone(this.requireUser(), title),
      (serverId) => {
        this.state.milestones = this.state.milestones.map((m) =>
          m.id === milestone.id ? { ...m, id: serverId } : m,
        );
      },
      () => {
        this.state.milestones = previous;
      },
      { op: 'milestone' },
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
      () =>
        this.resolveId(id).then((serverId) =>
          api.setMilestoneDone(serverId, !target?.done, day),
        ),
      () => {
        this.state.milestones = previous;
      },
      { op: 'milestone' },
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

  /**
   * Display name + "why I started". The name lives on `profiles`, which is
   * the squad-visible surface — a name changed only in the store is a name
   * no squadmate ever sees. "Why" stays on profile_private (owner-only RLS).
   */
  updateProfile(name: string, why: string): void {
    const previous = this.state.why;
    this.state.why = why;
    const trimmed = name.trim() || 'You';
    this.write(
      () => api.upsertProfile(this.requireUser(), trimmed),
      () => {},
    );
    this.write(
      () => api.setWhy(this.requireUser(), why),
      () => {
        this.state.why = previous;
      },
    );
  }

  // ===================== squad ===========================================

  /**
   * WHERE THE SWITCHER'S SELECTION LIVES.
   *
   * AsyncStorage, keyed by user id. Per-user rather than one global key
   * because two accounts on one device must not inherit each other's
   * choice — signing in as somebody else would otherwise open onto a squad
   * this account may not even be in.
   *
   * It is a display preference, not state the server should own: which of
   * your squads you were last looking at is not a fact about the squad, and
   * round-tripping it would make switching tabs a write. Losing it is
   * harmless — hydrate() falls back to the first squad.
   */
  private static rememberKey(userId: string): string {
    return `ranked.activeSquad.${userId}`;
  }

  private async readRememberedSquad(userId: string): Promise<string | null> {
    try {
      return await AsyncStorage.getItem(SupabaseDataService.rememberKey(userId));
    } catch {
      return null;
    }
  }

  private rememberSquad(squadId: string | null): void {
    const userId = this.userId;
    if (!userId) return;
    const key = SupabaseDataService.rememberKey(userId);
    const write = squadId
      ? AsyncStorage.setItem(key, squadId)
      : AsyncStorage.removeItem(key);
    write.catch(() => {});
  }

  /** Load one squad's roster and feed, and make it the active one. */
  private async loadSquad(
    summary: SquadSummary,
    userId: string,
    failed?: string[],
  ): Promise<void> {
    this.squadId = summary.id;
    this.rememberSquad(summary.id);
    // Filled from the summary first so the tab has a name and a code even if
    // the roster read fails or comes back empty — get_squad_status inner-joins
    // profiles, and one missing profile row empties it.
    this.fillSquadFromSummary(summary);

    const rows = failed
      ? await this.optional('squad', api.getSquadStatus(summary.id), failed)
      : await api.getSquadStatus(summary.id).catch(() => null);
    if (rows?.length) this.applySquadStatus(rows);

    const feed = failed
      ? await this.optional('squad feed', api.listFeed(summary.id, userId), failed)
      : await api.listFeed(summary.id, userId).catch(() => null);
    this.state.feed = feed ?? [];
  }

  private clearSquadState(): void {
    this.squadId = null;
    this.state.squad = null;
    this.state.feed = [];
    this.state.leaderboardWeek = [];
    this.state.leaderboardAllTime = [];
  }

  async createSquad(name: string): Promise<Squad> {
    const row = await api.createSquad(name);
    const summary = toSummary(row);
    this.squads = [...this.squads, summary];
    await this.loadSquad(summary, this.requireUser());
    this.emitRemoteChange();
    // Non-null: loadSquad always fills it from the summary at minimum.
    return this.state.squad as Squad;
  }

  async joinSquad(code: string): Promise<Squad> {
    const row = await api.joinSquad(normalizeInviteCode(code));
    const summary = toSummary(row);
    this.squads = [...this.squads, summary];
    await this.loadSquad(summary, this.requireUser());
    this.emitRemoteChange();
    return this.state.squad as Squad;
  }

  async renameSquad(squadId: string, name: string): Promise<void> {
    const row = await api.renameSquad(squadId, name);
    this.squads = this.squads.map((q) =>
      q.id === squadId ? { ...q, name: row.name } : q,
    );
    if (this.state.squad?.id === squadId) {
      this.state.squad = { ...this.state.squad, name: row.name };
    }
    this.emitRemoteChange();
  }

  async leaveSquad(squadId: string): Promise<void> {
    const { error } = await api.leaveSquad(squadId);
    if (error) throw toBackendError(error, 'leave squad');
    this.squads = this.squads.filter((q) => q.id !== squadId);
    if (this.squadId !== squadId) {
      this.emitRemoteChange();
      return;
    }
    // The squad that was on screen is the one that just went. Fall through to
    // whichever remains, or to solo — which is a first-class state, not a
    // degraded one.
    this.clearSquadState();
    const next = this.squads[0];
    if (next) {
      await this.loadSquad(next, this.requireUser());
    } else {
      this.rememberSquad(null);
    }
    this.emitRemoteChange();
  }

  async setActiveSquad(squadId: string): Promise<void> {
    if (squadId === this.squadId) return;
    const summary = this.squads.find((q) => q.id === squadId);
    if (!summary) return;
    await this.loadSquad(summary, this.requireUser());
    this.emitRemoteChange();
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

  /**
   * The feed row's author id where there is one, falling back to the roster
   * lookup for a row this device composed itself. The name alone was not
   * enough: a squadmate whose profile RLS will not resolve renders as
   * "Squadmate", and resolveMemberId() answered null for them — so blocking
   * the one person you most wanted to block failed with "No squadmate named
   * Squadmate".
   */
  blockUser(user: { id?: string; name: string }): BlockedUser[] {
    const id = user.id ?? this.resolveMemberId(user.name);
    if (!id) {
      this.fail(new BackendError('unknown', `No squadmate named ${user.name}`));
      return this.getBlockedUsers();
    }
    const previous = this.blocked;
    if (!previous.some((b) => b.id === id)) {
      this.blocked = [...previous, { id, name: user.name }];
    }
    this.write(
      () => api.blockUser(this.requireUser(), id),
      () => {
        this.blocked = previous;
      },
    );
    return this.getBlockedUsers();
  }

  unblockUser(id: string): BlockedUser[] {
    const previous = this.blocked;
    if (!previous.some((b) => b.id === id)) return this.getBlockedUsers();
    this.blocked = previous.filter((b) => b.id !== id);
    this.write(
      () => api.unblockUser(this.requireUser(), id),
      () => {
        this.blocked = previous;
      },
    );
    return this.getBlockedUsers();
  }

  /**
   * Deletes the account's rows, then ends the session.
   *
   * NOT optimistic, unlike every other write here, and deliberately so. It
   * used to wipe the local mirror first and fire the RPC into the background:
   * a refused delete — offline, expired JWT — left the user signed in and
   * looking at a blank day 1 while all their data sat untouched on the
   * server, under a toast that had already said "Account deleted". Nothing
   * local is cleared until the server has accepted it.
   *
   * D5: delete_account() deletes ROWS. It cannot delete the auth.users record
   * (that needs the service role), and it does not end the session, so the
   * sign-out below is what stops the user holding a valid JWT for a profile
   * that no longer exists — every subsequent RPC would either fail or quietly
   * recreate state for a deleted account. It runs only AFTER the RPC, which
   * needs that JWT.
   *
   * api.deleteAccount() is not an async function, so sb() throwing when the
   * backend is unconfigured throws SYNCHRONOUSLY — hence the await on a
   * wrapped call rather than a bare one.
   */
  async deleteAccount(): Promise<void> {
    if (!this.userId) return;
    const result = await Promise.resolve().then(() => api.deleteAccount());
    if (result.error) throw toBackendError(result.error, 'delete account');
    this.reset();
    await AuthService.signOut();
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
    const previous = { ...this.state.tasksDone };
    // Same clock format hydrate() reads back out of task_completions.
    const at = new Date().toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });
    this.state.tasksDone = { ...previous, [taskKey]: at };
    const { error } = await api.completeTask(taskKey, Math.round(elapsedSeconds));
    if (error) {
      this.state.tasksDone = previous;
      // The timer's caller swallows this rejection, so without fail() a
      // refused completion would be silent on the one path that carries the
      // duration. The store ticked the task off before the timer screen even
      // dismissed, so it has to hear about the refusal too.
      this.fail(error);
      this.emitRejected({ op: 'complete', taskKey });
      throw toBackendError(error);
    }
  }

  // ===================== nutrition (external API) ========================

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
    // add_custom_task() returns the uuid it assigned; without adopting it,
    // the very next edit or removal of this task addressed an id the server
    // does not have and came back "custom task not found for this user".
    this.insertRow(
      task.id,
      () => api.addCustomTask(input),
      (serverId) => {
        this.customTasks = this.customTasks.map((c) =>
          c.id === task.id ? { ...c, id: serverId } : c,
        );
      },
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
        this.resolveId(id).then((serverId) =>
          api.updateCustomTask(serverId, {
            name: updated?.name ?? '',
            sub: updated?.sub ?? '',
            proof: !!updated?.proof,
            timerMinutes: updated?.timerMinutes,
          }),
        ),
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
      () => this.resolveId(id).then((serverId) => api.removeCustomTask(serverId)),
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

  /**
   * Not optimistic, unlike every other write in this class.
   *
   * The others mutate the mirror first and roll back if the server refuses,
   * because the user needs the tap to feel instant and the only cost of
   * being wrong is a brief flicker. This one is different: its answer is
   * whether the CHALLENGE JUST ENDED, and guessing that wrong would put a
   * finished run back on screen as a live one, or end one that is still
   * going. So it awaits the server and mirrors what actually happened.
   */
  async setChallengeDuration(
    days: ChallengeLength,
  ): Promise<{ completed: boolean }> {
    if (!this.challengeId) throw new Error('no challenge');
    const result = await api.setChallengeDuration(this.challengeId, days);
    this.state.durationDays = days;
    return { completed: result.completed };
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
      () =>
        Promise.all(reinstated.map((c) => this.resolveId(c.id))).then((ids) =>
          api.undoPendingChanges(ids, this.overridesAtDayStart),
        ),
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
        this.daySnapshots[day.day] = day.task_snapshot.map((t) =>
          taskFromSnapshot(t, this.customTasks, tier),
        );
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
    // Mirrors set_target_override(): back to the tier standard clears the
    // override rather than storing a redundant row.
    const standard = tierStandardTarget(currentTier, taskKey);
    const previous = { ...this.targetOverrides };
    if (value === standard?.value) delete this.targetOverrides[taskKey];
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

}
