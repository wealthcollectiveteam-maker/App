/**
 * THE GATE BETWEEN A BUILT `dist/` AND ELEVEN PEOPLE.
 *
 * WHY THIS IS CODE AND NOT A SENTENCE IN A DOCUMENT.
 *
 *   A build made partway through phase 17A2 — after preference sync was
 *   wired up, before `health_enabled` was taken out of it — defaults
 *   `healthEnabled` to TRUE and writes it from the device. Copied to Pages
 *   against a database where `prefs_synced_at` exists, it stamps
 *
 *     health_enabled = true,  prefs_synced_at = now()
 *
 *   on every account that signs in. After that nothing can tell a seeded
 *   `true` from a chosen one: the marker is what makes a column a choice,
 *   and it cannot be un-set with any confidence about what it was covering.
 *
 *   For one turn of this project the only thing standing between that
 *   artifact and production was a line in a checklist saying "not the stale
 *   one". Every defect this repo has shipped got past somebody who meant to
 *   remember something. So it is a program now, and it fails loudly.
 *
 * THE THREE CHECKS, WEAKEST TO STRONGEST.
 *
 *   1. BUILD ID DENYLIST. Names the one artifact known to be poisoned. Cheap,
 *      certain, and worth nothing against the NEXT bad build — a denylist
 *      only knows what has already gone wrong.
 *
 *   2. STALENESS. Refuses a `dist/` older than the sources that feed it.
 *      Catches "forgot to rebuild", which is how the poisoned artifact came
 *      to be sitting there in the first place.
 *
 *   3. FINGERPRINTS. Properties of the emitted bundle, so they hold for any
 *      build, including ones nobody has made yet. This is the check that
 *      actually generalises, and it is why the negative patterns below are
 *      paired with positive ones: "the bad string is absent" passes happily
 *      on an empty file, whereas "the fixed string is present" cannot.
 *
 * READING MINIFIED OUTPUT. esbuild emits `!0` for true and `!1` for false and
 * preserves object KEYS, because they are looked up by name. `healthEnabled:`
 * is therefore stable across builds in a way a local variable name is not.
 * Both the minified and the readable spellings are matched, so this keeps
 * working if the export is ever emitted unminified.
 *
 * This module is pure — no fs, no process, no network — so scripts/
 * dist-guard.test.mjs can feed it a fabricated poisoned bundle and prove the
 * gate catches it without anyone having to build one.
 */

/** The artifact this gate was written for. Substring match; it is a prefix. */
export const DENIED_BUILD_IDS = ['cfaab51c'];

/**
 * Bundle properties that mean "this is a pre-fix client". Each one is on its
 * own a sufficient reason to refuse.
 */
export const BAD_FINGERPRINTS = [
  {
    id: 'health-default-true',
    pattern: /healthEnabled\s*:\s*(!0|true)\b/,
    why:
      'healthEnabled defaults TRUE. On a fresh install the switch reads ON, ' +
      'nothing ever asks iOS for permission, every reading is null, and the ' +
      'card draws those nulls as zeroes.',
  },
  {
    id: 'health-enabled-synced',
    // The HEALTH_COLUMNS entry. The FIXED client still contains the string
    // 'health_enabled' (it pins the column false), so the plain substring is
    // not the fingerprint — this mapping is.
    pattern: /healthEnabled\s*:\s*['"]health_enabled['"]/,
    why:
      'health_enabled is in the synced column map, so the client writes an ' +
      'Apple Health grant to the account. A grant is issued by iOS to one ' +
      'phone and cannot travel; a second device would read the switch ON ' +
      'having never asked for anything.',
  },
  {
    id: 'workouts-empty-not-null',
    pattern: /activeEnergyKcal\s*:\s*null\s*,\s*workouts\s*:\s*\[\s*\]/,
    why:
      'EMPTY_READINGS.workouts is [] rather than null, so "the query never ' +
      'ran" is indistinguishable from "the query returned nothing" and the ' +
      'card prints a verdict on a day it was never told about.',
  },
  {
    id: 'recorded-today-claim',
    pattern: /No workouts recorded today/,
    why:
      'The card asserts what was RECORDED. It can only know what was ' +
      'RETURNED — a read-denied workout type looks identical to a rest day.',
  },
];

/**
 * Properties that must be PRESENT. A negative-only gate passes on an empty
 * file, a truncated copy, or a bundle where the health code was dropped
 * entirely; these are what make the check mean "the fix is in there".
 */
export const REQUIRED_FINGERPRINTS = [
  {
    id: 'health-default-false',
    pattern: /healthEnabled\s*:\s*(!1|false)\b/,
    why: 'healthEnabled must default FALSE — the fix for the above.',
  },
  {
    id: 'workouts-null',
    pattern: /activeEnergyKcal\s*:\s*null\s*,\s*workouts\s*:\s*null/,
    why: 'EMPTY_READINGS.workouts must be null, never [].',
  },
];

/**
 * @param {string} js  the concatenated JS of the bundle under inspection
 * @returns {{id: string, kind: 'present'|'absent', why: string}[]}
 */
export function checkFingerprints(js) {
  const findings = [];
  for (const f of BAD_FINGERPRINTS) {
    if (f.pattern.test(js)) {
      findings.push({ id: f.id, kind: 'present', why: f.why });
    }
  }
  for (const f of REQUIRED_FINGERPRINTS) {
    if (!f.pattern.test(js)) {
      findings.push({ id: f.id, kind: 'absent', why: f.why });
    }
  }
  return findings;
}

/**
 * @param {string} text  anything about to be shipped (bundle, version.json)
 * @returns {string[]}  the denied ids found
 */
export function checkBuildId(text) {
  return DENIED_BUILD_IDS.filter((id) => text.includes(id));
}

/**
 * Is `dist/` older than what it was built from?
 *
 * mtime, not a content hash, and deliberately: a hash would mean re-running
 * the bundler to know, which is the thing being checked. Whole seconds,
 * because Git Bash on Windows reports mtimes from a filesystem whose
 * granularity is not guaranteed finer, and a sub-second difference between a
 * source save and the export that followed it is not staleness.
 *
 * @param {number} distMs     newest mtime inside dist/
 * @param {number} sourceMs   newest mtime across the source inputs
 * @returns {{stale: boolean, behindSeconds: number}}
 */
export function checkStaleness(distMs, sourceMs) {
  const behindSeconds = Math.floor((sourceMs - distMs) / 1000);
  return { stale: behindSeconds > 0, behindSeconds };
}
