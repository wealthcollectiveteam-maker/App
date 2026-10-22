import { useEffect, useState } from 'react';

import { remainingSeconds, useTimerStore } from '@/store/useTimerStore';

/**
 * Re-render every 500ms while a timer runs and fire the completion when the
 * wall-clock target passes. The interval only triggers renders — remaining
 * time is always recomputed from timestamps.
 */
export function useTimerTick(): number | null {
  const active = useTimerStore((s) => s.active);
  const completeActive = useTimerStore((s) => s.completeActive);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!active || active.pausedAtISO) return;
    const id = setInterval(() => setTick((t) => t + 1), 500);
    return () => clearInterval(id);
  }, [active]);

  if (!active) return null;
  const remaining = remainingSeconds(active);
  if (remaining <= 0 && !active.pausedAtISO) {
    // Defer to after render to avoid setState-during-render warnings.
    setTimeout(completeActive, 0);
    return 0;
  }
  return remaining;
}
