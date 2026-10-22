import { useRouter } from 'expo-router';

import type { TaskDef } from '@/data/types';
import { useTimerStore } from '@/store/useTimerStore';

/**
 * Shared entry-point behavior for starting a task timer. Fixed-duration
 * tasks (workouts) start immediately; user-set tasks (reading) open the
 * timer screen's duration picker. Conflicts raise the global discard sheet.
 */
export function useStartTimer() {
  const router = useRouter();
  const requestStart = useTimerStore((s) => s.requestStart);

  return (task: TaskDef) => {
    if (!task.timerMinutes) return;
    const active = useTimerStore.getState().active;
    if (active?.taskKey === task.key) {
      router.push('/timer');
      return;
    }
    if (task.timerUserSet && !active) {
      router.push({ pathname: '/timer', params: { task: task.key } });
      return;
    }
    if (task.timerUserSet && active) {
      // Conflict flow needs a concrete duration; use the task default.
      const result = requestStart(task, task.timerMinutes * 60);
      if (result === 'started') router.push('/timer');
      return;
    }
    const result = requestStart(task, task.timerMinutes * 60);
    if (result === 'started') router.push('/timer');
  };
}
