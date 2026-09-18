#!/usr/bin/env node
/**
 * `npm run build:web` — one command that produces a `dist/` ready to copy
 * into the Pages repo.
 *
 * `expo export` alone is not enough for GitHub Pages. Three things have to
 * happen afterwards, and forgetting any one of them ships a broken site:
 *
 * 1. `.nojekyll`. GitHub Pages runs Jekyll over the published files, and
 *    Jekyll DROPS every path beginning with an underscore. Expo puts the
 *    entire JS bundle under `_expo/`, so without this file the HTML loads,
 *    the one <script> it needs 404s, and every visitor gets a blank
 *    near-black page with nothing in the UI to explain it.
 *
 * 2. `404.html`. Pages has no SPA fallback. It resolves `/track` to
 *    `track.html` on its own, so the nineteen exported routes are already
 *    reachable — but a trailing slash, a typo, or any route added later
 *    that has not been re-exported would hit GitHub's own 404 page. The
 *    exported HTML files are near-identical empty shells (the app renders
 *    client-side from `window.location`), so index.html serves perfectly as
 *    that fallback: whatever path it is served for, the router resolves it
 *    — a real route renders, a bad one gets the app's own not-found screen.
 *
 * 3. The colour check. `public/manifest.json` is data, not code, so it
 *    cannot import the token file the way the rest of the app must. It
 *    repeats the ground colour as a literal instead, which means it can
 *    drift. This fails the build rather than shipping an install banner and
 *    a splash screen in a colour the app stopped using.
 *
 * AND THE CREDENTIAL GATES — read this before touching them.
 *
 * A build once shipped to Pages with both Supabase credentials inlined as
 * `undefined`. Every visitor got "This build isn't configured". Nothing was
 * wrong with .env, with the code, or with this script: Metro's transform
 * cache is not keyed on the VALUES of EXPO_PUBLIC_* variables, so a single
 * earlier export run with the environment suppressed had cached
 * `supabaseClient.ts` with empty credentials baked in, and every later build
 * silently reused it. The export exits 0. It even prints
 * `env: export EXPO_PUBLIC_SUPABASE_URL …` while doing it. Nothing anywhere
 * says the artifact is dead.
 *
 * So there are two gates, and they catch different things:
 *
 *   BEFORE  — the credentials resolve at all (no .env, empty value, typo).
 *   AFTER   — the credentials are actually IN the bundle that was produced.
 *
 * AND THE VERSION STAMP. An installed Home Screen web app is suspended and
 * RESUMED by iOS rather than re-fetched, so a deploy can go unseen for ever
 * and the user has no address bar to reload from. The app therefore checks a
 * `version.json` against its own compiled-in build id — and this script is
 * the only thing that writes either of them. One hash, taken from the bundle
 * FILENAME Expo emitted, goes into the file and into the bundle in the same
 * few lines below, and gate 3 re-reads both from disk afterwards to prove
 * they match. They cannot drift apart by accident because nothing else is
 * allowed to author them.
 *
 * The "after" gate is the one that matters, and it is the only one that
 * would have caught the failure above: the environment was perfect that day
 * and the artifact was still dead. Never reduce this to the pre-flight check
 * alone — inspecting the input cannot prove anything about the output when a
 * cache sits between them.
 */
