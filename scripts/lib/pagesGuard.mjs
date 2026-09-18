/**
 * THE GATE ON THE DESTINATION.
 *
 * WHY THERE IS A SECOND GUARD.
 *
 *   `distGuard.mjs` reads the artifact we build. It has nothing to say about
 *   the folder that artifact is copied INTO, and a clean `dist/` landing in a
 *   dirty Pages tree still publishes a wrong site: the commit carries whatever
 *   was already sitting there.
 *
 *   That is not hypothetical. On 2026-09-05 the Pages repo held 21 modified
 *   tracked files and 2 untracked 8.7 MB bundles, all dated 2026-08-31 07:55,
 *   from a copy that was performed and never committed. Step 4 of
 *   copy-to-pages.txt is "copy and commit" — it would have carried all 23.
 *
 * THE TWO PHASES, AND WHY THEY ARE SEPARATE.
 *
 *   BEFORE the copy — `checkDestinationClean`. The Pages working tree must
 *   equal its upstream. Not "roughly", not "only build output differs":
 *   equal. A deploy is a full replace, so anything already modified there is
 *   by definition something neither the build nor the last commit put there,
 *   and the only honest thing to do with it is refuse until it is explained.
 *
 *   AFTER the copy, before the commit — `checkPublishedTree`. The one moment
 *   a wrong publish can still be caught. It asserts the post-condition that
 *   actually matters: every bundle `index.html` names is on disk, every
 *   bundle on disk is named by some page, all pages name the SAME bundle, and
 *   `version.json` agrees with all of it.
 *
 *   That last set is not paranoia either. An `index.html` pointing at a
 *   bundle that is not in the commit is a blank page, and this project has
 *   already shipped one. The orphan-bundle check is the mirror image: an
 *   unreferenced `entry-*.js` in the tree is a previous deploy that was never
 *   cleaned up, which is how the 2026-08-31 state accumulated three bundles
 *   for one site.
 *
 * PURE. No fs, no child_process, no network — the driver in
 * `scripts/pages-check.mjs` does the I/O and hands the results in, so
 * `scripts/pages-guard.test.mjs` can build a dirty tree and a clean one and
 * prove the gate tells them apart rather than asserting that it would.
 */

/** Files the published root is broken or blank without. */
export const REQUIRED_ROOT_FILES = [
  'index.html',
  '404.html',
  '.nojekyll',
  'version.json',
  'manifest.json',
];

/** Where the Expo web export puts its JS. */
export const BUNDLE_DIR = '_expo/static/js/web';

/** `<script src="/_expo/static/js/web/entry-<hex>.js">`, however it is spelt. */
const BUNDLE_REF = /entry-[0-9a-f]+\.js/g;

/**
 * Pull every bundle filename an HTML file names.
 *
 * Filename, not path: the export writes the src as an absolute site path but
 * a future export need not, and the question being asked is "is this file on
 * disk", which is a question about the name.
 *
 * @param {string} html
 * @returns {string[]} unique bundle basenames, in first-seen order
 */
export function bundleRefsIn(html) {
  return [...new Set(html.match(BUNDLE_REF) ?? [])];
}

/**
 * Parse `git status --porcelain=v2 --branch -z` into the few facts the gate
 * needs.
 *
 * v2 rather than v1 because v1 cannot say whether the branch is ahead of or
 * behind its upstream, and a tree that is clean but three commits behind
 * `origin/main` is still the wrong base to commit a deploy onto.
 *
 * `-z` because Pages exports paths like `(tabs)/index.html` and
 * `+not-found.html`, which the default quoting mangles.
 *
 * @param {string} out  raw stdout, NUL-separated
 */
