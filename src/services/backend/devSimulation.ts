import { useAppStore } from '@/store/useAppStore';
import { useSessionStore } from '@/store/useSessionStore';
import { supabaseService } from '@/services';
import { toBackendError } from '@/services/contract';
import { toast } from '@/store/useToastStore';

import { getSupabase } from './supabaseClient';

/**
 * The dev scenario sheet's backend half — DEV BUILDS ONLY.
 *
 * WHY THIS FILE EXISTS. Every scenario in the sheet was written against
 * MockDataService and none of them survived the switch to the real backend:
 * Day 1, Day 12, Day 75 and missed day all did nothing at all. That is worse
 * than an inconvenience. The Day 75 finish screen is unreachable for eleven
 * weeks, so a bug in it would first surface in October, in front of a real
 * user finishing a real challenge.
 *
 * WHY IT IS A SEPARATE MODULE. Exactly the reason DevScenarioSheet is one.
 * It is imported only from that sheet, which AppHeader reaches through a
 * `__DEV__`-guarded require(). `__DEV__` is a compile-time constant, so in a
 * production bundle that branch is dead code, Metro never follows the
 * require, and this module and every simulation call in it are ABSENT from
 * the binary — not hidden behind a runtime check.
 *
 * WHAT THESE DO, PLAINLY. They call SECURITY DEFINER RPCs that write REAL
 * ROWS to the REAL database. A simulated completion is a row in
 * task_completions and is indistinguishable from one earned by doing the
 * work. Point them at a throwaway account.
 *
 * The server does not take the client's word for any of it. Every RPC is
 * owner-scoped in SQL — none of them accepts a user id, they resolve
 * auth.uid()'s own active challenge — and every one is refused unless the
 * caller's id is in `sim_allowed_users`, which ships empty. The bundle
 * guard keeps the sheet out of production; that table is what keeps the
 * RPCs out of a stranger's reach, because a `__DEV__` constant is a property
 * of the JavaScript bundle and says nothing at all to Postgres.
 */

export type SimScenario = 'day1' | 'day12' | 'day75' | 'missed' | 'advance';

function client() {
  const sb = getSupabase();
  if (!sb) throw new Error('Backend not configured');
  return sb;
}

/** Whether this account is in `sim_allowed_users`. */
export async function isSimulationEnabled(): Promise<boolean> {
  const userId = useSessionStore.getState().userId;
  if (!userId) return false;
  try {
    const { data, error } = await client()
      .from('sim_allowed_users')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) return false;
    return !!data;
  } catch {
    return false;
  }
}

/**
 * Re-read everything from the server and adopt it.
 *
 * A full hydrate rather than refreshDay(), because a simulation can replace
 * the challenge outright — a Hard miss archives the old one and the new row
 * has a different id — and it rewrites journal, meals and milestones, none
 * of which refreshDay() re-reads.
 */
async function reload(): Promise<void> {
  const service = supabaseService;
  const userId = useSessionStore.getState().userId;
  if (!service || !userId) return;
  await service.hydrate(userId);
  useAppStore.getState().adoptSession({});
}

async function rpc(fn: string, args?: Record<string, unknown>): Promise<void> {
  const { error } = await client().rpc(fn, args ?? {});
  if (error) throw toBackendError(error, fn);
}

/**
 * Run one scenario against the caller's own challenge, then pull the app
 * back into step with whatever the server now says.
 *
 * Returns the line to show the user. Failures are surfaced rather than
 * swallowed: "simulation is not enabled for this account" is the answer you
 * need to see, and a silent no-op is the exact failure mode this file exists
 * to remove.
 */
export async function runSimulation(scenario: SimScenario): Promise<void> {
  try {
    switch (scenario) {
      case 'day1':
        // Also the undo for every other scenario: sim_fresh_start() deletes
        // the simulated history rather than archiving it, so the account is
        // left looking exactly like a new signup.
        await rpc('sim_fresh_start');
        break;
      case 'day12':
        await rpc('sim_jump_to_day', { p_day: 12, p_complete_today: false });
        break;
      case 'day75':
        await rpc('sim_day75_complete');
        break;
      case 'missed':
        // Runs the same evaluation the scheduled job runs. It manufactures
        // the precondition first — yesterday made a genuine, unjudged miss —
        // then calls evaluate_challenge(), the function pg_cron calls. What
        // happens on the device is what will happen at midnight.
        await rpc('sim_missed_day');
        break;
      case 'advance': {
        const day = useAppStore.getState().day;
        await rpc('sim_jump_to_day', {
          p_day: day + 1,
          p_complete_today: false,
        });
        break;
      }
    }
    await reload();
    toast(LABELS[scenario]);
  } catch (error) {
    const message = toBackendError(error).message;
    console.warn(`[dev:simulation] ${scenario}: ${message}`);
    toast(message.length <= 70 ? message : 'Simulation failed — see console.');
  }
}

const LABELS: Record<SimScenario, string> = {
  day1: 'Fresh start — day 1, history cleared.',
  day12: 'Jumped to day 12.',
  day75: 'Day 75, complete.',
  missed: 'Evaluated. Check your streak.',
  advance: 'Advanced a day.',
};
