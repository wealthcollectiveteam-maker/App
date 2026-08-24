import type {
  ChallengeLength,
  CustomTask,
  FeedItem,
  FeedKind,
  JournalEntry,
  Meal,
  MealNutrition,
  MetricCheckin,
  Milestone,
  TaskKey,
  Tier,
  WorkoutLog,
} from '@/data/types';
import { CHALLENGE } from '@/constants/challenge';
import { toBackendError } from '@/services/contract';
import type { SnapshotTask } from '@/services/taskProjection';

import { getSupabase } from './supabaseClient';

/**
 * Typed wrappers over the SQL contract in supabase/migrations.
 *
 * Server-owned state (day snapshots, completions, tier/target/custom-task
 * edits, squad membership, pings) flows EXCLUSIVELY through RPCs — the
 * database revokes direct writes, so a modified client cannot cheat. Direct
 * table access is used only for owner-scoped personal data, where the
 * owner-only RLS policy is the whole rule.
 *
 * Every function here returns raw Supabase results or already-mapped domain
 * objects; error handling and optimism live in SupabaseDataService.
 */

function sb() {
  const client = getSupabase();
  if (!client) throw new Error('Backend not configured');
  return client;
}

/**
 * Unwrap a Supabase read.
 *
 * Every read helper here used to destructure `.data` and drop `.error`, so a
 * read that FAILED was indistinguishable from one that returned nothing: a
 * raised `no challenge for user` came back as `null` and hydrate quietly
 * degraded to "day 1, empty task list" with no signal anywhere. Reads now
 * throw a typed BackendError, and the caller decides whether that is fatal.
 * hydrate() makes that call per read: the challenge and today's snapshot are
 * essential, while a journal or a squad roster that fails costs one surface
 * and is reported, not fatal.
 */
function unwrap<T>(
  result: { data: T; error: unknown },
  context: string,
): T {
  if (result.error) throw toBackendError(result.error, context);
  return result.data;
}

/**
 * Display names for a set of user ids.
 *
 * NOT a PostgREST embed. Every user-identifying column in this schema —
 * feed_items.author, blocked_users.blocked, squad_members.user_id, pings —
 * has its foreign key against `auth.users`, never `public.profiles`. That
 * FK exists (blocked_users_blocked_fkey and friends), but it points into the
 * auth schema, which PostgREST does not expose, so there is no relationship
 * it can traverse to reach profiles and no hint that makes one appear. The
 * names come from a second, explicit read instead.
 *
 * RLS still decides what is readable: profiles_select allows yourself and
 * current squadmates only. An id that resolves to nothing is not an error —
 * it is someone you blocked and then stopped sharing a squad with — so the
 * caller supplies its own fallback label.
 */
async function namesByUserId(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const data = unwrap(
    await sb().from('profiles').select('id, name').in('id', unique),
    'load names',
  );
  return new Map(
    ((data ?? []) as { id: string; name: string }[]).map((r) => [r.id, r.name]),
  );
}

export interface DaySnapshotRow {
  id: string;
  challenge_id: string;
  day: number;
  /**
   * SnapshotTask, NOT TaskDef. compose_task_set() stores data only — no
   * label, no sub, no timer length. Typing it as TaskDef (which it was) is
   * what let a snapshot reach the UI unmapped: tsc had been told the server
   * already spoke the app's shape. taskFromSnapshot() is the only bridge.
   */
  task_snapshot: SnapshotTask[];
  sealed_at: string | null;
}

export interface SquadStatusRow {
  squad_id: string;
  squad_name: string;
  invite_code: string;
  user_id: string;
  name: string;
  xp: number;
  done_today: number;
  tasks_today: number;
  tier_label: string;
  flame: number;
  /** This member's own day and challenge length — see SquadMember. */
  day: number;
  duration_days: number;
}

/** One row of my_squads(): what the switcher needs, per squad. */
export interface MySquadRow {
  id: string;
  name: string;
  code: string;
  is_creator: boolean;
  member_count: number;
}

