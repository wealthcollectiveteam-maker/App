/**
 * `npm run build:redirect` — generate `redirect-site/`, the whole content of
 * the OLD Pages repo once the app has moved (Phase 38J, J2). Never
 * hand-edited: the origin is read from src/constants/legal.ts, the files are
 * written from scripts/lib/redirectSite.mjs, and scripts/redirect-site.test.mjs
 * proves what they do in a real browser.
 *
 * Output: index.html, 404.html (identical), .nojekyll. Nothing else — no
 * bundle, no manifest, nothing personal beyond being served from the old
 * address.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { redirectHtml } from './lib/redirectSite.mjs';
import { readSiteOrigin } from './lib/siteOrigin.mjs';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const out = join(root, 'redirect-site');
const origin = readSiteOrigin(root);
if (!origin) {
  console.error('build-redirect — cannot read PUBLIC_SITE_ORIGIN from src/constants/legal.ts');
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const html = redirectHtml(origin);
writeFileSync(join(out, 'index.html'), html);
writeFileSync(join(out, '404.html'), html);
writeFileSync(join(out, '.nojekyll'), '');

console.log(`redirect-site/ written — every path forwards to ${origin}`);
console.log(`  ${readdirSync(out).sort().join(', ')}`);
