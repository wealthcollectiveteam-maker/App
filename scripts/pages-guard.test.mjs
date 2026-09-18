/**
 * Proofs for THE DESTINATION GATE (scripts/lib/pagesGuard.mjs and
 * scripts/pages-check.mjs).
 *
 *   node scripts/pages-guard.test.mjs
 *
 * The standard here is the one dist-guard.test.mjs set: a guard nobody has
 * seen fail is not a guard. So this does not assert that pages-check WOULD
 * refuse a dirty tree. It builds a real git repository in a temp directory,
 * commits a site into it, pushes that to a real bare "origin", then
 * reproduces — file for file — the exact state the Pages repo was found in on
 * 2026-09-05:
 *
 *   - 20 tracked .html files whose only change is the bundle hash
 *   - a modified version.json
 *   - two untracked entry-<hex>.js bundles, one of them unreferenced
 *
 * ...and runs the actual script against it, from a child process, and checks
 * that it exits 1 and names the right things. Then it resets that same repo
 * to origin and proves the script exits 0 — because a gate that refuses
 * everything gets switched off within a week, and a gate that has only ever
 * been seen refusing has never been shown to pass.
 *
 * The --after phase gets the same treatment: a tree whose index.html points
 * at a bundle that is not on disk is the blank page this project has already
 * shipped once, so it is built and refused here.
 *
 * Everything is created under os.tmpdir() and removed afterwards. Nothing
 * touches the real Pages repo.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  bundleRefsIn,
  checkDestinationClean,
  checkPublishedTree,
  parseStatusV2,
} from './lib/pagesGuard.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const CHECK = path.join(here, 'pages-check.mjs');

let passes = 0;
function ok(label) {
  passes += 1;
  console.log(`PASS: ${label}`);
}

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed in ${cwd}:\n${r.stderr}`);
  }
  return r.stdout;
}

function runCheck(mode, pagesPath) {
  return spawnSync(
    process.execPath,
    [CHECK, mode, '--pages', pagesPath],
    { cwd: root, encoding: 'utf8' },
  );
}

// =========================================================================
// Part 1 — the pure functions, on the shapes that actually occurred
// =========================================================================

// The porcelain-v2 fields git emits for the state found on 2026-09-05, with
// the paths that make v1's quoting unusable: "(tabs)/" and "+not-found.html".
{
  const out = [
    '# branch.oid bcfd67f',
    '# branch.head main',
    '# branch.upstream origin/main',
    '# branch.ab +0 -0',
    '1 .M N... 100644 100644 100644 aaa bbb (tabs)/index.html',
    '1 .M N... 100644 100644 100644 aaa bbb +not-found.html',
    '1 .M N... 100644 100644 100644 aaa bbb version.json',
    '? _expo/static/js/web/entry-d3e035cbcdf87f3a6e2735688c3198af.js',
    '? _expo/static/js/web/entry-db9006d6a97b6b927a3ab37b4dc46cf6.js',
    '',
  ].join('\0');

  const s = parseStatusV2(out);
  assert.equal(s.branch, 'main');
  assert.equal(s.upstream, 'origin/main');
  assert.equal(s.ahead, 0);
  assert.equal(s.behind, 0);
  assert.deepEqual(
    s.changed.map((c) => c.path),
    ['(tabs)/index.html', '+not-found.html', 'version.json'],
  );
  assert.equal(s.untracked.length, 2);
  ok('porcelain v2 parses the real shapes, "(tabs)/" and "+not-found.html" intact');

  const problems = checkDestinationClean(s, { expectedBranch: 'main' });
  assert.equal(problems.length, 2, 'modified files and untracked files');
  assert.match(problems.join('\n'), /3 tracked file\(s\)/);
  assert.match(problems.join('\n'), /2 untracked file\(s\)/);
  ok('a dirty tree is refused, and the count of each kind is named');
}

// A clean tree passes. Without this the gate above proves nothing.
{
  const s = parseStatusV2(
    ['# branch.head main', '# branch.upstream origin/main', '# branch.ab +0 -0', ''].join('\0'),
  );
  assert.deepEqual(checkDestinationClean(s, { expectedBranch: 'main' }), []);
  ok('a clean tree level with its upstream passes');
}

// Ahead, behind, no upstream, wrong branch — each refused on its own.
{
  const mk = (lines) => parseStatusV2([...lines, ''].join('\0'));
  const ahead = checkDestinationClean(
    mk(['# branch.head main', '# branch.upstream origin/main', '# branch.ab +2 -0']),
  );
  assert.match(ahead.join(), /2 commit\(s\) AHEAD/);

  const behind = checkDestinationClean(
    mk(['# branch.head main', '# branch.upstream origin/main', '# branch.ab +0 -3']),
  );
  assert.match(behind.join(), /3 commit\(s\) BEHIND/);

  const noUpstream = checkDestinationClean(mk(['# branch.head main']));
  assert.match(noUpstream.join(), /no upstream/);

  const wrongBranch = checkDestinationClean(
    mk(['# branch.head gh-pages', '# branch.upstream origin/gh-pages', '# branch.ab +0 -0']),
    { expectedBranch: 'main' },
  );
  assert.match(wrongBranch.join(), /not "main"/);

  const detached = checkDestinationClean(
    mk(['# branch.head (detached)', '# branch.ab +0 -0']),
  );
  assert.match(detached.join(), /detached HEAD/);
  ok('ahead, behind, no upstream, wrong branch and detached HEAD each refuse');
}

// The blank-page post-condition: index.html naming a bundle that is not there.
{
  const problems = checkPublishedTree({
    rootEntries: ['index.html', '404.html', '.nojekyll', 'version.json', 'manifest.json'],
    htmlRefs: { 'index.html': ['entry-d3e035cb.js'] },
    bundlesOnDisk: ['entry-c446486e.js'],
    versionJson: { buildId: 'd3e035cb', bundle: 'entry-d3e035cb.js' },
  });
  assert.match(problems.join('\n'), /index\.html loads "entry-d3e035cb\.js", which is NOT in/);
  ok('a page pointing at a bundle that is not on disk is refused — the blank page');
}

// The orphan: a bundle nobody loads. This is what three entry-*.js files in
// one site directory means, and it is the state the real repo was found in.
{
  const problems = checkPublishedTree({
    rootEntries: ['index.html', '404.html', '.nojekyll', 'version.json', 'manifest.json'],
    htmlRefs: { 'index.html': ['entry-aaa.js'] },
    bundlesOnDisk: ['entry-aaa.js', 'entry-bbb.js', 'entry-ccc.js'],
    versionJson: { buildId: 'aaa', bundle: 'entry-aaa.js' },
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /2 bundle\(s\).*that no page loads/s);
  ok('unreferenced bundles left over from a previous deploy are refused');
}

// A static page out of public/ carries no script tag BY DESIGN, and an
// exported route that has lost its script tag is still a defect. The first
// version of this check knew only the second half and refused a correct
// deploy on 2026-09-09 over privacy.html and terms.html.
{
  const base = {
    rootEntries: ['index.html', '404.html', '.nojekyll', 'version.json', 'manifest.json'],
    bundlesOnDisk: ['entry-aaa.js'],
    versionJson: { buildId: 'aaa', bundle: 'entry-aaa.js' },
  };

  assert.deepEqual(
    checkPublishedTree({
      ...base,
      htmlRefs: {
        'index.html': ['entry-aaa.js'],
        'privacy.html': [],
        'terms.html': [],
      },
      staticPages: ['privacy.html', 'terms.html'],
    }),
    [],
    'the real 2026-09-09 tree: two hand-written static pages and one route',
  );

  // The exemption is by provenance, so a ROUTE that lost its script tag is
  // still caught — that is the failure the check was written for.
  const lostTag = checkPublishedTree({
    ...base,
    htmlRefs: { 'index.html': ['entry-aaa.js'], 'track.html': [] },
    staticPages: ['privacy.html', 'terms.html'],
  });
  assert.match(lostTag.join('\n'), /1 page\(s\) name no bundle at all/);
  assert.match(lostTag.join('\n'), /track\.html/);

  // And with no public/ to read, nothing is exempt.
  const strict = checkPublishedTree({
    ...base,
    htmlRefs: { 'index.html': ['entry-aaa.js'], 'privacy.html': [] },
  });
  assert.match(strict.join('\n'), /privacy\.html/);
  ok('static pages from public/ are exempt; a route with no script tag is not');
}

// Pages from two builds mixed in one tree.
{
  const problems = checkPublishedTree({
    rootEntries: ['index.html', '404.html', '.nojekyll', 'version.json', 'manifest.json'],
    htmlRefs: { 'index.html': ['entry-aaa.js'], 'track.html': ['entry-bbb.js'] },
    bundlesOnDisk: ['entry-aaa.js', 'entry-bbb.js'],
    versionJson: { buildId: 'aaa', bundle: 'entry-aaa.js' },
  });
  assert.match(problems.join('\n'), /pages do not agree on which bundle/);
  ok('a tree mixing pages from two builds is refused');
}

// Missing .nojekyll, and version.json disagreeing with the published bundle.
{
  const noJekyll = checkPublishedTree({
    rootEntries: ['index.html', '404.html', 'version.json', 'manifest.json'],
    htmlRefs: { 'index.html': ['entry-aaa.js'] },
    bundlesOnDisk: ['entry-aaa.js'],
    versionJson: { buildId: 'aaa', bundle: 'entry-aaa.js' },
  });
  assert.match(noJekyll.join('\n'), /\.nojekyll is missing.*Jekyll/s);

  const drift = checkPublishedTree({
    rootEntries: ['index.html', '404.html', '.nojekyll', 'version.json', 'manifest.json'],
    htmlRefs: { 'index.html': ['entry-aaa.js'] },
    bundlesOnDisk: ['entry-aaa.js'],
    versionJson: { buildId: 'zzz', bundle: 'entry-zzz.js' },
  });
  assert.equal(drift.length, 2, 'bundle name and buildId each disagree');
  assert.match(drift.join('\n'), /new version ready" banner/);
  ok('a missing .nojekyll, and a version.json that disagrees, are both refused');
}

// A wholly correct tree passes.
{
  assert.deepEqual(
    checkPublishedTree({
      rootEntries: ['index.html', '404.html', '.nojekyll', 'version.json', 'manifest.json', '_expo'],
      htmlRefs: {
        'index.html': ['entry-6fa5c3a5ef565f173f729f3bb42aa62a.js'],
        '404.html': ['entry-6fa5c3a5ef565f173f729f3bb42aa62a.js'],
      },
      bundlesOnDisk: ['entry-6fa5c3a5ef565f173f729f3bb42aa62a.js'],
      versionJson: {
        buildId: '6fa5c3a5ef565f173f729f3bb42aa62a',
        bundle: 'entry-6fa5c3a5ef565f173f729f3bb42aa62a.js',
      },
    }),
    [],
  );
  ok('a correct published tree passes — the gate is not simply always-no');
}

// bundleRefsIn, on the exact tag the export writes.
{
  const html =
    '<div id="root"></div><script src="/_expo/static/js/web/' +
    'entry-6fa5c3a5ef565f173f729f3bb42aa62a.js" defer></script>';
  assert.deepEqual(bundleRefsIn(html), ['entry-6fa5c3a5ef565f173f729f3bb42aa62a.js']);
  assert.deepEqual(bundleRefsIn('<p>no script here</p>'), []);
  ok('the bundle reference is read out of the real script tag');
}

// =========================================================================
// Part 2 — THE DEMONSTRATION. A real repo, the real script, the real exits.
// =========================================================================
const OLD = 'entry-c446486e279c885c85281e579bda4799.js';
const NEW = 'entry-d3e035cbcdf87f3a6e2735688c3198af.js';
const STRAY = 'entry-db9006d6a97b6b927a3ab37b4dc46cf6.js';

/** The 20 routes the export actually writes, names and all. */
const ROUTES = [
  'index.html', '404.html', '_sitemap.html', '+not-found.html', 'auth.html',
  'celebration.html', 'checkin.html', 'finish.html', 'metrics-history.html',
  'my-challenge.html', 'squad.html', 'timer.html', 'track.html', 'you.html',
  '(tabs)/index.html', '(tabs)/checkin.html', '(tabs)/squad.html',
  '(tabs)/track.html', '(tabs)/you.html', 'settings/index.html',
];

