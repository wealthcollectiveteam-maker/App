/**
 * Proofs for THE ONE CALL THAT CAN SILENTLY BREAK HEALTH.
 *
 * `getRequestStatusForAuthorization` is a Nitro native call and it is the
 * load-bearing new thing in this phase: everything the Today's Health card
 * shows hangs off whether it says "this device has been asked". The JS enum
 * is numeric at runtime (unknown 0, shouldRequest 1, unnecessary 2), and I
 * have verified that in node_modules — but nothing short of a device proves
 * the NATIVE side marshals it as a number.
 *
 * If it does not, the old code compared `=== 2` against something that is not
 * 2, fell to 'unknown', and the card read "Not connected" for ever even after
 * access was granted — a symptom identical to a denied permission.
 *
 * Two answers to that, and the fix matters more than the instrumentation:
 *
 *   1. PARSE TOLERANTLY, in one direction. Accept the number, the numeric
 *      string, and the enum spelled by name. That removes the failure mode
 *      rather than merely reporting it.
 *   2. NEVER INVENT 'requested'. An unrecognised value must resolve
 *      'unknown', which callers read as not-asked. A card that guessed "we
 *      were asked" from a value nobody recognises is claiming a connection it
 *      cannot back — the exact failure this phase removed. The asymmetry
 *      below is the whole point, and it is why every junk case is asserted
 *      individually rather than in a loop with one message.
 *
 *   node --experimental-strip-types scripts/health-auth.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseAuthRequestStatus } from '../src/services/healthEnv.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, '..', 'src');

let passes = 0;
function ok(label) {
  passes += 1;
  console.log(`PASS: ${label}`);
}

// ---- the expected shape: HKAuthorizationRequestStatus as a number ---------
{
  assert.equal(parseAuthRequestStatus(2), 'requested');
  assert.equal(parseAuthRequestStatus(1), 'not-requested');
  assert.equal(parseAuthRequestStatus(0), 'unknown');
  ok('the numeric enum maps as Apple documents it (2 unnecessary = asked)');
}

// ---- the shapes a bridge might plausibly hand back instead ----------------
{
  assert.equal(parseAuthRequestStatus('2'), 'requested');
  assert.equal(parseAuthRequestStatus('1'), 'not-requested');
  assert.equal(parseAuthRequestStatus('0'), 'unknown');
  ok('a numeric STRING is understood — a stringifying bridge does not break it');
}

{
  assert.equal(parseAuthRequestStatus('unnecessary'), 'requested');
  assert.equal(parseAuthRequestStatus('shouldRequest'), 'not-requested');
  assert.equal(parseAuthRequestStatus('unknown'), 'unknown');
  ok('the enum spelled by name is understood too');
}

// ---- and everything else fails SAFE, one case at a time ------------------
{
  // Each of these is a distinct way the call could surprise us, and not one
  // of them may produce 'requested'. Asserted individually so a failure names
  // the shape that broke it.
  assert.equal(parseAuthRequestStatus(undefined), 'unknown', 'undefined');
  assert.equal(parseAuthRequestStatus(null), 'unknown', 'null');
  assert.equal(parseAuthRequestStatus({}), 'unknown', 'a bare object');
  assert.equal(
    parseAuthRequestStatus({ status: 2 }),
    'unknown',
    'a WRAPPED status — plausible, and still not enough to claim we asked',
  );
  assert.equal(parseAuthRequestStatus([2]), 'unknown', 'an array');
  assert.equal(parseAuthRequestStatus(true), 'unknown', 'a boolean');
  assert.equal(parseAuthRequestStatus(2.5), 'unknown', 'a non-enum number');
  assert.equal(parseAuthRequestStatus('Unnecessary'), 'unknown', 'wrong case');
  assert.equal(parseAuthRequestStatus(''), 'unknown', 'the empty string');
  ok('every unrecognised shape resolves unknown — never "requested"');
}

{
  // The asymmetry stated as its own proof, because it is the safety property
  // and not an implementation detail: 'unknown' costs one silent re-request,
  // a wrong 'requested' costs a card claiming a connection that does not
  // exist.
  const asked = [2, '2', 'unnecessary'];
  const everythingElse = [
    0, 1, '0', '1', 'shouldRequest', 'unknown', undefined, null, {},
    { status: 2 }, [2], true, false, 2.5, NaN, '', 'UNNECESSARY', -2,
  ];
  for (const v of asked) {
    assert.equal(parseAuthRequestStatus(v), 'requested');
  }
  for (const v of everythingElse) {
    assert.notEqual(
      parseAuthRequestStatus(v),
      'requested',
      `${String(v)} must never be read as "this device has been asked"`,
    );
  }
  ok(`only ${asked.length} exact values mean "asked"; ${everythingElse.length} others cannot`);
}

// ---- the privacy line, checked in the source -----------------------------
{
  // The diagnostic records an OS authorization enum. A future edit that put a
  // step count or a weight into it would breach the rule that HealthKit
  // values are never logged, and it would do so somewhere nobody is looking.
  const service = readFileSync(path.join(src, 'services', 'HealthService.ts'), 'utf8');
  // From the REAL implementation, not NullHealthService's one-line stub —
  // which is what an unanchored indexOf finds first, and which would have
  // passed the forbidden-token loop while proving nothing at all.
  const cls = service.indexOf('class HealthKitService');
  assert.ok(cls > 0, 'HealthKitService not found');
  const start = service.indexOf('async getAuthRequestStatus', cls);
  assert.ok(start > cls, 'the real getAuthRequestStatus not found');
  // Brace-matched rather than anchored on whatever method happens to follow:
  // an anchor drifts the moment the file is reordered, and a slice that
  // quietly swallowed the read methods would fail this check for the wrong
  // reason — which is exactly what it did the first time it was written.
  const open = service.indexOf('{', start);
  let depth = 0;
  let end = open;
  for (let i = open; i < service.length; i += 1) {
    if (service[i] === '{') depth += 1;
    else if (service[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  const body = service.slice(start, end);
  assert.ok(body.length > 0 && end > open, 'could not delimit the method');
  for (const forbidden of [
    'getTodaySteps',
    'getLatestBodyMass',
    'getTodayWorkouts',
    'dietaryKcal',
    'bodyMass',
    'steps',
  ]) {
    assert.ok(
      !body.includes(forbidden),
      `the auth-status diagnostic must never touch ${forbidden}`,
    );
  }
  assert.ok(
    body.includes('console.warn'),
    'the raw value must be logged, or the device gate has nothing to read',
  );
  ok('the diagnostic logs an authorization enum and never a health value');
}

console.log(`\nAll ${passes} health-auth checks passed.`);
