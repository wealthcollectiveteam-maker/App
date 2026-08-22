import type {
  CustomTask,
  FeedItem,
  JournalEntry,
  Meal,
  MealNutrition,
  MetricCheckin,
  Milestone,
  TaskDef,
  TaskKey,
  Tier,
  WorkoutLog,
} from '@/data/types';

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

export interface DaySnapshotRow {
  id: string;
  challenge_id: string;
  day: number;
  task_snapshot: TaskDef[];
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
}

export interface ChallengeConfig {
  tier: Tier;
  flame: number;
  customTasks: CustomTask[];
  targetOverrides: Partial<Record<TaskKey, number>>;
  pendingTier: Tier | null;
}

export const BackendApi = {
  // ---- challenge / day snapshots (server-owned) ----
  createChallenge: async (baseTier: Tier, startDate: string, timezone: string) =>
    (await sb().rpc('create_challenge', {
      p_base_tier: baseTier,
      p_start_date: startDate,
      p_timezone: timezone,
    })).data as string,

  getOrFreezeToday: async () =>
    (await sb().rpc('get_or_freeze_today')).data as DaySnapshotRow | null,

  completeTask: (taskKey: TaskKey, durationSeconds?: number) =>
    sb().rpc('complete_task', {
      p_task_key: taskKey,
      p_duration_seconds: durationSeconds ?? null,
    }),

  uncompleteTask: (taskKey: TaskKey) =>
    sb().rpc('uncomplete_task', { p_task_key: taskKey }),

  sealDay: () => sb().rpc('seal_day'),

  /** Today's completions, mapped to the store's { taskKey: timeLabel } shape. */
  listTodayCompletions: async (
    challengeId: string,
    day: number,
  ): Promise<Partial<Record<TaskKey, string>>> => {
    const { data } = await sb()
      .from('task_completions')
      .select('task_key, completed_at')
      .eq('challenge_id', challengeId)
      .eq('day', day);
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
    const [challenge, customs, overrides, tiers] = await Promise.all([
      sb().from('challenges').select('base_tier, flame').eq('id', challengeId).single(),
      sb().from('custom_tasks').select('*').eq('challenge_id', challengeId),
      sb().from('target_overrides').select('*').eq('challenge_id', challengeId),
      sb()
        .from('tier_history')
        .select('tier, from_day')
        .eq('challenge_id', challengeId)
        .order('from_day', { ascending: false }),
    ]);

    const targetOverrides: Partial<Record<TaskKey, number>> = {};
    for (const row of overrides.data ?? []) {
      targetOverrides[row.task_key as TaskKey] = row.value;
    }

    // tier_history keys the effective day as from_day; a row in the future is
    // a pending change, the newest past row is what today runs on.
    const rows = (tiers.data ?? []) as { tier: string; from_day: number }[];
    const pending = rows.find((t) => t.from_day > currentDay);
    const active = rows.find((t) => t.from_day <= currentDay);

    return {
      tier: (active?.tier ?? challenge.data?.base_tier ?? 'hard') as Tier,
      flame: challenge.data?.flame ?? 0,
      customTasks: (customs.data ?? []).map(
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
  createSquad: async (name: string) =>
    (await sb().rpc('create_squad', { p_name: name })).data as string,

  joinSquad: async (code: string) =>
    (await sb().rpc('join_squad', { p_code: code })).data as string,

  leaveSquad: () => sb().rpc('leave_squad'),

  /**
   * Squad roster + per-member counts. get_squad_status() returns the
   * sanctioned per-member surface (name, xp, done/total counts, tier label);
   * the squad's own name/code/streak come from `squads`, which only members
   * can read. Solo users get an empty array — there is no squad row.
   */
  getSquadStatus: async (): Promise<SquadStatusRow[]> => {
    const [status, squads] = await Promise.all([
      sb().rpc('get_squad_status'),
      sb().from('squads').select('id, name, invite_code').limit(1),
    ]);
    const rows = (status.data ?? []) as Omit<
      SquadStatusRow,
      'squad_id' | 'squad_name' | 'invite_code'
    >[];
    const squad = squads.data?.[0];
    if (!squad || rows.length === 0) return [];
    return rows.map((r) => ({
      ...r,
      squad_id: squad.id,
      squad_name: squad.name,
      invite_code: squad.invite_code,
    }));
  },

  sendPing: (toUserId: string, message: string) =>
    sb().rpc('send_ping', { p_to: toUserId, p_message: message }),

  postFeedItem: (
    squadId: string,
    authorId: string,
    kind: 'complete' | 'proof' | 'change',
    text: string,
  ) => sb().from('feed_items').insert({ squad_id: squadId, author: authorId, kind, text }),

  listFeed: async (squadId: string): Promise<FeedItem[]> => {
    const { data } = await sb()
      .from('feed_items')
      .select('id, author, kind, text, created_at, profiles(name)')
      .eq('squad_id', squadId)
      .order('created_at', { ascending: false })
      .limit(50);
    return (data ?? []).map((row): FeedItem => {
      // PostgREST returns embedded relations as arrays.
      const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
      return {
        id: row.id,
        kind: row.kind as FeedItem['kind'],
        who: profile?.name ?? 'Squadmate',
        text: row.text,
        timestamp: Date.parse(row.created_at),
      };
    });
  },

  // ---- profile ----
  getProfile: async (userId: string) =>
    (
      await sb()
        .from('profiles')
        .select('name, xp, unit_preference')
        .eq('id', userId)
        .maybeSingle()
    ).data as { name: string; xp: number; unit_preference: string } | null,

  getProfilePrivate: async (userId: string) =>
    (await sb().from('profile_private').select('*').eq('id', userId).maybeSingle())
      .data as Record<string, unknown> | null,

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
    const { data } = await sb()
      .from('journal_entries')
      .select('*')
      .eq('owner', ownerId)
      .order('created_at', { ascending: false });
    return (data ?? []).map(
      (r: { id: string; day: number; text: string; created_at: string }) => ({
        id: r.id,
        day: r.day,
        text: r.text,
        timestamp: Date.parse(r.created_at),
      }),
    );
  },

  logMeal: (
    ownerId: string,
    day: number,
    text: string,
    nutrition: MealNutrition | null,
  ) => sb().from('meals').insert({ owner: ownerId, day, text, nutrition }),

  listMeals: async (ownerId: string): Promise<Meal[]> => {
    const { data } = await sb()
      .from('meals')
      .select('*')
      .eq('owner', ownerId)
      .order('created_at', { ascending: false });
    return (data ?? []).map(
      (r: {
        id: string;
        text: string;
        nutrition: MealNutrition | null;
        created_at: string;
      }) => ({
        id: r.id,
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
    const { data } = await sb()
      .from('metric_checkins')
      .select('*')
      .eq('owner', ownerId)
      .order('created_at', { ascending: false });
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

  addMilestone: (ownerId: string, title: string) =>
    sb().from('milestones').insert({ owner: ownerId, title }),

  listMilestones: async (ownerId: string): Promise<Milestone[]> => {
    const { data } = await sb().from('milestones').select('*').eq('owner', ownerId);
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
    const { data } = await sb()
      .from('workout_logs')
      .select('*')
      .eq('owner', ownerId)
      .order('logged_at', { ascending: false });
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
    const { data } = await sb()
      .from('blocked_users')
      .select('blocked, profiles!blocked_users_blocked_fkey(name)')
      .eq('blocker', blockerId);
    return (data ?? []).map((r) => {
      const profile = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
      return { id: r.blocked as string, name: profile?.name ?? 'Blocked user' };
    });
  },
};

/** Short alias used by SupabaseDataService. */
export const api = BackendApi;