import { spawnSync, execFileSync } from 'node:child_process';
import { checkFingerprints } from './lib/distGuard.mjs';
import {
  copyFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

/** Passed through to `expo export`; the remedy for a poisoned cache. */
const CLEAR_CACHE = process.argv.includes('--clear');

const REQUIRED_ENV = [
  'EXPO_PUBLIC_SUPABASE_URL',
  'EXPO_PUBLIC_SUPABASE_ANON_KEY',
];

/** The ground colour, read from the one file allowed to define it. */
function groundColour() {
  const tokens = readFileSync(join(root, 'src/theme/tokens.ts'), 'utf8');
  const match = tokens.match(/^const bg = '(#[0-9A-Fa-f]{6})'/m);
  if (!match) throw new Error('Could not read `bg` from src/theme/tokens.ts');
  return match[1];
}

function checkManifestColours() {
  const bg = groundColour();
  const manifestPath = join(root, 'public/manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  for (const key of ['theme_color', 'background_color']) {
    if (manifest[key]?.toUpperCase() !== bg.toUpperCase()) {
      throw new Error(
        `public/manifest.json ${key} is ${manifest[key]}, but the ground in ` +
          `src/theme/tokens.ts is ${bg}. Update the manifest to match.`,
      );
    }
  }
}

/**
 * GATE 1 (before the export): the credentials resolve to something.
 *
 * `npm run` does NOT read .env — only the Expo CLI does, inside its own
 * process — so this script's own process.env is empty of them, and a plain
 * `process.env.X` check here would throw on every healthy build. Resolve
 * them the way the export will instead: @expo/env is what the CLI itself
 * uses, and a real environment variable wins over the file, exactly as
 * dotenv orders it. Returns the values so gate 2 can look for them by
 * content.
 */
async function resolveCredentials() {
  // production: the mode `expo export` bundles in, so a .env.production
  // would be read here too if one ever exists.
  process.env.NODE_ENV ??= 'production';
  const { parseProjectEnv } = await import('@expo/env');
  const { env: fromFiles, files } = parseProjectEnv(root);

  const resolved = {};
  const missing = [];
  for (const name of REQUIRED_ENV) {
    const value = process.env[name]?.trim() || fromFiles?.[name]?.trim() || '';
    if (!value) missing.push(name);
    resolved[name] = value;
  }

  if (missing.length) {
    throw new Error(
      `Missing or empty: ${missing.join(', ')}.\n\n` +
        `  Env files read: ${files?.length ? files.join(', ') : '(none found)'}\n\n` +
        `  A web build without these compiles and exports cleanly, then shows\n` +
        `  every visitor "This build isn't configured". Refusing to build one.\n` +
        `  Add the values to .env (see .env.example) and run again. Use the\n` +
        `  anon/publishable key — never service_role.`,
    );
  }
  return resolved;
}

/** The single JS bundle the exported HTML loads. */
function bundlePath() {
  const dir = join(dist, '_expo/static/js/web');
  const entry = readdirSync(dir).find(
    (f) => f.startsWith('entry-') && f.endsWith('.js'),
  );
  if (!entry) throw new Error(`No entry-*.js bundle found in ${dir}`);
  return join(dir, entry);
}

/**
 * GATE 2 (after the export): the credentials are really in the artifact.
 *
 * This is the gate that would have caught the shipped-dead build. It reads
 * the file that will actually be served and looks for the values by content,
 * so it cannot be satisfied by an environment that merely looked right.
 */
function assertCredentialsInlined(expected, bundle) {
  const js = readFileSync(bundle, 'utf8');
  const absent = REQUIRED_ENV.filter((name) => !js.includes(expected[name]));
  if (!absent.length) return;

  throw new Error(
    `The export finished, but ${absent.join(' and ')} ` +
      `${absent.length > 1 ? 'were' : 'was'} NOT inlined into the bundle.\n\n` +
      `  Bundle: ${bundle}\n\n` +
      `  This build would deploy and then tell every visitor "This build\n` +
      `  isn't configured". The usual cause is a stale Metro transform cache:\n` +
      `  it is not keyed on EXPO_PUBLIC_* VALUES, so one export run with the\n` +
      `  environment suppressed poisons every later build silently.\n\n` +
      `  Fix:  npm run build:web -- --clear`,
  );
}

/**
 * The service-role key must never reach a browser. These patterns are
 * calibrated against a known-good bundle: supabase-js itself contains the
 * bare string "sb_secret_" in its key-format validator, so only that prefix
 * FOLLOWED BY key characters counts. Legacy service-role keys are JWTs that
 * carry the role in a base64 payload rather than in plain text, so any
 * JWT-shaped literal is decoded and checked too.
 */
function assertNoSecretKey(bundle) {
  const js = readFileSync(bundle, 'utf8');
  const hits = [];

  if (/service_role/.test(js)) hits.push('the literal string "service_role"');
  if (/sb_secret_[A-Za-z0-9_-]{8,}/.test(js)) hits.push('an sb_secret_… key');

  const jwts = js.match(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}/g) ?? [];
  for (const jwt of jwts) {
    try {
      const payload = Buffer.from(jwt.split('.')[1], 'base64').toString('utf8');
      if (payload.includes('service_role')) {
        hits.push('a JWT whose payload decodes to service_role');
        break;
      }
    } catch {
      // Not a JWT after all; nothing to check.
    }
  }

  if (hits.length) {
    throw new Error(
      `SECRET KEY IN THE WEB BUNDLE — found ${hits.join(' and ')}.\n\n` +
        `  ${bundle}\n\n` +
        `  This bundle is public the moment it is deployed, and a service-role\n` +
        `  key bypasses every RLS policy in the project. Do not deploy it.\n` +
        `  Remove the key from .env, rebuild, and rotate it in Supabase.`,
    );
  }
}

