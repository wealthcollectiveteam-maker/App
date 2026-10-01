/**
 * RUN THIS BEFORE COPYING dist/ TO THE PAGES REPO. It refuses; it does not
 * warn.
 *
 *   npm run predeploy
 *
 * exit 0 — dist/ is safe to copy, AND the Pages repo is safe to copy into.
 * exit 1 — one of those is not true, and the reason is named. Do not copy.
 *
 * TWO HALVES, AND THE SECOND ONE IS NEWER.
 *
 *   The source half is below: is this dist/ the thing we think it is. It was
 *   written first and it covers dist/ completely — and said nothing at all
 *   about the folder dist/ is copied INTO. A clean dist/ copied into a dirty
 *   Pages tree still publishes a wrong site, because step 4 commits the whole
 *   folder, not the files that were copied. On 2026-09-05 that tree held 21
 *   modified files and 2 stale 8.7 MB bundles from an uncommitted copy.
 *
 *   So the destination half — scripts/pages-check.mjs --before — runs from
 *   here, at the end, and this command is not green until both are. It is
 *   invoked rather than inlined because the destination is also checked AFTER
 *   the copy (--after), from the same file, against the same rules.
 *
 *   --source-only skips it. That exists for exactly one caller: a run made
 *   after the copy, when the destination is dirty BY CONSTRUCTION and the
 *   question being asked is only about dist/.
 *
 * The reasoning for every check is in scripts/lib/distGuard.mjs. The short
 * version: a build made partway through phase 17A2 stamps a false Apple
 * Health grant onto every account that signs in, one of those was sitting in
 * this repo's dist/ for a whole phase, and the only thing stopping it going
 * out was a sentence in a checklist.
 *
 * This does NOT re-run the bundler. It inspects what is actually on disk,
 * which is the thing that gets copied — a check that rebuilt first would be
 * checking something other than the artifact.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  checkBuildId,
  checkFingerprints,
  checkStaleness,
} from './lib/distGuard.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

/** Everything a web build is made of. A change to any of these stales dist/. */
const SOURCE_INPUTS = ['src', 'public', 'app.json', 'package.json'];

/** Files the Pages site is blank without — step 1 of copy-to-pages.txt. */
const REQUIRED_FILES = ['index.html', '404.html', '.nojekyll', 'manifest.json'];

const problems = [];
const notes = [];

