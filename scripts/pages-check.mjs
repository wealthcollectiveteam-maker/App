/**
 * THE GATE ON THE PAGES REPO — the folder dist/ is copied INTO.
 *
 *   node scripts/pages-check.mjs --before   (npm run predeploy:dest)
 *   node scripts/pages-check.mjs --after    (npm run postdeploy)
 *
 * exit 0 — proceed.
 * exit 1 — do not, and the reason is named.
 *
 * --before  refuses unless the Pages working tree is identical to its
 *           upstream. Run it before the copy. A dirty destination is the one
 *           thing predeploy-check.mjs could never see: it reads dist/, and a
 *           clean dist/ copied into a dirty folder still publishes a wrong
 *           site, because the commit takes the whole folder.
 *
 * --after   runs after the copy and BEFORE the commit, which is the last
 *           moment a wrong publish can still be caught. It asserts the
 *           post-condition on the thing about to go live: every bundle the
 *           pages load is on disk, nothing on disk is unreferenced, all pages
 *           name the same bundle, version.json agrees, and the four root
 *           files are at the root. It also diffs the tree against dist/ by
 *           content, so "the copy landed intact" is measured rather than
 *           assumed.
 *
 * FINDING THE REPO. Same rule as copy-to-pages.txt: a sibling of this repo
 * whose name ends in .github.io. If there is not exactly one, this refuses
 * rather than guessing. --pages <path> overrides.
 *
 * IT DOES NOT CONTACT GITHUB. `--before` compares against the origin/main ref
 * already in .git, and says how old that ref is, because a fetch from here
 * would be a network write to a repo that belongs to a different account and
 * is credentialed through GitHub Desktop. Pass --fetch to opt in.
 *
 * IT WRITES NOTHING, anywhere. Both modes are pure reads.
 *
 * The reasoning behind each check is in scripts/lib/pagesGuard.mjs, and
 * scripts/pages-guard.test.mjs builds a real dirty repo and a real clean one
 * and proves this tells them apart.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BUNDLE_DIR,
  bundleRefsIn,
  checkDestinationClean,
  checkPublishedTree,
  parseStatusV2,
} from './lib/pagesGuard.mjs';
import { pagesFolderFor, readSiteOrigin } from './lib/siteOrigin.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

const argv = process.argv.slice(2);
const MODE = argv.includes('--after')
  ? 'after'
  : argv.includes('--before')
    ? 'before'
    : null;
const DO_FETCH = argv.includes('--fetch');
const PAGES_ARG = argv[argv.indexOf('--pages') + 1];
const EXPECTED_BRANCH = 'main';

if (!MODE) {
  console.error(
    'pages-check — usage: node scripts/pages-check.mjs --before|--after [--pages <path>] [--fetch]',
  );
  process.exit(2);
}

function die(...lines) {
  console.error(`\npages-check ${MODE} — REFUSED.\n`);
  for (const line of lines) console.error(`  FAIL  ${line}\n`);
  console.error('Nothing has been copied, changed or committed.\n');
  process.exit(1);
}

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.error) die(`could not run git: ${r.error.message}`);
  return r;
}

// ---- find the Pages repo -------------------------------------------------
function findPagesRepo() {
  if (PAGES_ARG && argv.includes('--pages')) {
    if (!existsSync(join(PAGES_ARG, '.git'))) {
      die(`--pages ${PAGES_ARG} is not a git repository.`);
    }
    return PAGES_ARG;
  }
  const parent = dirname(root);
  let siblings;
  try {
    siblings = readdirSync(parent, { withFileTypes: true });
  } catch (e) {
    die(`cannot list ${parent} to find the Pages repo: ${e.message}`);
  }
  const found = siblings
    .filter((e) => e.isDirectory() && /\.github\.io$/i.test(e.name))
    .map((e) => join(parent, e.name))
    .filter((p) => existsSync(join(p, '.git')));

  // Phase 38J. Two Pages repos sit beside the app during the cutover — the
  // old personal one, which becomes a redirect, and the organisation's. The
  // one to deploy into is the one named after the host in
  // src/constants/legal.ts. Read from that file's text; when it is not there
  // (the sandbox in pages-guard.test.mjs), the exactly-one rule below stands.
  const wanted = pagesFolderFor(readSiteOrigin(root));
  if (wanted) {
    const named = found.find((p) => basename(p).toLowerCase() === wanted.toLowerCase());
    if (named) return named;
    die(
      `no Pages repo named ${wanted} beside ${root}. That is the host in ` +
        'src/constants/legal.ts (PUBLIC_SITE_ORIGIN); clone the organisation\'s ' +
        `${wanted} repo there, or pass --pages <path>.` +
        (found.length ? `\n      Found instead: ${found.join(', ')}` : ''),
    );
  }

  if (found.length === 0) {
    die(
      `no *.github.io git repository beside ${root}. This gate cannot check a ` +
        'destination it cannot find, and guessing one would be worse than ' +
        'refusing. Pass --pages <path> if it lives elsewhere.',
    );
  }
  if (found.length > 1) {
    die(
      `more than one *.github.io repository beside ${root}:\n      ` +
        `${found.join('\n      ')}\n      Pass --pages <path> to say which.`,
    );
  }
  return found[0];
}

const pages = findPagesRepo();

// ---- shared: walk a tree, ignoring .git ----------------------------------
function walkRelative(dir, base = dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkRelative(full, base, out);
    else out.push(relative(base, full).split(sep).join('/'));
  }
  return out;
}

const sha = (file) =>
  createHash('sha256').update(readFileSync(file)).digest('hex');

// =========================================================================
// --before : the destination must be identical to its upstream
// =========================================================================
if (MODE === 'before') {
  if (DO_FETCH) {
    const f = git(pages, ['fetch', 'origin', '--quiet']);
    if (f.status !== 0) {
      die(`git fetch origin failed in ${pages}:\n      ${f.stderr.trim()}`);
    }
  }

  const status = git(pages, [
    'status',
    '--porcelain=v2',
    '--branch',
    '-uall',
    '-z',
  ]);
  if (status.status !== 0) {
    die(`git status failed in ${pages}:\n      ${status.stderr.trim()}`);
  }

  const parsed = parseStatusV2(status.stdout);
  const problems = checkDestinationClean(parsed, {
    expectedBranch: EXPECTED_BRANCH,
  });

  // How stale is the ref we are comparing against? Not a failure — a fact the
  // reader needs in order to weigh a pass.
  let refAge = '(unknown)';
  if (parsed.upstream) {
    const when = git(pages, ['log', '-1', '--format=%cI %h', parsed.upstream]);
    if (when.status === 0) refAge = when.stdout.trim();
  }

  if (problems.length > 0) {
    console.error(`\npages-check before — REFUSED. ${pages}\n`);
    for (const p of problems) console.error(`  FAIL  ${p}\n`);
    console.error(
      `${problems.length} problem(s). Do NOT copy into this tree.\n` +
        'A deploy is a full replace; the fix is almost always to make the\n' +
        'destination match origin first:\n\n' +
        `  git -C "${pages}" fetch origin\n` +
        `  git -C "${pages}" reset --hard origin/${EXPECTED_BRANCH}\n` +
        `  git -C "${pages}" clean -fd\n\n` +
        'Read what is listed above before you run that — it deletes it.\n',
    );
    process.exit(1);
  }

  console.log('pages-check before — the destination is clean.');
  console.log(`  ${pages}`);
  console.log(`  branch ${parsed.branch}, level with ${parsed.upstream}`);
  console.log(`  upstream ref: ${refAge}${DO_FETCH ? ' (just fetched)' : ' (from .git; not fetched — pass --fetch to refresh)'}`);
  console.log('  0 modified, 0 staged, 0 untracked, 0 unmerged');
  console.log('  next: wipe it (keeping .git) and copy dist/ in');
  process.exit(0);
}

// =========================================================================
// --after : the post-condition on what is about to be committed
// =========================================================================
const rootEntries = readdirSync(pages).filter((n) => n !== '.git');

const htmlRefs = {};
for (const rel of walkRelative(pages)) {
  if (!rel.endsWith('.html')) continue;
  htmlRefs[rel] = bundleRefsIn(readFileSync(join(pages, rel), 'utf8'));
}

const bundleDirPath = join(pages, ...BUNDLE_DIR.split('/'));
let bundlesOnDisk = [];
try {
  bundlesOnDisk = readdirSync(bundleDirPath).filter((n) => n.endsWith('.js'));
} catch {
  /* reported below as "the pages load X which is not in _expo/..." */
}

