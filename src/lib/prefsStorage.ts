/**
 * Pure serialisation for the preference blobs the app keeps on the device.
 * Kept free of react-native/expo imports so it is unit-testable in plain
 * Node — the same reason healthEnv.ts exists.
 *
 * WHY THIS IS NOT JUST JSON.parse. A stored blob is untrusted input: it was
 * written by an older build, or half-written when the app was killed, or
 * edited by hand in a browser's devtools (this app runs on the web). Three
 * things follow, and all three are the reason `restore` looks the way it
 * does:
 *
 *   - a corrupt blob must not throw, because this runs during startup and a
 *     preference is never worth blocking a launch for;
 *   - a blob must not be able to ADD keys the defaults do not define, or a
 *     stale build could reintroduce a setting this one no longer honours;
 *   - a value of the wrong type must not survive, because `if (prefs.x)` on
 *     the string "false" is true.
 */

/** Keys under which each blob is stored. One place, so they cannot drift. */
export const PREF_KEYS = {
  notifications: 'ranked.notificationPrefs.v1',
  health: 'ranked.healthPrefs.v1',
  weeklyCheckin: 'ranked.weeklyCheckinEnabled.v1',
} as const;

export function serializePrefs(value: object): string {
  return JSON.stringify(value);
}

/**
 * Merge a stored blob over `defaults`, keeping only keys the defaults
 * already define AND whose stored type matches. Returns null when there is
 * nothing usable, so the caller can leave its state untouched rather than
 * overwriting it with defaults it already holds.
 */
export function restorePrefs<T extends object>(
  raw: string | null | undefined,
  defaults: T,
): T | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  const source = parsed as Record<string, unknown>;
  const merged = { ...defaults } as Record<string, unknown>;
  let used = 0;
  for (const key of Object.keys(defaults)) {
    const want = (defaults as Record<string, unknown>)[key];
    if (key in source && typeof source[key] === typeof want) {
      merged[key] = source[key];
      used += 1;
    }
  }
  return used > 0 ? (merged as T) : null;
}

/** The weekly check-in flag is a single boolean, stored as '1' / '0'. */
export function serializeFlag(value: boolean): string {
  return value ? '1' : '0';
}

export function restoreFlag(raw: string | null | undefined): boolean | null {
  if (raw === '1') return true;
  if (raw === '0') return false;
  return null;
}
