/**
 * Proofs for PREFERENCE SYNC (Phase 17A part 2, fixes #1 and #4).
 *
 * Units, notification switches, health prompts and the weekly check-in card
 * lived only in AsyncStorage. Moving to the native build therefore re-derived
 * units from the phone's locale and put every switch back to its default —
 * a choice reverted without being asked.
 *
 * The dangerous part of the fix is not the writing. It is the READING: the
 * server's columns have DDL defaults that disagree with the app's own
 * ('metric' vs locale-derived), so a client that adopted an unwritten row
 * would cause exactly the bug it was built to stop, pointing the other way.
 * Everything below is about telling a CHOICE from a DEFAULT, and about a row
 * being hostile input like any other stored blob.
 *
 * One setting is not a preference at all and the middle blocks are about
 * that: `health_enabled` stands for an Apple Health grant, iOS issues those
 * to a phone rather than to an account, so it is never adopted and is written
 * pinned false. See lib/serverPrefs.ts and 0013_preference_sync.sql.
 *
 * The last block is the one that would catch a drifting map: it checks every
 * column name against the migrations themselves, so renaming a column in SQL
 * without renaming it here fails here rather than at 11pm on someone's phone.
 *
 *   node --experimental-strip-types scripts/server-prefs.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  HEALTH_COLUMNS,
  HEALTH_ENABLED_COLUMN,
  NOTIFICATION_COLUMNS,
  PREFS_SYNCED_COLUMN,
  WEEKLY_CHECKIN_COLUMN,
  privateColumnsFor,
  readRemotePreferences,
  unitPreferenceFrom,
} from '../src/lib/serverPrefs.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrations = path.join(here, '..', 'supabase', 'migrations');

let passes = 0;
function ok(label) {
  passes += 1;
  console.log(`PASS: ${label}`);
}

/** What this device currently believes — imperial, health prompts on. */
const DEVICE = {
  unitPreference: 'imperial',
  notifications: {
    pings: true,
    squadActivity: true,
    dailyReminder: false,
    timerAlerts: true,
  },
  health: {
    healthEnabled: true,
    dietPromptEnabled: true,
    workoutPromptEnabled: true,
    weightPrefillEnabled: true,
  },
  weeklyCheckinEnabled: true,
};

/** A row exactly as the DDL defaults leave it: nobody has chosen anything. */
const UNWRITTEN_PRIVATE = {
  why: '',
  health_enabled: false,
  diet_prompt_enabled: true,
  workout_prompt_enabled: true,
  weight_prefill_enabled: true,
  notify_timer_alerts: true,
  notify_pings: true,
  notify_squad_activity: true,
  notify_daily_reminder: false,
  weekly_checkin_enabled: true,
  prefs_synced_at: null,
};

// ---- the distinction the whole fix rests on -------------------------------
{
  const remote = readRemotePreferences(
    { unit_preference: 'metric' },
    UNWRITTEN_PRIVATE,
    DEVICE,
  );
  assert.equal(remote.synced, false);
  ok('a row nobody has written reports synced:false — defaults, not choices');
}

{
  // The same row, once the account has saved something.
  const remote = readRemotePreferences(
    { unit_preference: 'imperial' },
    {
      ...UNWRITTEN_PRIVATE,
      diet_prompt_enabled: false,
      prefs_synced_at: '2026-09-04T12:00:00Z',
    },
    { ...DEVICE, unitPreference: 'metric' },
  );
  assert.equal(remote.synced, true);
  assert.equal(remote.unitPreference, 'imperial');
  assert.equal(remote.health.dietPromptEnabled, false);
  ok('a written row reports synced:true and carries the saved values');
}

// ---- health_enabled is a DEVICE fact and never crosses the wire -----------
{
  // The defect this guards against: an Apple Health grant is issued by iOS to
  // ONE phone. A server that recorded "health enabled" would put an ON switch
  // in front of a second device that has never been asked for anything — the
  // same "switch on, no permission behind it" failure as the old client
  // default, arriving by sync instead of by DDL. So a stamped row saying
  // `true` must change nothing on this device.
  const remote = readRemotePreferences(
    { unit_preference: 'imperial' },
    {
      ...UNWRITTEN_PRIVATE,
      health_enabled: true,
      prefs_synced_at: '2026-09-04T12:00:00Z',
    },
    { ...DEVICE, health: { ...DEVICE.health, healthEnabled: false } },
  );
  assert.equal(remote.synced, true);
  assert.equal(
    remote.health.healthEnabled,
    false,
    'a server claiming a Health grant must not turn the switch on',
  );
  assert.ok(
    !Object.keys(HEALTH_COLUMNS).includes('healthEnabled'),
    'healthEnabled must not be a synced column',
  );
  ok('a stamped health_enabled=true is ignored — a grant belongs to a phone');
}

{
  // ...and the write side of the same rule. Pinned false, every time, so the
  // column can never drift into a claim the server has no business making.
  for (const enabled of [true, false]) {
    const written = privateColumnsFor({
      ...DEVICE,
      health: { ...DEVICE.health, healthEnabled: enabled },
    });
    assert.equal(
      written[HEALTH_ENABLED_COLUMN],
      false,
      `health_enabled must be pinned false (device said ${enabled})`,
    );
  }
  ok('health_enabled is written pinned false whatever the device believes');
}

{
  // 0013 not applied yet: the marker column simply is not in the row. That
  // must read as "never synced", never as "synced, with everything false".
  const withoutColumn = { ...UNWRITTEN_PRIVATE };
  delete withoutColumn.prefs_synced_at;
  const remote = readRemotePreferences(
    { unit_preference: 'metric' },
    withoutColumn,
    DEVICE,
  );
  assert.equal(remote.synced, false);
  ok('a database without 0013 reads as never-synced, not as synced-with-false');
}

