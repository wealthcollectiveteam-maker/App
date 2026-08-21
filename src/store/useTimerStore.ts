import { create } from 'zustand';

import type { ActiveTimer, TaskDef, TaskKey } from '@/data/types';
import { DataService } from '@/services/DataService';
import {
  cancelTimerNotifications,
  ensureNotificationPermission,
  playCompletionEffects,
  postTimerNotifications,
} from '@/services/timerEffects';
import { useAppStore } from '@/store/useAppStore';
import { toast } from '@/store/useToastStore';

/** Timer alerts respect the settings toggle (on by default). */
function timerAlertsEnabled(): boolean {
  return useAppStore.getState().notificationPrefs.timerAlerts;
}

function repostNotifications(timer: ActiveTimer): void {
  if (!timerAlertsEnabled()) return;
  postTimerNotifications(
    timer.label,
    Date.now() + remainingSeconds(timer) * 1000,
  ).catch(() => {});
}

/**
 * Workout timer engine. Remaining time is always derived from wall-clock
 * timestamps (Date.now() − startedAt − accumulated pause) so iOS suspending
 * JS timers in the background cannot freeze or drift the countdown. UI
 * intervals exist only to trigger re-renders.
 */

/** Seconds of active (non-paused) time since the timer started. */
export function elapsedActiveSeconds(t: ActiveTimer, now: number = Date.now()): number {
  const end = t.pausedAtISO ? Date.parse(t.pausedAtISO) : now;
  return Math.max(
    0,
    (end - Date.parse(t.startedAtISO)) / 1000 - t.accumulatedPauseSeconds,
  );
}

export function remainingSeconds(t: ActiveTimer, now: number = Date.now()): number {
  return t.durationSeconds - elapsedActiveSeconds(t, now);
}


export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

export interface CompletedTimer {
  taskKey: TaskKey;
  label: string;
  elapsedSeconds: number;
}

interface TimerState {
  active: ActiveTimer | null;
  /** Set while a completion is being applied, to guard double-fires. */
  completing: boolean;
  /** Last completion, so the timer screen can show its done state. */
  lastCompleted: CompletedTimer | null;
  /** A start was requested while another timer runs — asks to discard. */
  conflict: TaskDef | null;
  hydrated: boolean;

  hydrate: () => Promise<void>;
  /** Entry point: starts, or raises the discard-confirm if another runs. */
  requestStart: (task: TaskDef, durationSeconds: number) => 'started' | 'conflict' | 'already-running';
  resolveConflict: (discardAndStart: boolean) => void;
  pause: () => void;
  resume: () => void;
  addMinute: () => void;
  cancel: () => void;
  /** Completes through the app's existing completion path. */
  completeActive: () => void;
  clearLastCompleted: () => void;
}

let pendingStart: { task: TaskDef; durationSeconds: number } | null = null;

export const useTimerStore = create<TimerState>((set, get) => {
  const start = (task: TaskDef, durationSeconds: number) => {
    const timer: ActiveTimer = {
      taskKey: task.key,
      label: task.label,
      startedAtISO: new Date().toISOString(),
      durationSeconds,
      pausedAtISO: null,
      accumulatedPauseSeconds: 0,
    };
    set({ active: timer, lastCompleted: null });
    DataService.startTimer(timer).catch(() => {});
    ensureNotificationPermission().then(() => repostNotifications(timer));
  };

  return {
    active: null,
    completing: false,
    lastCompleted: null,
    conflict: null,
    hydrated: false,

    hydrate: async () => {
      const stored = await DataService.getActiveTimer();
      if (!stored) {
        set({ hydrated: true });
        return;
      }
      // Ignore a stored timer for a task that is already done today.
      const appState = useAppStore.getState();
      if (appState.tasksDone[stored.taskKey]) {
        await DataService.cancelTimer();
        set({ hydrated: true });
        return;
      }
      if (!stored.pausedAtISO && remainingSeconds(stored) <= 0) {
        // Expired while backgrounded / killed: complete now.
        set({ active: stored, hydrated: true });
        get().completeActive();
        return;
      }
      set({ active: stored, hydrated: true });
    },

    requestStart: (task, durationSeconds) => {
      const { active } = get();
      if (active?.taskKey === task.key) return 'already-running';
      if (active) {
        pendingStart = { task, durationSeconds };
        set({ conflict: task });
        return 'conflict';
      }
      start(task, durationSeconds);
      return 'started';
    },

    resolveConflict: (discardAndStart) => {
      const request = pendingStart;
      pendingStart = null;
      set({ conflict: null });
      if (!discardAndStart || !request) return;
      cancelTimerNotifications().catch(() => {});
      DataService.cancelTimer().catch(() => {});
      set({ active: null });
      start(request.task, request.durationSeconds);
    },

    pause: () => {
      const { active } = get();
      if (!active || active.pausedAtISO) return;
      const next: ActiveTimer = {
        ...active,
        pausedAtISO: new Date().toISOString(),
      };
      set({ active: next });
      DataService.pauseTimer(next).catch(() => {});
      // Pause cancels EVERY scheduled timer notification (precisely by id).
      cancelTimerNotifications().catch(() => {});
    },

    resume: () => {
      const { active } = get();
      if (!active?.pausedAtISO) return;
      const pausedFor =
        (Date.now() - Date.parse(active.pausedAtISO)) / 1000;
      const next: ActiveTimer = {
        ...active,
        pausedAtISO: null,
        accumulatedPauseSeconds: active.accumulatedPauseSeconds + pausedFor,
      };
      set({ active: next });
      DataService.resumeTimer(next).catch(() => {});
      // Resume reschedules against the recomputed target.
      repostNotifications(next);
    },

    addMinute: () => {
      const { active } = get();
      if (!active) return;
      const next: ActiveTimer = {
        ...active,
        durationSeconds: active.durationSeconds + 60,
      };
      set({ active: next });
      DataService.resumeTimer(next).catch(() => {});
      if (!next.pausedAtISO) {
        cancelTimerNotifications()
          .then(() => repostNotifications(next))
          .catch(() => {});
      }
    },

    cancel: () => {
      // Leaves zero orphaned notifications — cancelled precisely by id.
      cancelTimerNotifications().catch(() => {});
      DataService.cancelTimer().catch(() => {});
      set({ active: null, conflict: null });
      pendingStart = null;
    },

    completeActive: () => {
      const { active, completing } = get();
      if (!active || completing) return;
      set({ completing: true });
      const elapsed = Math.min(
        elapsedActiveSeconds(active),
        active.durationSeconds,
      );
      // Same completion path as a swipe: XP, feed entry, streak effect.
      useAppStore.getState().completeTask(active.taskKey);
      DataService.completeTimedTask(active.taskKey, elapsed).catch(() => {});
      cancelTimerNotifications().catch(() => {});
      playCompletionEffects();
      toast('+20 XP');
      set({
        active: null,
        completing: false,
        lastCompleted: {
          taskKey: active.taskKey,
          label: active.label,
          elapsedSeconds: elapsed,
        },
      });
    },

    clearLastCompleted: () => set({ lastCompleted: null }),
  };
});
