/**
 * THE COPY GUARD (Phase 38O, O1g).
 *
 * PROOF describes; it never diagnoses or prescribes. Every user-facing
 * string in the proof module and its screens is read here and fails on any
 * of the banned words. "recover" is banned as advice; "recovery", the name of
 * a section, is not a word of advice and is allowed.
 *
 * Prove it works: add "better" to a string in src/lib/proof/copy.ts and run
 * this — it must fail and name the file and the word.
 *
 *   node scripts/proof-copy.test.mjs
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const BANNED = /\b(healthy|unhealthy|good|bad|great|poor|should|must|risk|risks|risky|overtrain\w*|recover|improve\w*|worse|better)\b/i;

/** The files whose strings a user can read. */
function files() {
  const out = [];
  const proofDir = path.join(root, 'src', 'lib', 'proof');
  for (const f of readdirSync(proofDir)) if (f.endsWith('.ts')) out.push(path.join(proofDir, f));
  for (const f of ['src/app/proof.tsx', 'src/app/proof-report.tsx']) {
    const p = path.join(root, f);
    if (existsSync(p)) out.push(p);
  }
  const comps = path.join(root, 'src', 'components');
  for (const f of readdirSync(comps)) if (/^Proof.*\.tsx$/.test(f)) out.push(path.join(comps, f));
  return out;
}

/**
 * Every string a person could see: quoted literals, template literals, and
 * JSX text between tags. Comments are stripped first — a comment may say
 * "should" about the code; a screen may not.
 */
function userStrings(src) {
  const noComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const out = [];
  const re = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
  let m;
  while ((m = re.exec(noComments))) {
    const s = m[1] ?? m[2] ?? m[3] ?? '';
    // Import paths and identifiers are not copy.
    if (/^(@\/|\.\.?\/|[a-z-]+$)/.test(s)) continue;
    out.push(s);
  }
  // JSX text nodes: between a closing '>' and the next '<', with letters in it.
  const jsx = noComments.match(/>([^<>{}]*[A-Za-z][^<>{}]*)</g) ?? [];
  for (const t of jsx) out.push(t.slice(1, -1));
  return out;
}

let passes = 0;
const offenders = [];
for (const file of files()) {
  const rel = path.relative(root, file).replace(/\\/g, '/');
  for (const s of userStrings(readFileSync(file, 'utf8'))) {
    const hit = s.match(BANNED);
    if (hit) offenders.push(`${rel}: "${hit[0]}" in ${JSON.stringify(s.slice(0, 80))}`);
  }
  passes += 1;
}

assert.deepEqual(offenders, [], `PROOF copy grades or prescribes:\n  ${offenders.join('\n  ')}`);
console.log(`PASS: ${passes} proof files carry no banned word (healthy, good, bad, should, overtrain, better…)`);

// The guard itself must recognise each word, or a passing run means nothing.
for (const word of ['healthy', 'unhealthy', 'good', 'bad', 'great', 'poor', 'should', 'must', 'risk', 'overtraining', 'recover', 'improved', 'worse', 'better']) {
  assert.match(`your sleep is ${word} now`, BANNED, word);
}
assert.doesNotMatch('Load & recovery', BANNED, 'the section name Recovery is not advice');
assert.doesNotMatch('Median bedtime', BANNED);
console.log('PASS: the guard catches every banned word and allows the section name Recovery');
