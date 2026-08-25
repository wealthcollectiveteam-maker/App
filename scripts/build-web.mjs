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
 * The "after" gate is the one that matters, and it is the only one that
 * would have caught the failure above: the environment was perfect that day
 * and the artifact was still dead. Never reduce this to the pre-flight check
 * alone — inspecting the input cannot prove anything about the output when a
 * cache sits between them.
 */
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
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

writeFileSync(join(dist, '.nojekyll'), '');
stripEmptyTitles(dist);

const index = join(dist, 'index.html');
if (!existsSync(index)) throw new Error('export produced no dist/index.html');
copyFileSync(index, join(dist, '404.html'));

const routes = readdirSync(dist, { recursive: true }).filter(
  (f) => typeof f === 'string' && f.endsWith('.html'),
);

console.log(`
dist/ is ready to copy.
  ${routes.length - 1} routes exported, plus 404.html
  ${mb(directorySize(dist))} total
  credentials verified INSIDE ${bundle.slice(root.length + 1)}
  no service_role / sb_secret_ key in the bundle
  .nojekyll written  —  without it GitHub Pages hides _expo/ and the site is blank
  404.html written   —  index.html shell; the router resolves the real path
`);