export interface ChallengeConfig {
  tier: Tier;
  /** challenges.duration_days — 30, 45 or 75. */
  durationDays: ChallengeLength;
  flame: number;
  /** Longest streak so far — challenges.best_flame. Drives the badges. */
  bestFlame: number;
  /** Days sealed complete. The other half of the You screen's stats. */
  perfectDays: number;
  /**
   * Whether a missed day is current news for THIS challenge.
   *
   * Server-owned, and derived rather than stored on the client: the
   * evaluator writes challenges.missed_notice_day when it applies a penalty
   * (the day after the miss for Medium/Soft, day 1 of the replacement for
   * Hard), and this is true only while that equals today. It therefore
   * clears itself at the next rollover with no second piece of client state
   * to fall out of step — and, critically, it is true after a penalty the
   * user was not present for. The banner used to be set only by a local
   * action, so a streak broken at midnight while the app was closed showed
   * nothing at all.
   */
  missedDay: boolean;
  customTasks: CustomTask[];
  targetOverrides: Partial<Record<TaskKey, number>>;
  pendingTier: Tier | null;
}

/**
 * feed_items.kind -> FeedKind. The check constraint allows
 * complete/proof/change/ping/miss; the app has no 'ping', only the two
 * directions of one. Anything unrecognised becomes 'change', the neutral
 * kind, rather than a value no renderer has a case for.
 */
function toFeedKind(kind: string, mine: boolean): FeedKind {
  switch (kind) {
    case 'complete':
    case 'proof':
    case 'change':
    case 'miss':
      return kind;
    case 'ping':
      return mine ? 'ping-out' : 'ping-in';
    default:
      return 'change';
  }
}

