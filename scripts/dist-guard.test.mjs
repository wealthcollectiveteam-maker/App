/**
 * Proofs for THE DEPLOY GATE (scripts/lib/distGuard.mjs).
 *
 * A guard nobody has seen fail is not a guard. These feed it a fabricated
 * poisoned bundle — the exact minified shapes the phase-17A2 build emitted,
 * copied from that artifact before it was overwritten — and prove it refuses.
 * Then they feed it the fixed shapes and prove it passes, because a gate that
 * refuses everything gets switched off within a week.
 *
 * The last block runs the guard against the REAL dist/ on disk, when there is
 * one. That is the check that would have caught the artifact this gate exists
 * for, on the day it mattered.
 *
 *   node --experimental-strip-types scripts/dist-guard.test.mjs
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DENIED_BUILD_IDS,
  checkBuildId,
  checkFingerprints,
  checkStaleness,
} from './lib/distGuard.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

let passes = 0;
function ok(label) {
  passes += 1;
  console.log(`PASS: ${label}`);
}

/**
 * The poisoned bundle, in the shapes esbuild actually emitted for it. Verbatim
 * from `dist/` at buildId cfaab51c before the rebuild replaced it.
 */
const POISONED = [
  `ps:null,activeEnergyKcal:null,workouts:[],bodyMass:null},S={healthEnabled:!0,dietPromptEnabled:!0,workoutPromptEnabled:!0,weightPrefillEnabled:!0};`,
  `const n={healthEnabled:'health_enabled',dietPromptEnabled:'diet_prompt_enabled',workoutPromptEnabled:'workout_prompt_enabled'};`,
  `"No workouts recorded today."`,
].join('\n');

/** The fixed bundle, in the shapes the current build emits. */
const FIXED = [
  `ps:null,activeEnergyKcal:null,workouts:null,bodyMass:null},S={healthEnabled:!1,dietPromptEnabled:!0,workoutPromptEnabled:!0,weightPrefillEnabled:!0};`,
  `const n={dietPromptEnabled:'diet_prompt_enabled',workoutPromptEnabled:'workout_prompt_enabled'},t='health_enabled';l[t]=!1;`,
  `"Apple Health returned no workouts for today."`,
].join('\n');

// ---- the artifact this gate was written for ------------------------------
{
  const findings = checkFingerprints(POISONED);
  const present = findings.filter((f) => f.kind === 'present').map((f) => f.id);
  const absent = findings.filter((f) => f.kind === 'absent').map((f) => f.id);
  assert.deepEqual(present.sort(), [
    'health-default-true',
    'health-enabled-synced',
    'recorded-today-claim',
    'workouts-empty-not-null',
  ]);
  // It fails the REQUIRED pair too, and that is the point of having both
  // directions: each of the six is independently enough to refuse, so a
  // future bundle that evades the bad patterns still has to prove the fix is
  // present rather than merely prove the old spelling is gone.
  assert.deepEqual(absent.sort(), ['health-default-false', 'workouts-null']);
  ok('the real phase-17A2 bundle is refused — 4 bad hits and 2 missing fixes');
}

{
  const findings = checkFingerprints(FIXED);
  assert.deepEqual(findings, [], 'the fixed bundle must pass cleanly');
  ok('the fixed bundle passes — the gate is not simply refusing everything');
}

// ---- each fingerprint on its own, so a partial regression is still caught --
{
  // The one that matters most: a build could fix the default and still sync
  // the column, or the reverse. Either alone must refuse.
  const onlyDefault = FIXED.replace('healthEnabled:!1', 'healthEnabled:!0');
  assert.deepEqual(
    checkFingerprints(onlyDefault)
      .map((f) => f.id)
      .sort(),
    ['health-default-false', 'health-default-true'],
    'a true default trips the bad pattern AND fails the required one',
  );

  const onlySynced = `${FIXED}\nx={healthEnabled:"health_enabled"};`;
  assert.deepEqual(
    checkFingerprints(onlySynced).map((f) => f.id),
    ['health-enabled-synced'],
  );
  ok('a partial regression in either direction is refused on its own');
}

{
  // The fixed client legitimately CONTAINS the string 'health_enabled' — it
  // pins the column false. A naive substring ban would refuse every good
  // build, get switched off, and the gate would be gone when it was needed.
  assert.ok(FIXED.includes('health_enabled'));
  assert.deepEqual(checkFingerprints(FIXED), []);
  ok('the mere string "health_enabled" is not the fingerprint — the map is');
}

// ---- a negative-only gate would pass on nothing at all -------------------
{
  const findings = checkFingerprints('');
  const ids = findings.map((f) => f.id).sort();
  assert.deepEqual(ids, ['health-default-false', 'workouts-null']);
  ok('an empty or truncated bundle is refused — required fingerprints absent');
}

{
  // Unminified output, in case the export is ever emitted readable.
  const readable =
    'healthEnabled: true, workouts: []\nactiveEnergyKcal: null, workouts: []';
  assert.ok(
    checkFingerprints(readable).some((f) => f.id === 'health-default-true'),
    'the readable spelling must be caught too, not only !0',
  );
  ok('both the minified (!0) and readable (true) spellings are matched');
}

// ---- the denylist --------------------------------------------------------
{
  assert.deepEqual(checkBuildId('"buildId": "cfaab51c81f4715d…"'), ['cfaab51c']);
  assert.deepEqual(checkBuildId('"buildId": "6fa5c3a5ef565f17…"'), []);
  assert.ok(DENIED_BUILD_IDS.length > 0, 'the denylist must not be empty');
  ok('the named poisoned build id is denied; the current one is not');
}

// ---- staleness -----------------------------------------------------------
{
  const t = 1_800_000_000_000;
  assert.equal(checkStaleness(t + 5000, t).stale, false, 'dist newer is fine');
  assert.equal(checkStaleness(t, t).stale, false, 'same second is fine');
  const behind = checkStaleness(t, t + 90_000);
  assert.equal(behind.stale, true);
  assert.equal(behind.behindSeconds, 90);
  ok('a dist/ older than its sources is stale; newer or equal is not');
}

// ---- and against whatever is actually on disk ----------------------------
{
  const dist = path.join(root, 'dist');
  let present = true;
  try {
    statSync(dist);
  } catch {
    present = false;
  }
  if (!present) {
    console.log('SKIP: no dist/ on disk — nothing to inspect');
  } else {
    const files = [];
    const walk = (dir) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (full.endsWith('.js')) files.push(full);
      }
    };
    walk(path.join(dist, '_expo'));
    const bundle = files.map((f) => readFileSync(f, 'utf8')).join('\n');
    assert.deepEqual(
      checkFingerprints(bundle),
      [],
      'the dist/ on disk carries a pre-fix fingerprint — do not deploy it',
    );
    assert.deepEqual(
      checkBuildId(bundle),
      [],
      'the dist/ on disk is a denied build',
    );
    ok(`the real dist/ on disk passes the gate (${files.length} bundle files)`);
  }
}

console.log(`\nAll ${passes} deploy-gate checks passed.`);