export function parseStatusV2(out) {
  const fields = out.split('\0');
  const state = {
    branch: null,
    upstream: null,
    ahead: null,
    behind: null,
    changed: [],
    untracked: [],
    unmerged: [],
    ignored: [],
  };

  for (let i = 0; i < fields.length; i += 1) {
    const line = fields[i];
    if (line === '') continue;

    if (line.startsWith('# branch.head ')) {
      state.branch = line.slice('# branch.head '.length);
    } else if (line.startsWith('# branch.upstream ')) {
      state.upstream = line.slice('# branch.upstream '.length);
    } else if (line.startsWith('# branch.ab ')) {
      const m = line.match(/^# branch\.ab \+(\d+) -(\d+)$/);
      if (m) {
        state.ahead = Number(m[1]);
        state.behind = Number(m[2]);
      }
    } else if (line.startsWith('1 ')) {
      // 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
      state.changed.push({ xy: line.slice(2, 4), path: line.split(' ').slice(8).join(' ') });
    } else if (line.startsWith('2 ')) {
      // 2 <XY> ... <path>, and the ORIGINAL path is the next NUL field.
      state.changed.push({
        xy: line.slice(2, 4),
        path: line.split(' ').slice(9).join(' '),
        renamedFrom: fields[i + 1],
      });
      i += 1;
    } else if (line.startsWith('u ')) {
      state.unmerged.push(line.split(' ').slice(10).join(' '));
    } else if (line.startsWith('? ')) {
      state.untracked.push(line.slice(2));
    } else if (line.startsWith('! ')) {
      state.ignored.push(line.slice(2));
    }
  }
  return state;
}

/** Print at most `limit` paths, indented, and say how many were held back. */
function listFew(paths, limit = 8) {
  const shown = paths.slice(0, limit).join('\n      ');
  return paths.length > limit
    ? `${shown}\n      … and ${paths.length - limit} more`
    : shown;
}

/**
 * Is the destination safe to copy into?
 *
 * @param {ReturnType<typeof parseStatusV2>} status
 * @param {{expectedBranch?: string}} [opts]
 * @returns {string[]} problems; empty means clean
 */
export function checkDestinationClean(status, opts = {}) {
  const problems = [];
  const { expectedBranch } = opts;

  if (status.branch === null || status.branch === '(detached)') {
    problems.push(
      'the Pages repo is not on a branch (detached HEAD). A commit made here ' +
        'would not be on any branch and would not publish.',
    );
  } else if (expectedBranch && status.branch !== expectedBranch) {
    problems.push(
      `the Pages repo is on branch "${status.branch}", not "${expectedBranch}". ` +
        'GitHub Pages publishes one branch; a deploy committed anywhere else ' +
        'goes nowhere.',
    );
  }

  if (!status.upstream) {
    problems.push(
      `branch "${status.branch}" has no upstream. There is nothing to compare ` +
        'the tree against, so "clean" cannot be established at all.',
    );
  } else {
    if (status.ahead > 0) {
      problems.push(
        `the Pages repo is ${status.ahead} commit(s) AHEAD of ${status.upstream}. ` +
          'Something has been committed here and not pushed. Find out what it ' +
          'is before adding a deploy on top of it.',
      );
    }
    if (status.behind > 0) {
      problems.push(
        `the Pages repo is ${status.behind} commit(s) BEHIND ${status.upstream}. ` +
          'The deploy would be committed onto a stale base. Pull first.',
      );
    }
  }

  if (status.unmerged.length > 0) {
    problems.push(
      `${status.unmerged.length} unmerged path(s) in the Pages repo: ` +
        `${status.unmerged.join(', ')}. Resolve the merge before deploying.`,
    );
  }

  if (status.changed.length > 0) {
    problems.push(
      `${status.changed.length} tracked file(s) in the Pages repo differ from ` +
        `${status.upstream ?? 'HEAD'}. A deploy is a full replace, so nothing ` +
        'here should already be modified — these came from somewhere neither ' +
        'the build nor the last commit put them, and committing the copy ' +
        `would carry them along:\n      ${listFew(status.changed.map((c) => c.path))}`,
    );
  }

  if (status.untracked.length > 0) {
    problems.push(
      `${status.untracked.length} untracked file(s) in the Pages repo. ` +
        'Untracked build output is the shape a half-finished deploy leaves ' +
        'behind, and `git add -A` would publish every one of them:' +
        `\n      ${listFew(status.untracked)}`,
    );
  }

  return problems;
}

/**
 * The post-condition on what is about to be published.
 *
 * @param {object} tree
 * @param {string[]} tree.rootEntries              names directly under the root
 * @param {Record<string,string[]>} tree.htmlRefs  html path → bundles it names
 * @param {string[]} tree.bundlesOnDisk            basenames in BUNDLE_DIR
 * @param {object|null} tree.versionJson           parsed version.json, or null
 * @param {string[]} [tree.extraUnderExpo]         _expo/ files dist/ lacks
 * @param {string[]} [tree.staticPages]  .html paths that come from public/ and
 *   are therefore NOT exported routes — see the no-bundle check below
 * @returns {string[]} problems; empty means safe to commit
 */
export function checkPublishedTree(tree) {
  const {
    rootEntries,
    htmlRefs,
    bundlesOnDisk,
    versionJson,
    extraUnderExpo = [],
    staticPages = [],
  } = tree;
  const isStatic = new Set(staticPages);
  const problems = [];
  const root = new Set(rootEntries);

  for (const file of REQUIRED_ROOT_FILES) {
    if (!root.has(file)) {
      problems.push(
        `${file} is missing from the ROOT of the Pages repo.` +
          (file === '.nojekyll'
            ? ' Without it GitHub Pages runs Jekyll, which drops every path' +
              ' starting with an underscore — and the whole bundle lives under' +
              ' _expo/. The site would load blank.'
            : ''),
      );
    }
  }

  const pageNames = Object.keys(htmlRefs);
  if (pageNames.length === 0) {
    problems.push('no .html files in the Pages repo — there is no site here.');
    return problems;
  }

  const onDisk = new Set(bundlesOnDisk);
  const referenced = new Set();
  const pagesWithNoRef = [];

  for (const [page, refs] of Object.entries(htmlRefs)) {
    if (refs.length === 0) {
      // A page carrying no script tag is only wrong if it was supposed to be
      // an exported ROUTE. public/privacy.html and public/terms.html are
      // hand-written and copied verbatim by the export, and have no bundle by
      // design — the first version of this check did not know that and
      // refused a perfectly good deploy on 2026-09-09. A gate that refuses
      // every correct build is a gate that gets switched off, so the
      // exemption is by provenance (is this file in public/) rather than by
      // name, and an empty staticPages list keeps the strict behaviour.
      if (!isStatic.has(page)) pagesWithNoRef.push(page);
      continue;
    }
    for (const ref of refs) {
      referenced.add(ref);
      if (!onDisk.has(ref)) {
        problems.push(
          `${page} loads "${ref}", which is NOT in ${BUNDLE_DIR}/. ` +
            'A page whose script tag points at a file that is not published ' +
            'is a blank screen, and that has already happened once here.',
        );
      }
    }
  }

  if (pagesWithNoRef.length > 0) {
    problems.push(
      `${pagesWithNoRef.length} page(s) name no bundle at all:\n      ` +
        `${listFew(pagesWithNoRef)}\n      An exported route always carries ` +
        'its script tag; one that does not was written by something other ' +
        'than the export.',
    );
  }

  if (referenced.size > 1) {
    problems.push(
      `the pages do not agree on which bundle to load — ${referenced.size} ` +
        `different ones are referenced: ${[...referenced].join(', ')}. One ` +
        'export produces one bundle; more than one means pages from two ' +
        'different builds are mixed in this tree.',
    );
  }

  const orphans = bundlesOnDisk.filter((b) => !referenced.has(b));
  if (orphans.length > 0) {
    problems.push(
      `${orphans.length} bundle(s) in ${BUNDLE_DIR}/ that no page loads: ` +
        `${orphans.join(', ')}. These are previous deploys that were never ` +
        'cleaned up. They are dead weight in the repo forever once committed, ' +
        'and their presence means step 2 (wipe the destination) did not run.',
    );
  }

  if (extraUnderExpo.length > 0) {
    problems.push(
      `${extraUnderExpo.length} file(s) under _expo/ that this dist/ did not ` +
        `produce:\n      ${listFew(extraUnderExpo)}\n      ` +
        'The published bundle directory must contain exactly what was built.',
    );
  }

  if (!versionJson) {
    problems.push('version.json is missing or unreadable at the Pages root.');
  } else {
    const only = referenced.size === 1 ? [...referenced][0] : null;
    if (only && versionJson.bundle !== only) {
      problems.push(
        `version.json names bundle "${versionJson.bundle}" but the pages load ` +
          `"${only}". The app reads version.json to decide whether it is ` +
          'running the current build; a disagreement here shows every user a ' +
          '"new version ready" banner that updating cannot clear.',
      );
    }
    const hash = only?.match(/^entry-([0-9a-f]+)\.js$/)?.[1];
    if (hash && versionJson.buildId !== hash) {
      problems.push(
        `version.json buildId is "${versionJson.buildId}" but the published ` +
          `bundle's hash is "${hash}". Same consequence as above.`,
      );
    }
  }

  return problems;
}
