// Guard for the Phase 13 version stamp, run against a real dist/.
//
// The update banner rests on one property: the build id compiled into the
// bundle and the build id in version.json are the same string. If they ever
// drift, the app compares itself against something else on every foreground —
// which is either a "new version ready" banner that updating cannot clear, or
// an update nobody is ever told about. Both are the UI claiming something
// that is not true.
//
// scripts/build-web.mjs already fails the build on all of this. This exists so
// the property is also checked from outside the thing that establishes it, and
// so a later change to the export pipeline cannot quietly stop stamping.
//
// Run: npm run test:version-stamp   (after npm run build:web)
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const TOKEN = '__RANKED_BUILD_ID__';

let failures = 0;
function expect(name, actual, expected) {
  const ok = actual === expected;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`,
  );
  if (!ok) failures++;
}

if (!existsSync(dist)) {
  console.error('No dist/ — run `npm run build:web` first.');
  process.exit(1);
}

const manifestPath = join(dist, 'version.json');
expect('dist/version.json exists', existsSync(manifestPath), true);
if (!existsSync(manifestPath)) process.exit(1);

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const bundleDir = join(dist, '_expo/static/js/web');
const bundleName = readdirSync(bundleDir).find(
  (f) => f.startsWith('entry-') && f.endsWith('.js'),
);
const js = readFileSync(join(bundleDir, bundleName), 'utf8');
const hashFromFilename = bundleName.match(/^entry-([0-9a-f]+)\.js$/)?.[1];

expect('the bundle filename carries a hex hash', typeof hashFromFilename, 'string');
expect('version.json buildId === the filename hash', manifest.buildId, hashFromFilename);
expect('version.json names the bundle it came from', manifest.bundle, bundleName);
expect('the placeholder is gone from the bundle', js.includes(TOKEN), false);
expect('the bundle carries the build id', js.includes(hashFromFilename), true);
expect('builtAt parses as a date', Number.isFinite(Date.parse(manifest.builtAt ?? '')), true);

// Exactly one entry bundle: a second would mean the HTML and version.json
// could disagree about which one is current.
const entries = readdirSync(bundleDir).filter(
  (f) => f.startsWith('entry-') && f.endsWith('.js'),
);
expect('exactly one entry bundle in dist', entries.length, 1);

// Every exported route must load the bundle version.json describes. A route
// left pointing at an older hash would never see the update.
const html = readdirSync(dist, { recursive: true }).filter(
  (f) => typeof f === 'string' && f.endsWith('.html'),
);
const wrong = html.filter((f) => {
  const referenced = readFileSync(join(dist, f), 'utf8').match(/entry-[0-9a-f]+\.js/g) ?? [];
  return referenced.some((r) => r !== bundleName);
});
expect('every exported route references that bundle', wrong.join(', '), '');

console.log(
  failures
    ? `\n${failures} version-stamp check(s) FAILED.`
    : `\nVersion stamp is consistent — buildId ${manifest.buildId}, ${html.length} routes.`,
);
process.exit(failures ? 1 : 0);
