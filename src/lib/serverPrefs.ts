/**
 * Preference sync: the mapping between the app's preference objects and the
 * columns that hold them on the server, and the rule for which side wins.
 *
 * Kept free of react-native/expo imports for the same reason prefsStorage.ts
 * and healthEnv.ts are — it is unit-testable in plain Node, and the rule
 * below is worth a proof rather than a code read.
 *
 * WHY THIS EXISTS. Every one of these settings lived only in AsyncStorage.
 * That is correct for exactly one of them ("which alerts does THIS phone
 * show") and wrong for the rest, and the migration to a native build is what
 * makes the difference matter: a friend who deliberately turned notifications
 * off in the browser installs the app and finds them on again. A choice
 * reverted without being asked is not a preference bug, it is a trust one.
 *
 * THE RULE, and it is the whole module:
 *
 *   The server is the record for these settings ONLY once this account has
 *   knowingly saved one. Until then the columns hold DDL defaults, and the
 *   defaults do not agree with the app's:
 *
 *     unit_preference   defaults 'metric'   — the app derives it from locale
 *
 *   Adopting an unwritten row would therefore flip an imperial user to
 *   metric: the same class of failure this fix exists to stop, pointing the
 *   other way. `prefs_synced_at` (0013_preference_sync.sql) is the
 *   discriminator, and `synced` below is that timestamp reduced to the only
 *   question a caller has.
 *
 *   `health_enabled` used to be on that list too. It is no longer synced at
 *   all — see HEALTH_COLUMNS for why a permission grant cannot be an account
 *   preference.
 *
 * Every reader here treats the row as hostile input, exactly as restorePrefs
 * does: a column of the wrong type, or absent because the migration has not
 * been applied yet, falls back to the caller's current value rather than to
 * `false` — `if (prefs.x)` on the string "false" is true, and a missing
 * column read as `undefined` would silently turn a setting off.
 */
import type { HealthPrefs, NotificationPrefs } from '@/data/types';
import type { UnitPreference } from '@/lib/units';

/** The settings that belong to the ACCOUNT rather than to the device. */
export interface SyncedPreferences {
  unitPreference: UnitPreference;
  notifications: NotificationPrefs;
  health: HealthPrefs;
  weeklyCheckinEnabled: boolean;
}

/**
 * What the server currently holds, plus whether it is worth anything.
 * `synced: false` means "these are defaults, not choices" — see the rule
 * above. The values are still carried so a caller can diff against them.
 */
export interface RemotePreferences extends SyncedPreferences {
  synced: boolean;
}

/**
 * profile_private column per health preference — and `healthEnabled` IS NOT
 * ONE OF THEM. It is the one setting in this file that is not a taste.
 *
 * The other three say what the user wants the app to DO with Health data.
 * `healthEnabled` says something about the world: that this app holds an
 * Apple Health grant. That grant is granted by iOS, to one phone, and lives
 * only on that phone. It cannot travel with an account, so syncing it means
 * a second device would read the switch ON, having never asked for anything
 * — the same "the switch is on and no permission exists" defect as the old
 * `true` default, arriving by sync instead of by DDL.
 *
 * So the account never records it. A new device starts NOT CONNECTED, sees
 * the Connect prompt, taps it, and gets the sheet. One extra tap; no claim
 * the app cannot back. What the account does keep are the three prompt
 * preferences, so someone who turned weight pre-fill off keeps it off.
 *
 * The column still exists (0004) and is written explicitly false — see
 * privateColumnsFor and 0013_preference_sync.sql.
 */
export type SyncedHealthPref = Exclude<keyof HealthPrefs, 'healthEnabled'>;

export const HEALTH_COLUMNS: Record<SyncedHealthPref, string> = {
  dietPromptEnabled: 'diet_prompt_enabled',
  workoutPromptEnabled: 'workout_prompt_enabled',
  weightPrefillEnabled: 'weight_prefill_enabled',
};

/**
 * The device-only column, named so the write can pin it and the tests can
 * assert it is never adopted.
 */
export const HEALTH_ENABLED_COLUMN = 'health_enabled';

