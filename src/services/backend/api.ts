import type {
  MealNutrition,
  TaskDef,
  TaskKey,
  Tier,
} from '@/data/types';

import { getSupabase } from './supabaseClient';

/**
 * Typed wrappers over the Phase 8 SQL contract (supabase/migrations).
 * Server-owned state (day snapshots, completions, tier/target/custom-task
 * edits, squad membership, pings) flows EXCLUSIVELY through RPCs — the
 * database revokes direct writes, so a modified client cannot cheat.
 *
 * The mock DataService remains the active implementation until the schema
 * passes review and real credentials exist (EXPO_PUBLIC_USE_MOCK=false).
 */

function sb() {
  const client = getSupabase();
  if (!client) throw new Error('Backend not configured');
  return client;
}

export interface DaySnapshotRow {
  id: string;
  day: number;
  task_snapshot: TaskDef[];
  sealed_at: string | null;
}

export interface SquadStatusRow {
  user_id: string;
  name: string;
  xp: number;
  done_today: number;
  tasks_today: number;
  tier_label: string;
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
    (await sb().rpc('get_or_freeze_today')).data as DaySnapshotRow,

  completeTask: (taskKey: TaskKey, durationSeconds?: number) =>
    sb().rpc('complete_task', {
      p_task_key: taskKey,
      p_duration_seconds: durationSeconds ?? null,
    }),

  uncompleteTask: (taskKey: TaskKey) =>
    sb().rpc('uncomplete_task', { p_task_key: taskKey }),

  sealDay: () => sb().rpc('seal_day'),

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

  removeCustomTask: (id: string) =>
    sb().rpc('remove_custom_task', { p_id: id }),

  changeTier: (tier: Tier) => sb().rpc('change_tier', { p_tier: tier }),

  // ---- squad ----
  createSquad: async (name: string) =>
    (await sb().rpc('create_squad', { p_name: name })).data as string,

  joinSquad: async (code: string) =>
    (await sb().rpc('join_squad', { p_code: code })).data as string,

  leaveSquad: () => sb().rpc('leave_squad'),

  getSquadStatus: async () =>
    ((await sb().rpc('get_squad_status')).data ?? []) as SquadStatusRow[],

  sendPing: (toUserId: string, message: string) =>
    sb().rpc('send_ping', { p_to: toUserId, p_message: message }),

  postFeedItem: (squadId: string, authorId: string, kind: 'complete' | 'proof' | 'change', text: string) =>
    sb().from('feed_items').insert({ squad_id: squadId, author: authorId, kind, text }),

  listFeed: async (squadId: string) =>
    (await sb()
      .from('feed_items')
      .select('*')
      .eq('squad_id', squadId)
      .order('created_at', { ascending: false })
      .limit(50)).data ?? [],

  // ---- owner-only private data (RLS: owner = auth.uid()) ----
  saveJournalEntry: (ownerId: string, day: number, text: string) =>
    sb().from('journal_entries').insert({ owner: ownerId, day, text }),

  logMeal: (ownerId: string, day: number, text: string, nutrition: MealNutrition | null) =>
    sb().from('meals').insert({ owner: ownerId, day, text, nutrition }),

  setMealNutrition: (mealId: string, nutrition: MealNutrition | null) =>
    sb().from('meals').update({ nutrition }).eq('id', mealId),

  saveMetricCheckin: (ownerId: string, weightKg: number | null, mood: number | null) =>
    sb().from('metric_checkins').insert({ owner: ownerId, weight_kg: weightKg, mood }),

  addMilestone: (ownerId: string, title: string) =>
    sb().from('milestones').insert({ owner: ownerId, title }),

  setMilestone: (id: string, done: boolean, hitOnDay: number | null) =>
    sb().from('milestones').update({ done, hit_on_day: hitOnDay }).eq('id', id),

  // ---- moderation ----
  reportContent: (reporterId: string, feedItemId: string, reason: string) =>
    sb().from('content_reports').insert({
      reporter: reporterId,
      feed_item_id: feedItemId,
      reason,
    }),

  blockUser: (blockerId: string, blockedId: string) =>
    sb().from('blocked_users').insert({ blocker: blockerId, blocked: blockedId }),

  unblockUser: (blockerId: string, blockedId: string) =>
    sb().from('blocked_users').delete().match({ blocker: blockerId, blocked: blockedId }),
};