const page = (bundleName) =>
  `<!DOCTYPE html><html><head><title>Ranked</title></head><body>` +
  `<div id="root"></div>` +
  `<script src="/_expo/static/js/web/${bundleName}" defer></script>` +
  `</body></html>\n`;

const versionFor = (bundleName) =>
  `${JSON.stringify(
    {
      buildId: bundleName.slice('entry-'.length, -'.js'.length),
      bundle: bundleName,
      builtAt: '2026-08-31T06:16:04.761Z',
      builtAtReadable: 'Mon Aug 31 2026 02:16:04 GMT-0400',
    },
    null,
    2,
  )}\n`;

function writeSite(dir, bundleName, bundles) {
  mkdirSync(path.join(dir, '_expo', 'static', 'js', 'web'), { recursive: true });
  mkdirSync(path.join(dir, '(tabs)'), { recursive: true });
  mkdirSync(path.join(dir, 'settings'), { recursive: true });
  for (const route of ROUTES) {
    writeFileSync(path.join(dir, route), page(bundleName));
  }
  writeFileSync(path.join(dir, '.nojekyll'), '');
  writeFileSync(path.join(dir, 'manifest.json'), '{"name":"Ranked Fitness"}\n');
  writeFileSync(path.join(dir, 'version.json'), versionFor(bundleName));
  for (const b of bundles) {
    writeFileSync(path.join(dir, '_expo', 'static', 'js', 'web', b), `/* ${b} */\n`);
  }
}

