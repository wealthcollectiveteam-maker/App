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
 *    near-black page with nothing in the UI to explain it. This is the
 *    single highest-consequence line in this script.
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
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

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

function directorySize(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    total += entry.isDirectory() ? directorySize(path) : statSync(path).size;
  }
  return total;
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

checkManifestColours();

// A stale dist would keep files no longer in the export — including a bundle
// hash the new HTML does not reference.
rmSync(dist, { recursive: true, force: true });

// The Expo CLI entry point, run under this same node binary. Going through
// `npx` instead would spawn a .cmd shim, which Node refuses outright on
// Windows since the CVE-2024-27980 fix.
execFileSync(
  process.execPath,
  [join(root, 'node_modules/expo/bin/cli'), 'export', '--platform', 'web'],
  { cwd: root, stdio: 'inherit' },
);

writeFileSync(join(dist, '.nojekyll'), '');

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
  .nojekyll written  —  without it GitHub Pages hides _expo/ and the site is blank
  404.html written   —  index.html shell; the router resolves the real path
`);