function walk(path, onFile) {
  let entries;
  try {
    entries = readdirSync(path, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(path, entry.name);
    if (entry.isDirectory()) walk(full, onFile);
    else onFile(full);
  }
}

function newestMtime(path) {
  let newest = 0;
  const consider = (file) => {
    try {
      const ms = statSync(file).mtimeMs;
      if (ms > newest) newest = ms;
    } catch {
      /* a file that vanished mid-walk cannot be the newest one */
    }
  };
  try {
    if (statSync(path).isDirectory()) walk(path, consider);
    else consider(path);
  } catch {
    /* absent input contributes nothing */
  }
  return newest;
}

// ---- 0. dist/ exists and is shaped like a deployable site -----------------
let distStat;
try {
  distStat = statSync(dist);
} catch {
  console.error('predeploy — FAIL: dist/ does not exist. Run npm run build:web.');
  process.exit(1);
}
if (!distStat.isDirectory()) {
  console.error('predeploy — FAIL: dist/ is not a directory.');
  process.exit(1);
}

for (const file of REQUIRED_FILES) {
  try {
    statSync(join(dist, file));
  } catch {
    problems.push(
      `dist/${file} is missing.` +
        (file === '.nojekyll'
          ? ' Without it GitHub Pages runs Jekyll, which deletes every path' +
            ' starting with an underscore — and the whole bundle lives under' +
            ' _expo/. The site would load blank.'
          : ''),
    );
  }
}

// ---- 1. staleness: was dist/ built from what is on disk now? --------------
const distMs = newestMtime(dist);
let newestSource = 0;
let newestSourceFile = '(none)';
for (const input of SOURCE_INPUTS) {
  const path = join(root, input);
  const ms = newestMtime(path);
  if (ms > newestSource) {
    newestSource = ms;
    newestSourceFile = input;
  }
}
const { stale, behindSeconds } = checkStaleness(distMs, newestSource);
if (stale) {
  problems.push(
    `dist/ is STALE — ${behindSeconds}s older than the newest source ` +
      `(${newestSourceFile}). It was not produced by the code on disk. ` +
      `Run npm run build:web and check the buildId changes.`,
  );
} else {
  notes.push(`dist/ is newer than every source input (by ${-behindSeconds}s)`);
}

// ---- 2. the JS, read once ------------------------------------------------
const jsFiles = [];
walk(join(dist, '_expo'), (file) => {
  if (file.endsWith('.js')) jsFiles.push(file);
});
if (jsFiles.length === 0) {
  problems.push('dist/_expo contains no .js bundle — nothing to inspect.');
}
const bundle = jsFiles.map((f) => readFileSync(f, 'utf8')).join('\n');

// ---- 3. the named-and-shamed artifact ------------------------------------
// Every text file, not only the bundle: version.json carries the id too, and
// a copy that kept a stale version.json would tell the running app it is a
// build it is not.
let allText = bundle;
for (const extra of ['version.json', 'index.html']) {
  try {
    allText += `\n${readFileSync(join(dist, extra), 'utf8')}`;
  } catch {
    /* already reported above if it is required */
  }
}
for (const denied of checkBuildId(allText)) {
  problems.push(
    `DENIED BUILD ID "${denied}…" is present in dist/. This is the phase-17A2 ` +
      `artifact that defaults healthEnabled TRUE and writes health_enabled ` +
      `from the device. Copied to Pages against a 0013-applied database it ` +
      `stamps health_enabled = true, prefs_synced_at = now() on every account ` +
      `that signs in, and nothing afterwards can tell a seeded true from a ` +
      `chosen one. DO NOT COPY THIS. Rebuild.`,
  );
}

// ---- 4. the property checks, which survive the next bad build -------------
for (const finding of checkFingerprints(bundle)) {
  problems.push(
    finding.kind === 'present'
      ? `PRE-FIX FINGERPRINT "${finding.id}" found in the bundle. ${finding.why}`
      : `REQUIRED FINGERPRINT "${finding.id}" is ABSENT from the bundle. ${finding.why}`,
  );
}

// ---- report --------------------------------------------------------------
if (problems.length > 0) {
  console.error('\npredeploy — REFUSED. dist/ must not be copied to Pages.\n');
  for (const p of problems) console.error(`  FAIL  ${p}\n`);
  console.error(
    `${problems.length} problem(s). Nothing has been copied or changed.\n`,
  );
  process.exit(1);
}

const idMatch = allText.match(/"buildId"\s*:\s*"([a-f0-9]+)"/);
console.log('predeploy — dist/ is safe to copy.');
console.log(`  buildId ${idMatch ? idMatch[1] : '(not found)'}`);
for (const note of notes) console.log(`  ${note}`);
console.log(`  ${jsFiles.length} bundle file(s) inspected, ${REQUIRED_FILES.length} required files present`);
console.log('  no denied build id, no pre-fix fingerprint, both required fingerprints present');

// ---- the other half: is there a safe place to put it? ---------------------
// A pass above means only that the SOURCE is sound. Everything the copy will
// be committed alongside lives in the destination, and this command is not
// green until that has been looked at too.
if (process.argv.includes('--source-only')) {
  console.log('  destination NOT checked (--source-only)');
  console.log(`  next: step 2 of ${relative(root, join(root, 'copy-to-pages.txt'))}`);
  process.exit(0);
}

console.log('');
const dest = spawnSync(
  process.execPath,
  [join(root, 'scripts', 'pages-check.mjs'), '--before', ...process.argv.slice(2)],
  { stdio: 'inherit', cwd: root },
);
if (dest.status !== 0) {
  console.error(
    '\npredeploy — REFUSED at the destination. dist/ is fine; the Pages repo\n' +
      'is not. Nothing has been copied or changed.\n',
  );
  process.exit(1);
}

console.log(`\n  next: step 2 of ${relative(root, join(root, 'copy-to-pages.txt'))}`);