export const BackendApi = {
  // ---- challenge / day snapshots (server-owned) ----
  createChallenge: async (
    baseTier: Tier,
    startDate: string,
    timezone: string,
    durationDays: ChallengeLength,
  ) =>
    unwrap(
      await sb().rpc('create_challenge', {
        p_base_tier: baseTier,
        p_start_date: startDate,
        p_timezone: timezone,
        p_duration_days: durationDays,
      }),
      'create challenge',
    ) as string,

  /**
   * A custom task that is part of day 1 rather than an edit to it.
   *
   * MUST be called after createChallenge and BEFORE getOrFreezeToday: the
   * server refuses once challenge_days holds a day 1, because at that point
   * the snapshot is frozen and "edits start tomorrow" applies again. The
   * ordering in createFirstChallenge() is what makes this the one call that
   * can land in day 1.
   */
  addSetupCustomTask: async (name: string, timerMinutes?: number) =>
    unwrap(
      await sb().rpc('add_setup_custom_task', {
        p_name: name,
        p_timer_minutes: timerMinutes ?? null,
      }),
      'add setup task',
    ) as string,

  /**
   * Move the finish line. Returns whether doing so ENDED the challenge —
   * which it does whenever the new length is already behind the current day.
   */
  setChallengeDuration: async (
    challengeId: string,
    duration: ChallengeLength,
  ) => {
    const rows = unwrap(
      await sb().rpc('set_challenge_duration', {
        p_challenge_id: challengeId,
        p_duration: duration,
      }),
      'set challenge duration',
    ) as { completed: boolean; ended_on_day: number | null }[] | null;
    return rows?.[0] ?? { completed: false, ended_on_day: null };
  },

  /**
   * Freezes (or returns) the server's snapshot for the server's current day.
   * Raises `no challenge for user` when there is no challenge row yet — that
   * now reaches the caller instead of collapsing into `null`.
   */
  getOrFreezeToday: async () =>
    unwrap(await sb().rpc('get_or_freeze_today'), 'freeze today') as
      | DaySnapshotRow
      | null,

  completeTask: (taskKey: TaskKey, durationSeconds?: number) =>
    sb().rpc('complete_task', {
      p_task_key: taskKey,
      p_duration_seconds: durationSeconds ?? null,
    }),

  uncompleteTask: (taskKey: TaskKey) =>
    sb().rpc('uncomplete_task', { p_task_key: taskKey }),

  sealDay: () => sb().rpc('seal_day'),

  /**
   * Every frozen day of a challenge and every completion recorded against
   * it — the raw material for the Day 75 figures, which are counted from
   * what was actually done rather than assumed from the tier.
   *
   * Both reads are owner-scoped by RLS (challenge_days_select and
   * task_completions_select), and both tables are select-only for
   * `authenticated`, so this cannot be turned into a write. Bounded by the
   * challenge: 75 days of roughly six tasks.
   */
  listChallengeHistory: async (
    challengeId: string,
  ): Promise<{
    days: { day: number; task_snapshot: SnapshotTask[] }[];
    completions: { day: number; task_key: string }[];
  }> => {
    const [daysResult, completionsResult] = await Promise.all([
      sb()
        .from('challenge_days')
        .select('day, task_snapshot')
        .eq('challenge_id', challengeId)
        .order('day', { ascending: true }),
      sb()
        .from('task_completions')
        .select('day, task_key')
        .eq('challenge_id', challengeId),
    ]);
    return {
      days: (unwrap(daysResult, 'load challenge days') ?? []) as {
        day: number;
        task_snapshot: SnapshotTask[];
      }[],
      completions: (unwrap(completionsResult, 'load completions') ?? []) as {
        day: number;
        task_key: string;
      }[],
    };
  },

  /** Today's completions, mapped to the store's { taskKey: timeLabel } shape. */
  listTodayCompletions: async (
    challengeId: string,
    day: number,
  ): Promise<Partial<Record<TaskKey, string>>> => {
    const data = unwrap(
      await sb()
        .from('task_completions')
        .select('task_key, completed_at')
        .eq('challenge_id', challengeId)
        .eq('day', day),
      'load completions',
    );
    const out: Partial<Record<TaskKey, string>> = {};
    for (const row of data ?? []) {
      out[row.task_key as TaskKey] = new Date(row.completed_at).toLocaleTimeString(
        undefined,
        { hour: 'numeric', minute: '2-digit' },
      );
    }
    return out;
  },

  /**
   * Everything the task-config screens need, in one pass: the effective tier,
   * the custom tasks, and the target overrides. Overrides effective from
   * tomorrow are pending edits; the server decides what "tomorrow" is.
   */
  getChallengeConfig: async (
    challengeId: string,
    currentDay: number,
  ): Promise<ChallengeConfig> => {
    const [
      challengeResult,
      customsResult,
      overridesResult,
      tiersResult,
      sealedResult,
    ] = await Promise.all([
        sb()
          .from('challenges')
          .select('base_tier, flame, best_flame, missed_notice_day, duration_days')
          .eq('id', challengeId)
          .single(),
        sb().from('custom_tasks').select('*').eq('challenge_id', challengeId),
        sb().from('target_overrides').select('*').eq('challenge_id', challengeId),
        sb()
          .from('tier_history')
          .select('tier, from_day')
          .eq('challenge_id', challengeId)
          .order('from_day', { ascending: false }),
        // Perfect days = days this challenge sealed complete. Counted, not
        // fetched: the rows themselves are never needed.
        sb()
          .from('challenge_days')
          .select('id', { count: 'exact', head: true })
          .eq('challenge_id', challengeId)
          .not('sealed_at', 'is', null),
      ]);

    const challenge = unwrap(challengeResult, 'load challenge');
    const customs = unwrap(customsResult, 'load custom tasks');
    const overrides = unwrap(overridesResult, 'load target overrides');
    const tiers = unwrap(tiersResult, 'load tier history');
    if (sealedResult.error) {
      throw toBackendError(sealedResult.error, 'count sealed days');
    }

    const targetOverrides: Partial<Record<TaskKey, number>> = {};
    for (const row of overrides ?? []) {
      targetOverrides[row.task_key as TaskKey] = row.value;
    }

    // tier_history keys the effective day as from_day; a row in the future is
    // a pending change, the newest past row is what today runs on.
    const rows = (tiers ?? []) as { tier: string; from_day: number }[];
    const pending = rows.find((t) => t.from_day > currentDay);
    const active = rows.find((t) => t.from_day <= currentDay);

    return {
      tier: (active?.tier ?? challenge?.base_tier ?? 'hard') as Tier,
      // The finish line, read from the row. The fallback is the pre-0008
      // default and matches the column's own default, so a row written before
      // lengths existed reads as the 75 it has always been.
      durationDays: (challenge?.duration_days ??
        CHALLENGE.defaultDays) as ChallengeLength,
      flame: challenge?.flame ?? 0,
      bestFlame: challenge?.best_flame ?? 0,
      perfectDays: sealedResult.count ?? 0,
      missedDay: (challenge?.missed_notice_day ?? null) === currentDay,
      customTasks: (customs ?? []).map(
        (c: {
          id: string;
          name: string;
          sub: string;
          proof: boolean;
          timer_minutes: number | null;
          active_from_day: number;
          removed_from_day: number | null;
        }) => ({
          id: c.id,
          name: c.name,
          sub: c.sub,
          proof: c.proof,
          timerMinutes: c.timer_minutes ?? undefined,
          activeFromDay: c.active_from_day,
          removedFromDay: c.removed_from_day,
        }),
      ),
      targetOverrides,
      pendingTier: (pending?.tier ?? null) as Tier | null,
    };
  },

  // ---- edits: always effective tomorrow, enforced server-side ----
  setTargetOverride: (taskKey: TaskKey, value: number) =>
    sb().rpc('set_target_override', { p_task_key: taskKey, p_value: value }),

  addCustomTask: (input: {
    name: string;
    sub: string;
    proof: boolean;
    timerMinutes?: number;
  }) =>
    sb().rpc('add_custom_task', {
      p_name: input.name,
      p_sub: input.sub,
      p_proof: input.proof,
      p_timer_minutes: input.timerMinutes ?? null,
    }),

  updateCustomTask: (
    id: string,
    input: { name: string; sub: string; proof: boolean; timerMinutes?: number },
  ) =>
    sb().rpc('update_custom_task', {
      p_id: id,
      p_name: input.name,
      p_sub: input.sub,
      p_proof: input.proof,
      p_timer_minutes: input.timerMinutes ?? null,
    }),

  removeCustomTask: (id: string) => sb().rpc('remove_custom_task', { p_id: id }),

  changeTier: (tier: Tier) => sb().rpc('change_tier', { p_tier: tier }),

  /** One server-side transaction; the client's list is advisory only. */
  undoPendingChanges: (_reinstateIds: string[], _overrides: unknown) =>
    sb().rpc('undo_pending_changes'),

  // ---- squad ----
  /**
   * create_squad returns the row, not the uuid.
   *
   * The old signature handed back an id the UI has no use for, so the screen
   * showed a provisional placeholder while the real invite code sat unread
   * on the server — and rendered, and copied, six dots. The code comes back
   * with the name now, so nothing has to be guessed or re-fetched.
   */
  createSquad: async (name: string): Promise<MySquadRow> => {
    const rows = unwrap(
      await sb().rpc('create_squad', { p_name: name }),
      'create squad',
    ) as { id: string; name: string; code: string }[] | null;
    const row = rows?.[0];
    if (!row) throw new Error('create squad returned nothing');
    return { ...row, is_creator: true, member_count: 1 };
  },

  joinSquad: async (code: string): Promise<MySquadRow> => {
    const rows = unwrap(
      await sb().rpc('join_squad', { p_code: code }),
      'join squad',
    ) as { id: string; name: string; code: string }[] | null;
    const row = rows?.[0];
    if (!row) throw new Error('join squad returned nothing');
    return { ...row, is_creator: false, member_count: 0 };
  },

  renameSquad: async (squadId: string, name: string): Promise<MySquadRow> => {
    const rows = unwrap(
      await sb().rpc('rename_squad', { p_squad_id: squadId, p_name: name }),
      'rename squad',
    ) as { id: string; name: string; code: string }[] | null;
    const row = rows?.[0];
    if (!row) throw new Error('rename squad returned nothing');
    return { ...row, is_creator: true, member_count: 0 };
  },

  /** Leaves ONE squad. There is no "leave" without saying which any more. */
  leaveSquad: (squadId: string) =>
    sb().rpc('leave_squad', { p_squad_id: squadId }),

  /** Every squad the caller is in — the switcher's whole data source. */
  mySquads: async (): Promise<MySquadRow[]> =>
    (unwrap(await sb().rpc('my_squads'), 'load squads') ?? []) as MySquadRow[],

  /**
   * Squad roster + per-member counts for ONE squad.
   *
   * The squad is an argument now. It used to be inferred server-side from
   * the caller's single membership, and `squads` was read with `.limit(1)`
   * — both of which quietly picked an arbitrary squad the moment a user
   * could be in two.
   */
  getSquadStatus: async (squadId: string): Promise<SquadStatusRow[]> => {
    const [statusResult, squadResult] = await Promise.all([
      sb().rpc('get_squad_status', { p_squad_id: squadId }),
      sb().from('squads').select('id, name, invite_code').eq('id', squadId).limit(1),
    ]);
    const rows = (unwrap(statusResult, 'load squad status') ?? []) as Omit<
      SquadStatusRow,
      'squad_id' | 'squad_name' | 'invite_code'
    >[];
    const squad = unwrap(squadResult, 'load squad')?.[0];
    if (!squad || rows.length === 0) return [];
    return rows.map((r) => ({
      ...r,
      squad_id: squad.id,
      squad_name: squad.name,
      invite_code: squad.invite_code,
    }));
  },

  /**
   * A ping is scoped to the squad it was sent FROM. Sharing some other squad
   * with the recipient is not permission to post into this one.
   */
  sendPing: (toUserId: string, message: string, squadId: string) =>
    sb().rpc('send_ping', {
      p_to: toUserId,
      p_message: message,
      p_squad_id: squadId,
    }),

  postFeedItem: (
    squadId: string,
    authorId: string,
    kind: 'complete' | 'proof' | 'change',
    text: string,
  ) => sb().from('feed_items').insert({ squad_id: squadId, author: authorId, kind, text }),

  /**
   * The squad feed.
   *
   * `viewerId` is not decoration: feed_items.kind stores 'ping' for both
   * ends of a ping, while the app's FeedKind splits it into 'ping-in' and
   * 'ping-out' — that split is what the inbound styling and the bell icon
   * key off. Reading the column straight through (as `row.kind as
   * FeedItem['kind']` did) hands the UI a kind it has no case for, so a
   * ping you RECEIVED renders as one you sent. The viewer is also who
   * decides whether an author reads as "You".
   */
  listFeed: async (squadId: string, viewerId: string | null): Promise<FeedItem[]> => {
    const data = unwrap(
      await sb()
        .from('feed_items')
        .select('id, author, kind, text, created_at')
        .eq('squad_id', squadId)
        .order('created_at', { ascending: false })
        .limit(50),
      'load squad feed',
    );
    const rows = (data ?? []) as {
      id: string;
      author: string;
      kind: string;
      text: string;
      created_at: string;
    }[];
    // feed_items.author references auth.users, so the author's name cannot
    // be embedded — see namesByUserId.
    const names = await namesByUserId(rows.map((r) => r.author));
    return rows.map((row): FeedItem => {
      const mine = viewerId != null && row.author === viewerId;
      return {
        id: row.id,
        kind: toFeedKind(row.kind, mine),
        who: mine ? 'You' : (names.get(row.author) ?? 'Squadmate'),
        // Identity, as opposed to the label above — the blocked filter keys
        // on this, because a name that will not resolve is not a name.
        authorId: row.author,
        text: row.text,
        timestamp: Date.parse(row.created_at),
      };
    });
  },

  // ---- profile ----
  getProfile: async (userId: string) =>
    unwrap(
      await sb()
        .from('profiles')
        .select('name, xp, unit_preference')
        .eq('id', userId)
        .maybeSingle(),
      'load profile',
    ) as { name: string; xp: number; unit_preference: string } | null,

  getProfilePrivate: async (userId: string) =>
    unwrap(
      await sb().from('profile_private').select('*').eq('id', userId).maybeSingle(),
      'load private profile',
    ) as Record<string, unknown> | null,

  upsertProfile: (userId: string, name: string) =>
    sb().from('profiles').upsert({ id: userId, name }),

  setUnitPreference: (userId: string, pref: 'metric' | 'imperial') =>
    sb().from('profiles').update({ unit_preference: pref }).eq('id', userId),

  setWhy: (userId: string, why: string) =>
    sb().from('profile_private').upsert({ id: userId, why }),

  /** Health PREFERENCES only — never health data. */
  setPreferences: (
    userId: string,
    prefs: Record<string, boolean>,
  ) => sb().from('profile_private').upsert({ id: userId, ...prefs }),

  saveCompletionFeeling: (_userId: string, feeling: string | null, text: string) =>
    sb().rpc('save_completion_feeling', { p_feeling: feeling, p_text: text }),

  deleteAccount: () => sb().rpc('delete_account'),

  // ---- owner-only private data (RLS: owner = auth.uid()) ----
  saveJournalEntry: (ownerId: string, day: number, text: string) =>
    sb().from('journal_entries').insert({ owner: ownerId, day, text }),

  listJournal: async (ownerId: string): Promise<JournalEntry[]> => {
    const data = unwrap(
      await sb()
        .from('journal_entries')
        .select('*')
        .eq('owner', ownerId)
        .order('created_at', { ascending: false }),
      'load journal',
    );
    return (data ?? []).map(
      (r: { id: string; day: number; text: string; created_at: string }) => ({
        id: r.id,
        day: r.day,
        text: r.text,
        timestamp: Date.parse(r.created_at),
      }),
    );
  },

  /**
   * Returns the id Postgres assigned. The caller holds an optimistic row
   * under a client-minted id the database has never seen; without the id
   * coming back, a later UPDATE keyed on it matches zero rows and returns
   * NO error — the write is lost in silence.
   */
  logMeal: (
    ownerId: string,
    day: number,
    text: string,
    nutrition: MealNutrition | null,
  ) =>
    sb()
      .from('meals')
      .insert({ owner: ownerId, day, text, nutrition })
      .select('id')
      .single(),

  listMeals: async (ownerId: string): Promise<Meal[]> => {
    const data = unwrap(
      await sb()
        .from('meals')
        .select('*')
        .eq('owner', ownerId)
        .order('created_at', { ascending: false }),
      'load meals',
    );
    return (data ?? []).map(
      (r: {
        id: string;
        day: number;
        text: string;
        nutrition: MealNutrition | null;
        created_at: string;
      }) => ({
        id: r.id,
        // meals holds the WHOLE challenge; the day is what makes "today's
        // log" and the daily totals mean today.
        day: r.day,
        text: r.text,
        nutrition: r.nutrition,
        timestamp: Date.parse(r.created_at),
      }),
    );
  },

  setMealNutrition: (mealId: string, nutrition: MealNutrition | null) =>
    sb().from('meals').update({ nutrition }).eq('id', mealId),

  saveMetricCheckin: (ownerId: string, weightKg: number | null, mood: number | null) =>
    sb().from('metric_checkins').insert({ owner: ownerId, weight_kg: weightKg, mood }),

  listMetricCheckins: async (ownerId: string): Promise<MetricCheckin[]> => {
    const data = unwrap(
      await sb()
        .from('metric_checkins')
        .select('*')
        .eq('owner', ownerId)
        .order('created_at', { ascending: false }),
      'load check-ins',
    );
    return (data ?? []).map(
      (r: {
        id: string;
        weight_kg: number | null;
        mood: number | null;
        created_at: string;
      }) => ({
        id: r.id,
        weightKg: r.weight_kg,
        mood: r.mood,
        timestamp: Date.parse(r.created_at),
      }),
    );
  },

  /** Returns the assigned id — see logMeal. */
  addMilestone: (ownerId: string, title: string) =>
    sb().from('milestones').insert({ owner: ownerId, title }).select('id').single(),

  listMilestones: async (ownerId: string): Promise<Milestone[]> => {
    const data = unwrap(
      await sb().from('milestones').select('*').eq('owner', ownerId),
      'load milestones',
    );
    return (data ?? []).map(
      (r: { id: string; title: string; done: boolean; hit_on_day: number | null }) => ({
        id: r.id,
        title: r.title,
        done: r.done,
        meta: r.hit_on_day ? `Hit on Day ${r.hit_on_day}` : undefined,
      }),
    );
  },

  setMilestoneDone: (id: string, done: boolean, hitOnDay: number | null) =>
    sb()
      .from('milestones')
      .update({ done, hit_on_day: done ? hitOnDay : null })
      .eq('id', id),

  // ---- workout log (owner-only; app-owned data only, never HealthKit) ----
  saveWorkoutLog: (
    ownerId: string,
    challengeId: string,
    log: {
      day: number;
      taskKey: TaskKey;
      activityType: string;
      durationSeconds: number;
      effort: number | null;
      notes: string | null;
    },
  ) =>
    sb().from('workout_logs').insert({
      owner: ownerId,
      challenge_id: challengeId,
      day: log.day,
      task_key: log.taskKey,
      activity_type: log.activityType,
      duration_seconds: log.durationSeconds,
      effort: log.effort,
      notes: log.notes,
    }),

  listWorkoutLogs: async (ownerId: string): Promise<WorkoutLog[]> => {
    const data = unwrap(
      await sb()
        .from('workout_logs')
        .select('*')
        .eq('owner', ownerId)
        .order('logged_at', { ascending: false }),
      'load workout logs',
    );
    return (data ?? []).map(
      (r: {
        id: string;
        day: number;
        task_key: string;
        activity_type: string;
        duration_seconds: number;
        effort: number | null;
        notes: string | null;
        logged_at: string;
      }) => ({
        id: r.id,
        day: r.day,
        taskKey: r.task_key as TaskKey,
        activityType: r.activity_type,
        durationSeconds: r.duration_seconds,
        effort: r.effort,
        notes: r.notes,
        loggedAt: Date.parse(r.logged_at),
      }),
    );
  },

  // ---- moderation ----
  reportContent: (reporterId: string, feedItemId: string, reason: string) =>
    sb().from('content_reports').insert({
      reporter: reporterId,
      feed_item_id: feedItemId,
      reason,
    }),

  // blocked_users keys by user id; the UI works in display names, so the
  // service layer resolves one to the other via the squad roster.
  blockUser: (blockerId: string, blockedId: string) =>
    sb().from('blocked_users').insert({ blocker: blockerId, blocked: blockedId }),

  unblockUser: (blockerId: string, blockedId: string) =>
    sb().from('blocked_users').delete().match({ blocker: blockerId, blocked: blockedId }),

  /** Blocked squadmates as { id, name } pairs. */
  listBlockedUsers: async (
    blockerId: string,
  ): Promise<{ id: string; name: string }[]> => {
    const data = unwrap(
      await sb().from('blocked_users').select('blocked').eq('blocker', blockerId),
      'load blocked users',
    );
    const ids = ((data ?? []) as { blocked: string }[]).map((r) => r.blocked);
    // blocked_users.blocked references auth.users — see namesByUserId. The
    // old embed named blocked_users_blocked_fkey, which does exist, but
    // points at auth.users, so PostgREST could not reach profiles through
    // it: "Could not find a relationship between 'blocked_users' and
    // 'profiles' in the schema cache".
    const names = await namesByUserId(ids);
    return ids.map((id) => ({ id, name: names.get(id) ?? 'Blocked user' }));
  },
};

/** Short alias used by SupabaseDataService. */
export const api = BackendApi;