/**
 * Expo's static renderer emits react-helmet's `<title data-rh="true">` into
 * every page, and no route sets one, so it lands EMPTY — and it lands above
 * the real title from `+html.tsx`. Two title elements is not an error; the
 * browser simply takes the first, so the tab reads out the bare URL. Drop
 * the empty one and the real title wins. The pattern matches only a title
 * with nothing in it, so a route that starts setting its own through
 * expo-router's <Head> is left exactly alone.
 */
const EMPTY_HELMET_TITLE = /<title data-rh="true"><\/title>/g;

function stripEmptyTitles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) stripEmptyTitles(path);
    else if (entry.name.endsWith('.html')) {
      const html = readFileSync(path, 'utf8');
      const stripped = html.replace(EMPTY_HELMET_TITLE, '');
      if (stripped !== html) writeFileSync(path, stripped);
    }
  }
}

/**
 * GATE 3 (after the export): the running app and the file it checks against
 * carry the same id.
 *
 * The id is the hash Expo put in the bundle filename. It is a hash of the
 * bundle's own bytes, so it changes exactly when the code changes and never
 * when it does not — rebuild identical source twice and no user is told an
 * update exists. A timestamp would fail that test; a hand-kept version number
 * would be forgotten.
 *
 * The stamp is applied AFTER the export, by rewriting a placeholder token
 * inside the emitted JS. That is deliberate, not a hack around a build-time
 * constant: the id IS the hash of the file, so writing it into the source
 * beforehand would change the bytes it is a hash of. Rewriting afterwards
 * leaves the filename a hash of the unstamped content — stable, and still a
 * faithful fingerprint of the code.
 *
 * Every failure here is fatal. A build that exports cleanly but ships an
 * unstamped bundle would compare `__RANKED_BUILD_ID__` against a real hash on
 * every check and show every user a permanent "new version ready" banner that
 * updating cannot clear.
 */
const BUILD_ID_TOKEN = '__RANKED_BUILD_ID__';

function stampVersion(bundle) {
  const name = bundle.slice(bundle.lastIndexOf(sep) + 1);
  const hash = name.match(/^entry-([0-9a-f]+)\.js$/)?.[1];
  if (!hash) {
    throw new Error(
      `Cannot read a build id out of the bundle filename "${name}".

` +
        `  Expected entry-<hex>.js. The version stamp derives the app's build
` +
        `  id from this hash, so without it the app cannot know which build it
` +
        `  is and the update banner cannot work. Refusing to ship an
` +
        `  unversioned build.`,
    );
  }

  const js = readFileSync(bundle, 'utf8');
  if (!js.includes(BUILD_ID_TOKEN)) {
    throw new Error(
      `The placeholder ${BUILD_ID_TOKEN} is not in the exported bundle.

` +
        `  ${bundle}

` +
        `  src/constants/build.ts is supposed to carry it as a string literal
` +
        `  for this script to rewrite. Either that file changed, or a
` +
        `  minifier folded it away. Without the rewrite the app would compare
` +
        `  the literal placeholder against a real hash on every check and show
` +
        `  a "new version ready" banner that updating can never clear.`,
    );
  }
  writeFileSync(bundle, js.split(BUILD_ID_TOKEN).join(hash));

  const builtAt = new Date();
  writeFileSync(
    join(dist, 'version.json'),
    `${JSON.stringify(
      {
        buildId: hash,
        bundle: name,
        builtAt: builtAt.toISOString(),
        builtAtReadable: builtAt.toString(),
      },
      null,
      2,
    )}
`,
  );

  return hash;
}

