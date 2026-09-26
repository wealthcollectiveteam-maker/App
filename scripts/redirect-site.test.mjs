/**
 * Proofs for THE OLD ADDRESS FORWARDS (Phase 38J, J2).
 *
 * Two halves. The pure one calls the exact expression the page runs with
 * three locations — `/`, `/checkin?x=1#y`, an unknown path — and asserts
 * the target. The browser one serves `redirect-site/` the way GitHub Pages
 * would (404.html for anything it does not have, path preserved), loads each
 * of the three in real Chrome with the new origin intercepted, and asserts
 * where the page actually went.
 *
 * FAIL FIRST: run before `npm run build:redirect` has ever been run, the
 * folder does not exist and this fails saying so. The browser half also
 * fails on a page whose script is broken, because it measures the
 * navigation, not the file.
 *
 *   npm run test:redirect-site
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { redirectTarget } from './lib/redirectSite.mjs';
import { readSiteOrigin } from './lib/siteOrigin.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const site = path.join(root, 'redirect-site');
const ORIGIN = readSiteOrigin(root);

let failures = 0;
let passes = 0;
function check(label, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passes += 1;
      console.log(`PASS: ${label}`);
    })
    .catch((e) => {
      failures += 1;
      console.log(`FAIL: ${label}`);
      console.log(`      ${String(e && e.message ? e.message : e).split('\n')[0]}`);
    });
}

const CASES = [
  { path: '/', target: `${ORIGIN}/` },
  { path: '/checkin?x=1#y', target: `${ORIGIN}/checkin?x=1#y` },
  { path: '/settings/does-not-exist?a=b#frag', target: `${ORIGIN}/settings/does-not-exist?a=b#frag` },
];

await check('the origin is readable from the one place it lives', () => {
  assert.ok(ORIGIN, 'PUBLIC_SITE_ORIGIN not found in src/constants/legal.ts');
  assert.doesNotMatch(ORIGIN, /alymalji/i, 'the old host is still the origin');
});

// ---- pure: the expression the page runs ---------------------------------------
for (const c of CASES) {
  await check(`redirectTarget(${c.path}) -> same path, query and hash on the new origin`, () => {
    const u = new URL(`https://old.invalid${c.path}`);
    assert.equal(redirectTarget(ORIGIN, { pathname: u.pathname, search: u.search, hash: u.hash }), c.target);
  });
}

// ---- the generated folder --------------------------------------------------------
await check('redirect-site/ exists with index.html, 404.html and .nojekyll, and nothing else', () => {
  assert.ok(existsSync(site), 'redirect-site/ does not exist — run npm run build:redirect');
  const names = readdirSync(site).sort();
  assert.deepEqual(names, ['.nojekyll', '404.html', 'index.html']);
  assert.equal(readFileSync(path.join(site, 'index.html'), 'utf8'), readFileSync(path.join(site, '404.html'), 'utf8'), 'the two pages differ');
});

await check('the page carries the three fallbacks: canonical link, meta refresh, visible link', () => {
  const html = readFileSync(path.join(site, 'index.html'), 'utf8');
  assert.match(html, new RegExp(`<link rel="canonical" href="${ORIGIN}/">`));
  assert.match(html, new RegExp(`http-equiv="refresh" content="0; url=${ORIGIN}/"`));
  assert.match(html, new RegExp(`<a href="${ORIGIN}/">`));
  assert.match(html, /location\.replace\(/, 'no location.replace — a history entry would be left behind');
  assert.doesNotMatch(html, /_expo|manifest\.json|alymalji/i, 'the redirect page carries something it should not');
});

// ---- browser: where the page actually goes ----------------------------------
async function serveLikePages() {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const wanted = path.join(site, file);
    if (existsSync(wanted) && !wanted.endsWith(path.sep)) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(readFileSync(wanted));
      return;
    }
    // GitHub Pages: 404.html, status 404, the requested path kept.
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    res.end(readFileSync(path.join(site, '404.html')));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

if (existsSync(site)) {
  let chromium = null;
  try {
    ({ chromium } = await import('playwright-core'));
  } catch {
    /* no playwright: the pure half stands alone */
  }
  let browser = null;
  if (chromium) {
    for (const channel of ['chrome', 'msedge']) {
      try {
        browser = await chromium.launch({ channel, headless: true });
        break;
      } catch {
        /* next */
      }
    }
  }
  if (!browser) {
    console.log('SKIP  no installed Chrome or Edge: the browser half did not run — this is not a pass for it.');
  } else {
    const { server, origin: local } = await serveLikePages();
    const context = await browser.newContext();
    // The new origin is not served here; answer it with a stub page and
    // record what was asked for.
    const landed = [];
    await context.route(`${ORIGIN}/**`, (route) => {
      landed.push(route.request().url());
      return route.fulfill({ status: 200, headers: { 'content-type': 'text/html' }, body: '<!doctype html><title>new</title>ok' });
    });
    await context.route(`${ORIGIN}`, (route) => {
      landed.push(route.request().url());
      return route.fulfill({ status: 200, headers: { 'content-type': 'text/html' }, body: '<!doctype html><title>new</title>ok' });
    });
    for (const c of CASES) {
      await check(`in Chrome, ${c.path} on the old address lands on ${c.target}`, async () => {
        const page = await context.newPage();
        await page.goto(`${local}${c.path}`, { waitUntil: 'load' });
        await page.waitForFunction((o) => location.origin === o, new URL(ORIGIN).origin, { timeout: 10_000 });
        assert.equal(page.url(), c.target);
        // location.replace: going back must not land on the old address.
        // (history.length is not the measure — a fresh tab's about:blank is
        // already an entry — so go back and look at where that lands.)
        await page.goBack({ waitUntil: 'commit' }).catch(() => null);
        assert.ok(
          !page.url().startsWith(local),
          `back landed on the old address (${page.url()}) — the redirect left a history entry`,
        );
        await page.close();
      });
    }
    await browser.close();
    server.close();
  }
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