// ---- the row is hostile input, like every stored blob in this app ---------
{
  const remote = readRemotePreferences(
    { unit_preference: 'STONES' },
    {
      prefs_synced_at: '2026-09-04T12:00:00Z',
      // the three ways a column goes wrong: wrong type, null, absent
      notify_pings: 'false',
      health_enabled: null,
    },
    DEVICE,
  );
  assert.equal(remote.unitPreference, 'imperial', 'unknown unit must not win');
  assert.equal(remote.notifications.pings, true, 'the string "false" is not false');
  assert.equal(
    remote.health.healthEnabled,
    true,
    'health_enabled is not read at all, so the device value stands',
  );
  assert.equal(remote.weeklyCheckinEnabled, true, 'absent must not turn it off');
  ok('an unreadable column falls back to the device, never to false');
}

{
  assert.equal(unitPreferenceFrom('metric'), 'metric');
  assert.equal(unitPreferenceFrom('imperial'), 'imperial');
  for (const junk of [null, undefined, '', 'Metric', 1, {}, ['metric']]) {
    assert.equal(unitPreferenceFrom(junk), null);
  }
  ok('only the two real unit values are accepted');
}

{
  const remote = readRemotePreferences(null, null, DEVICE);
  assert.equal(remote.synced, false);
  assert.deepEqual(remote.notifications, DEVICE.notifications);
  assert.deepEqual(remote.health, DEVICE.health);
  assert.equal(remote.unitPreference, DEVICE.unitPreference);
  ok('no rows at all changes nothing and claims nothing');
}

// ---- writing: the whole row, and only the preference columns --------------
{
  // The INSERT trap. profile_private may have no row yet, so this write is an
  // upsert — and a column left out of the INSERT path takes its DDL default.
  // diet/workout/weight-prefill all default TRUE, so a save that carried only
  // the switch that changed would create a row turning someone's prompts back
  // on, stamped as a recorded choice, for the next device to adopt.
  const written = privateColumnsFor({
    ...DEVICE,
    health: { ...DEVICE.health, dietPromptEnabled: false },
    weeklyCheckinEnabled: false,
  });
  assert.equal(Object.keys(written).length, 9, 'every preference column');
  assert.equal(written.weekly_checkin_enabled, false);
  assert.equal(
    written.diet_prompt_enabled,
    false,
    'must not fall back to the DDL default',
  );
  ok('one changed switch still writes all nine columns — no half-written row');
}

{
  // The privacy line, twice over. The unit preference lives on `profiles`,
  // which squadmates can read; nothing else may ever be routed there. And
  // `why` / the completion reflection share this table with the switches: a
  // toggle must never be able to blank someone's answer.
  const written = privateColumnsFor(DEVICE);
  for (const forbidden of [
    'unit_preference',
    'why',
    'completion_feeling',
    'completion_text',
    'id',
  ]) {
    assert.ok(!(forbidden in written), `${forbidden} must not be written here`);
  }
  ok('only preference columns are written — not units, not "why", not the id');
}

{
  // The round trip that matters: save, read back, get the same answer — for
  // everything that IS an account preference. healthEnabled deliberately does
  // not round-trip; it comes back as whatever this device holds, which is the
  // previous two blocks.
  const chosen = {
    unitPreference: 'metric',
    notifications: { ...DEVICE.notifications, pings: false, timerAlerts: false },
    health: {
      healthEnabled: false,
      dietPromptEnabled: false,
      workoutPromptEnabled: true,
      weightPrefillEnabled: false,
    },
    weeklyCheckinEnabled: false,
  };
  const row = {
    ...privateColumnsFor(chosen),
    prefs_synced_at: '2026-09-04T12:00:00Z',
  };
  const back = readRemotePreferences(
    { unit_preference: chosen.unitPreference },
    row,
    DEVICE,
  );
  assert.equal(back.synced, true);
  assert.equal(back.unitPreference, chosen.unitPreference);
  assert.deepEqual(back.notifications, chosen.notifications);
  assert.deepEqual(back.health, {
    ...chosen.health,
    healthEnabled: DEVICE.health.healthEnabled,
  });
  assert.equal(back.weeklyCheckinEnabled, chosen.weeklyCheckinEnabled);
  ok('every account preference round-trips through the columns unchanged');
}

// ---- the map against the SCHEMA, not against itself ------------------------
{
  const sql = [
    '0003_unit_preference.sql',
    '0004_workout_logs_and_prefs.sql',
    '0013_preference_sync.sql',
  ]
    .map((file) => readFileSync(path.join(migrations, file), 'utf8'))
    .join('\n');
  const declared = new Set(
    [...sql.matchAll(/add column(?:\s+if not exists)?\s+([a-z_]+)/g)].map(
      (m) => m[1],
    ),
  );
  const mapped = [
    ...Object.values(HEALTH_COLUMNS),
    // Not adopted any more, but still WRITTEN (pinned false), so a rename in
    // SQL would still break the upsert and must still fail here.
    HEALTH_ENABLED_COLUMN,
    ...Object.values(NOTIFICATION_COLUMNS),
    WEEKLY_CHECKIN_COLUMN,
    PREFS_SYNCED_COLUMN,
    'unit_preference',
  ];
  for (const column of mapped) {
    assert.ok(
      declared.has(column),
      `${column} is not declared by any migration — the map has drifted`,
    );
  }
  assert.equal(new Set(mapped).size, mapped.length, 'two settings share a column');
  ok(`all ${mapped.length} mapped columns exist in the migrations, and are distinct`);
}

console.log(`\nAll ${passes} preference-sync checks passed.`);