let versionJson = null;
try {
  versionJson = JSON.parse(readFileSync(join(pages, 'version.json'), 'utf8'));
} catch {
  /* reported by checkPublishedTree */
}

// Pages copied verbatim out of public/ are not exported routes and carry no
// script tag. Read from public/ rather than hardcoded, so a new static page
// does not need this file edited — and so a MISSING public/ leaves the check
// strict rather than silently exempting everything.
const staticPages = existsSync(join(root, 'public'))
  ? walkRelative(join(root, 'public')).filter((f) => f.endsWith('.html'))
  : [];

// ---- did the copy land intact? -------------------------------------------
// Content, not names: robocopy skipping a file it thinks is identical is
// exactly how a stale index.html survives a deploy.
const distFiles = existsSync(dist) ? walkRelative(dist) : null;
const pagesFiles = walkRelative(pages);
const extraUnderExpo = [];
const copyProblems = [];
const copyNotes = [];

if (!distFiles) {
  copyProblems.push(
    'dist/ does not exist, so the copy cannot be verified against its source. ' +
      'Run npm run build:web.',
  );
} else {
  const inPages = new Set(pagesFiles);
  const inDist = new Set(distFiles);

  const missing = distFiles.filter((f) => !inPages.has(f));
  if (missing.length > 0) {
    copyProblems.push(
      `${missing.length} file(s) in dist/ did not make it into the Pages ` +
        `repo:\n      ${missing.slice(0, 10).join('\n      ')}` +
        (missing.length > 10 ? `\n      … and ${missing.length - 10} more` : '') +
        '\n      A `dist\\*` copy silently skips dotfiles; use robocopy dist <pages> /E.',
    );
  }

  const differing = distFiles.filter(
    (f) => inPages.has(f) && sha(join(dist, f)) !== sha(join(pages, f)),
  );
  if (differing.length > 0) {
    copyProblems.push(
      `${differing.length} file(s) differ in content between dist/ and the ` +
        `Pages repo:\n      ${differing.slice(0, 10).join('\n      ')}` +
        '\n      The tree about to be published is not the tree the source ' +
        'gate approved.',
    );
  }

  const extra = pagesFiles.filter((f) => !inDist.has(f));
  for (const f of extra) {
    if (f.startsWith('_expo/')) extraUnderExpo.push(f);
  }
  const extraElsewhere = extra.filter((f) => !f.startsWith('_expo/'));
  if (extraElsewhere.length > 0) {
    copyNotes.push(
      `${extraElsewhere.length} file(s) present in the Pages repo that dist/ ` +
        `does not produce: ${extraElsewhere.slice(0, 6).join(', ')}` +
        (extraElsewhere.length > 6 ? `, …` : '') +
        ' — expected if they are hand-maintained, wrong if they are leftovers',
    );
  }
}