const tmp = mkdtempSync(path.join(tmpdir(), 'pages-guard-'));
try {
  const origin = path.join(tmp, 'origin.git');
  // Any *.github.io name satisfies the guard's "find the Pages repo" rule;
  // this one is deliberately not a person's.
  const clone = path.join(tmp, 'pages-guard-tmp.github.io');

  // A real origin, and a real clone with a real committed site on main.
  mkdirSync(origin, { recursive: true });
  git(origin, 'init', '--bare', '--initial-branch=main', '--quiet');

  mkdirSync(clone, { recursive: true });
  git(clone, 'init', '--initial-branch=main', '--quiet');
  git(clone, 'config', 'user.email', 'gate@example.invalid');
  git(clone, 'config', 'user.name', 'Pages Gate Test');
  git(clone, 'config', 'commit.gpgsign', 'false');
  writeSite(clone, OLD, [OLD]);
  git(clone, 'add', '-A');
  git(clone, 'commit', '-m', 'Deploy grace window', '--quiet');
  git(clone, 'remote', 'add', 'origin', origin);
  git(clone, 'push', '-u', 'origin', 'main', '--quiet');

  // ---- the clean case, FIRST -------------------------------------------
  // Deliberately before the dirty one. A refusal only means something if the
  // same script on the same repo has been seen to pass.
  {
    const r = runCheck('--before', clone);
    assert.equal(r.status, 0, `expected exit 0 on a clean tree, got ${r.status}\n${r.stderr}`);
    assert.match(r.stdout, /the destination is clean/);
    assert.match(r.stdout, /level with origin\/main/);
    ok('--before EXITS 0 on a real clean tree level with a real origin');
  }

  // ---- the dirty case: the 2026-09-05 state, reproduced ----------------
  {
    // A copy that was performed and never committed: every page rewritten to
    // the new bundle, version.json rewritten, the new bundle and one stale
    // one left untracked in _expo/.
    for (const route of ROUTES) writeFileSync(path.join(clone, route), page(NEW));
    writeFileSync(path.join(clone, 'version.json'), versionFor(NEW));
    for (const b of [NEW, STRAY]) {
      writeFileSync(path.join(clone, '_expo', 'static', 'js', 'web', b), `/* ${b} */\n`);
    }

    const r = runCheck('--before', clone);
    assert.equal(r.status, 1, `expected exit 1 on a dirty tree, got ${r.status}\n${r.stdout}`);
    assert.match(r.stderr, /REFUSED/);
    assert.match(r.stderr, /21 tracked file\(s\)/);
    assert.match(r.stderr, /2 untracked file\(s\)/);
    assert.match(r.stderr, /\(tabs\)\/checkin\.html/);
    assert.match(r.stderr, /Do NOT copy into this tree/);
    assert.match(r.stderr, /reset --hard origin\/main/);
    ok('--before EXITS 1 on the exact 2026-09-05 state: 21 modified + 2 untracked, named');
  }

  // ---- and it passes again once the tree is reset -----------------------
  {
    git(clone, 'reset', '--hard', 'origin/main', '--quiet');
    git(clone, 'clean', '-fdq');
    const r = runCheck('--before', clone);
    assert.equal(r.status, 0, `expected exit 0 after reset, got ${r.status}\n${r.stderr}`);
    ok('--before EXITS 0 again after reset --hard origin/main && clean -fd');
  }

  // ---- --after: the blank page, on a real tree --------------------------
  {
    // index.html rewritten to a bundle nobody copied in. This is the failure
    // that ships a site which loads nothing at all.
    writeFileSync(path.join(clone, 'index.html'), page(NEW));
    const r = runCheck('--after', clone);
    assert.equal(r.status, 1, `expected exit 1, got ${r.status}\n${r.stdout}`);
    assert.match(r.stderr, /index\.html loads "entry-d3e035[0-9a-f]*\.js", which is NOT in/);
    assert.match(r.stderr, /DO NOT COMMIT/);
    ok('--after EXITS 1 on a real tree whose index.html points at an absent bundle');
  }

  // ---- --after: an orphan bundle riding along ---------------------------
  {
    git(clone, 'checkout', '--', 'index.html');
    writeFileSync(
      path.join(clone, '_expo', 'static', 'js', 'web', STRAY),
      `/* ${STRAY} */\n`,
    );
    const r = runCheck('--after', clone);
    assert.equal(r.status, 1, `expected exit 1, got ${r.status}\n${r.stdout}`);
    assert.match(r.stderr, /1 bundle\(s\).*that no page loads/s);
    ok('--after EXITS 1 on a real tree carrying an unreferenced stale bundle');
  }
  // =======================================================================
  // Part 3 — the WIRING. `npm run predeploy` must actually reach the
  // destination half, and must fail on it.
  //
  // A gate that exists in a file nobody calls is the same as no gate. The
  // real predeploy-check.mjs cannot be exercised in place right now — it
  // reads the real dist/, which is stale the moment anything in src/ or
  // package.json is touched — and forcing it green by backdating a file
  // would be defeating the very check being demonstrated. So this stands a
  // whole miniature repo up in tmp: the three real scripts, a synthetic
  // dist/ built to pass every source check, and a real *.github.io sibling
  // for it to discover. Then it runs the real predeploy-check.mjs against a
  // clean destination and a dirty one.
  // =======================================================================
  // Its own subdirectory: findPagesRepo looks at the app's PARENT, and the
  // clone above is already a *.github.io in tmp — two of them would make the
  // gate refuse for the right reason at the wrong moment.
  const box = path.join(tmp, 'box');
  const appDir = path.join(box, 'app');
  const sandboxPages = path.join(box, 'sandbox.github.io');
  mkdirSync(path.join(appDir, 'scripts', 'lib'), { recursive: true });
  mkdirSync(path.join(appDir, 'src'), { recursive: true });
  mkdirSync(path.join(appDir, 'public'), { recursive: true });
  for (const f of ['predeploy-check.mjs', 'pages-check.mjs']) {
    copyFileSync(path.join(here, f), path.join(appDir, 'scripts', f));
  }
  for (const f of ['distGuard.mjs', 'pagesGuard.mjs']) {
    copyFileSync(path.join(here, 'lib', f), path.join(appDir, 'scripts', 'lib', f));
  }
  writeFileSync(path.join(appDir, 'app.json'), '{}\n');
  writeFileSync(path.join(appDir, 'package.json'), '{"name":"sandbox"}\n');
  writeFileSync(path.join(appDir, 'src', 'index.ts'), '// source\n');

  // A synthetic dist/ that passes every source check: both required
  // fingerprints present, no bad one, no denied build id — and written last,
  // so it is newer than every source input above.
  const SANDBOX_BUNDLE = 'entry-0123456789abcdef0123456789abcdef.js';
  writeSite(appDir + path.sep + 'dist', SANDBOX_BUNDLE, [SANDBOX_BUNDLE]);
  writeFileSync(
    path.join(appDir, 'dist', '_expo', 'static', 'js', 'web', SANDBOX_BUNDLE),
    'ps:null,activeEnergyKcal:null,workouts:null,bodyMass:null},' +
      'S={healthEnabled:!1,dietPromptEnabled:!0};\n',
  );

  // A real, clean git repo for it to find as the destination.
  mkdirSync(sandboxPages, { recursive: true });
  git(sandboxPages, 'init', '--initial-branch=main', '--quiet');
  git(sandboxPages, 'config', 'user.email', 'gate@example.invalid');
  git(sandboxPages, 'config', 'user.name', 'Pages Gate Test');
  git(sandboxPages, 'config', 'commit.gpgsign', 'false');
  writeSite(sandboxPages, OLD, [OLD]);
  git(sandboxPages, 'add', '-A');
  git(sandboxPages, 'commit', '-m', 'site', '--quiet');
  const sandboxOrigin = path.join(tmp, 'sandbox-origin.git');
  mkdirSync(sandboxOrigin, { recursive: true });
  git(sandboxOrigin, 'init', '--bare', '--initial-branch=main', '--quiet');
  git(sandboxPages, 'remote', 'add', 'origin', sandboxOrigin);
  git(sandboxPages, 'push', '-u', 'origin', 'main', '--quiet');

  const runPredeploy = (...extra) =>
    spawnSync(
      process.execPath,
      [path.join(appDir, 'scripts', 'predeploy-check.mjs'), ...extra],
      { cwd: appDir, encoding: 'utf8' },
    );

  {
    const r = runPredeploy();
    assert.equal(r.status, 0, `expected exit 0, got ${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /dist\/ is safe to copy/);
    assert.match(r.stdout, /the destination is clean/);
    ok('predeploy runs BOTH halves and exits 0 when dist/ and the destination are good');
  }

  {
    // Same good dist/. Only the destination changes.
    writeFileSync(path.join(sandboxPages, 'index.html'), page(NEW));
    writeFileSync(path.join(sandboxPages, 'stray.txt'), 'left behind\n');
    const r = runPredeploy();
    assert.equal(r.status, 1, `expected exit 1, got ${r.status}\n${r.stdout}`);
    assert.match(r.stdout, /dist\/ is safe to copy/);
    assert.match(r.stderr, /REFUSED at the destination/);
    ok('predeploy EXITS 1 on a good dist/ and a dirty destination — the H1 gap, closed');
  }

  {
    const r = runPredeploy('--source-only');
    assert.equal(r.status, 0, `expected exit 0, got ${r.status}\n${r.stderr}`);
    assert.match(r.stdout, /destination NOT checked \(--source-only\)/);
    assert.doesNotMatch(r.stdout, /the destination is clean/);
    ok('--source-only skips the destination half, and says so rather than implying a pass');
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nAll ${passes} destination-gate checks passed.`);
