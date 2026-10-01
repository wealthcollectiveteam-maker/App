import { create } from 'zustand';

import {
  applyUpdate,
  fetchServerBuildId,
  isDifferentBuild,
} from '@/lib/webUpdate';

interface UpdateState {
  /** The build the server is offering, when it is not the one running. */
  availableBuildId: string | null;
  /** The build the user has waved away. In memory ONLY — see below. */
  dismissedBuildId: string | null;
  checking: boolean;
  check: () => Promise<void>;
  dismiss: () => void;
  apply: () => void;
}

/**
 * "Is there a newer build than the one I am?"
 *
 * Asked on cold start and on every foreground — the AppState listener in
 * app/_layout.tsx, which on web IS visibilitychange. NEVER on a timer: a poll
 * would spend battery all day to catch an event that happens a few times a
 * month, and the foreground moment is precisely when a stale app matters.
 *
 * DISMISSAL IS DELIBERATELY NOT PERSISTED. Module state dies with the JS
 * context, and a cold start is a fresh context — so "don't nag me every time I
 * come back to the app" and "remind me next time I actually launch it" fall
 * out of the same line of code, with nothing to write, migrate or ever clear.
 * Persisting it to AsyncStorage would have needed an explicit expiry rule and
 * could have silenced the banner permanently on a phone that never cold
 * starts.
 *
 * It is keyed to the build id rather than a boolean, so dismissing one update
 * does not hide the NEXT one.
 */
export const useUpdateStore = create<UpdateState>((set, get) => ({
  availableBuildId: null,
  dismissedBuildId: null,
  checking: false,

  check: async () => {
    // A foreground event can arrive while the cold-start check is still in
    // flight; two concurrent fetches would race to set the same value.
    if (get().checking) return;
    set({ checking: true });
    try {
      const serverBuildId = await fetchServerBuildId();
      set({
        availableBuildId: isDifferentBuild(serverBuildId)
          ? serverBuildId
          : null,
      });
    } finally {
      set({ checking: false });
    }
  },

  dismiss: () => set({ dismissedBuildId: get().availableBuildId }),

  apply: () => {
    const buildId = get().availableBuildId;
    if (buildId) applyUpdate(buildId);
  },
}));

/** The banner shows only for an available build the user has not waved away. */
export const selectUpdateReady = (s: UpdateState) =>
  !!s.availableBuildId && s.availableBuildId !== s.dismissedBuildId;