/** profile_private column per notification preference. */
export const NOTIFICATION_COLUMNS: Record<keyof NotificationPrefs, string> = {
  pings: 'notify_pings',
  squadActivity: 'notify_squad_activity',
  dailyReminder: 'notify_daily_reminder',
  timerAlerts: 'notify_timer_alerts',
};

export const WEEKLY_CHECKIN_COLUMN = 'weekly_checkin_enabled';

/** The marker that separates a saved choice from a DDL default. */
export const PREFS_SYNCED_COLUMN = 'prefs_synced_at';

function booleanColumns<T extends object>(
  row: Record<string, unknown> | null,
  columns: Record<string, string>,
  current: T,
): T {
  if (!row) return current;
  const out = { ...current } as Record<string, unknown>;
  for (const key of Object.keys(columns)) {
    const value = row[columns[key]];
    if (typeof value === 'boolean') out[key] = value;
  }
  return out as T;
}

export function unitPreferenceFrom(value: unknown): UnitPreference | null {
  return value === 'metric' || value === 'imperial' ? value : null;
}

/**
 * Read the two profile rows into preferences, falling back to `current`
 * (what this device already believes) for anything unreadable.
 *
 * `synced` is false when the marker column is missing OR null — the missing
 * case is a database on which 0013 has not been applied yet, and treating
 * that as "not synced" is what keeps a pre-migration project from handing an
 * unwritten row to a client that would adopt it.
 */
export function readRemotePreferences(
  profile: { unit_preference?: unknown } | null,
  priv: Record<string, unknown> | null,
  current: SyncedPreferences,
): RemotePreferences {
  const unit = unitPreferenceFrom(profile?.unit_preference);
  const marker = priv?.[PREFS_SYNCED_COLUMN];
  return {
    synced: typeof marker === 'string' || marker instanceof Date,
    unitPreference: unit ?? current.unitPreference,
    notifications: booleanColumns(
      priv,
      NOTIFICATION_COLUMNS,
      current.notifications,
    ),
    health: booleanColumns(priv, HEALTH_COLUMNS, current.health),
    weeklyCheckinEnabled:
      typeof priv?.[WEEKLY_CHECKIN_COLUMN] === 'boolean'
        ? (priv[WEEKLY_CHECKIN_COLUMN] as boolean)
        : current.weeklyCheckinEnabled,
  };
}

/**
 * The profile_private columns for a save. EVERY preference column, every time
 * — never a subset, and the reason is the INSERT.
 *
 * profile_private may have no row yet (an account that never wrote a "why"
 * has none), so this write is an upsert. On the UPDATE path a subset would be
 * fine: Postgres sets only the columns named. On the INSERT path a subset is
 * a trap — every column left out takes its DDL DEFAULT. Saving one
 * notification switch would then CREATE a row full of defaults, stamped as
 * a recorded choice, and the next device would adopt every one of them.
 *
 * So the row is always written whole. What is deliberately absent:
 *
 *   - `why`, `completion_feeling`, `completion_text` — same table, not
 *     preferences, and a toggle must never be able to blank someone's answer.
 *   - `unit_preference` — it lives on `profiles`, which squadmates can read,
 *     and is written separately. Preference columns must never be routed to
 *     the squad-visible table by accident.
 */
export function privateColumnsFor(
  prefs: SyncedPreferences,
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const key of Object.keys(NOTIFICATION_COLUMNS) as (keyof NotificationPrefs)[]) {
    out[NOTIFICATION_COLUMNS[key]] = prefs.notifications[key];
  }
  for (const key of Object.keys(HEALTH_COLUMNS) as SyncedHealthPref[]) {
    out[HEALTH_COLUMNS[key]] = prefs.health[key];
  }
  // PINNED FALSE, deliberately, and it is not a subset-write bug.
  //
  // health_enabled is a device fact (see HEALTH_COLUMNS). Nothing reads this
  // column back — readRemotePreferences does not map it — so its only job is
  // to never be able to drift to `true` and claim, on the account, a
  // permission that only a phone can hold. `false` is also the DDL default,
  // so the INSERT and UPDATE paths of the upsert agree.
  out[HEALTH_ENABLED_COLUMN] = false;
  out[WEEKLY_CHECKIN_COLUMN] = prefs.weeklyCheckinEnabled;
  return out;
}