/** Re-read both artifacts from disk. Neither is trusted from memory. */
function assertVersionStampAgrees(bundle, hash) {
  const manifestPath = join(dist, 'version.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const js = readFileSync(bundle, 'utf8');

  const problems = [];
  if (manifest.buildId !== hash) {
    problems.push(
      `version.json buildId is ${manifest.buildId}, expected ${hash}`,
    );
  }
  if (js.includes(BUILD_ID_TOKEN)) {
    problems.push(`the placeholder ${BUILD_ID_TOKEN} survives in the bundle`);
  }
  if (!js.includes(hash)) {
    problems.push(`the bundle does not contain the id ${hash}`);
  }

  if (problems.length) {
    throw new Error(
      `VERSION STAMP MISMATCH — ${problems.join('; ')}.

` +
        `  The app would compare its own build id against a different one on
` +
        `  every foreground. Depending on which way they disagree that is
` +
        `  either an update banner nobody can clear, or an update nobody is
` +
        `  ever told about. Do not deploy this.`,
    );
  }
}

function directorySize(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    total += entry.isDirectory() ? directorySize(path) : statSync(path).size;
  }
  return total;
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

// ---------------------------------------------------------------------------

checkManifestColours();
const credentials = await resolveCredentials();

// A stale dist would keep files no longer in the export — including a bundle
// hash the new HTML does not reference.
rmSync(dist, { recursive: true, force: true });

// The Expo CLI entry point, run under this same node binary. Going through
// `npx` instead would spawn a .cmd shim, which Node refuses outright on
// Windows since the CVE-2024-27980 fix.
execFileSync(
  process.execPath,
  [
    join(root, 'node_modules/expo/bin/cli'),
    'export',
    '--platform',
    'web',
    ...(CLEAR_CACHE ? ['--clear'] : []),
  ],
  { cwd: root, stdio: 'inherit' },
);

const bundle = bundlePath();
assertCredentialsInlined(credentials, bundle);
assertNoSecretKey(bundle);

// Both artifacts of the version stamp come from this one call, and the next
// line re-reads them off disk to prove they agree.
const buildId = stampVersion(bundle);
assertVersionStampAgrees(bundle, buildId);

writeFileSync(join(dist, '.nojekyll'), '');
stripEmptyTitles(dist);

const index = join(dist, 'index.html');
if (!existsSync(index)) throw new Error('export produced no dist/index.html');
copyFileSync(index, join(dist, '404.html'));

const routes = readdirSync(dist, { recursive: true }).filter(
  (f) => typeof f === 'string' && f.endsWith('.html'),
);

// ---------------------------------------------------------------------------
// THE RENDER GATE. The last gate, and the only one that looks at the screen.
//
// Every gate above this one reads the bundle as TEXT: are the credentials in
// it, is there no secret key, does the version stamp agree. All of them were
// green on the build that shipped a Track screen with no weekly check-in card
// on it, because a card that renders nothing is a perfectly well-formed
// bundle. This one opens dist/ in a real browser and measures where things
// actually are.
//
// It runs on EVERY build rather than on request, for the same reason the
// credential check does: a gate you have to remember to run is a gate that
// stops running. If no browser is installed it says so loudly and does not
// pretend to have passed.
// ---------------------------------------------------------------------------
const render = spawnSync(
  process.execPath,
  [join(root, 'scripts', 'render-check.mjs'), dist],
  { stdio: 'inherit', cwd: root },
);
if (render.status !== 0) {
  throw new Error(
    'render check FAILED — dist/ builds but does not put the screen on screen. ' +
      'Nothing has been staged.',
  );
}

// A PRE-FIX CLIENT MUST NOT EVEN BE PRODUCED, never mind copied.
//
// scripts/predeploy-check.mjs is the gate on the copy; this is the gate on
// the build, and having both is deliberate. The copy gate is what stops a
// stale dist/ that someone forgot to rebuild. This one stops the artifact
// existing at all, so there is no window in which the dangerous file is
// sitting on disk waiting for a mistake. See scripts/lib/distGuard.mjs for
// what each fingerprint means and why it is checked as a property of the
// bundle rather than as a build id.
const guardFindings = checkFingerprints(readFileSync(bundle, 'utf8'));
if (guardFindings.length > 0) {
  throw new Error(
    'health-truthfulness gate FAILED — this bundle is a pre-fix client and ' +
      'must not be deployed:\n' +
      guardFindings
        .map(
          (f) =>
            `  ${f.kind === 'present' ? 'FOUND' : 'MISSING'}  ${f.id} — ${f.why}`,
        )
        .join('\n'),
  );
}

console.log(`
dist/ is ready to copy.
  ${routes.length - 1} routes exported, plus 404.html
  ${mb(directorySize(dist))} total
  credentials verified INSIDE ${bundle.slice(root.length + 1)}
  no service_role / sb_secret_ key in the bundle
  health-truthfulness gate passed — no pre-fix fingerprint, both fixes present
  version.json written — buildId ${buildId}, stamped into the bundle and verified
  .nojekyll written  —  without it GitHub Pages hides _expo/ and the site is blank
  404.html written   —  index.html shell; the router resolves the real path
`);