const problems = [
  ...checkPublishedTree({
    rootEntries,
    htmlRefs,
    bundlesOnDisk,
    versionJson,
    extraUnderExpo,
    staticPages,
  }),
  ...copyProblems,
];

if (problems.length > 0) {
  console.error(`\npages-check after — REFUSED. ${pages}\n`);
  for (const p of problems) console.error(`  FAIL  ${p}\n`);
  console.error(
    `${problems.length} problem(s). DO NOT COMMIT this tree.\n` +
      'Nothing has been changed. Fix what is named, re-copy, run this again.\n',
  );
  process.exit(1);
}

const bundle = bundlesOnDisk[0] ?? '(none)';
// Counted apart rather than summed: "22 pages all load X" would be false —
// two of them load nothing, on purpose — and a summary line that overstates
// is the kind of evidence this project has been bitten by.
const routes = Object.entries(htmlRefs).filter(([, r]) => r.length > 0);
const statics = Object.keys(htmlRefs).length - routes.length;
console.log('pages-check after — safe to commit.');
console.log(`  ${pages}`);
console.log(
  `  ${routes.length} exported route(s) all load ${bundle}, which is on disk`,
);
if (statics > 0) {
  console.log(
    `  ${statics} static page(s) from public/ carry no bundle, by design`,
  );
}
console.log(`  ${bundlesOnDisk.length} bundle file(s) in ${BUNDLE_DIR}/, 0 orphaned`);
console.log(
  `  version.json agrees: buildId ${versionJson?.buildId}, bundle ${versionJson?.bundle}`,
);
console.log(
  `  root has ${['index.html', '404.html', '.nojekyll', 'version.json', 'manifest.json'].join(', ')}`,
);
console.log(
  `  ${distFiles?.length ?? 0} file(s) from dist/ present and byte-identical`,
);
for (const note of copyNotes) console.log(`  note: ${note}`);
console.log(`  next: commit in GitHub Desktop (${basename(pages)})`);
