/**
 * THE SITE'S ORIGIN, read from the one place it lives (Phase 38J).
 *
 * `src/constants/legal.ts` holds PUBLIC_SITE_ORIGIN. The scripts that need
 * the host — which Pages folder to deploy into, where the old address
 * forwards to — read that file's TEXT rather than importing it, so a script
 * copied into a sandbox without `src/` (scripts/pages-guard.test.mjs does
 * exactly that) gets `null` and falls back, instead of failing to resolve
 * an import. One regex, one constant, no second copy of the name.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The origin, e.g. `https://rankedfitness.github.io`, or null if unreadable. */
export function readSiteOrigin(root) {
  const file = join(root, 'src', 'constants', 'legal.ts');
  if (!existsSync(file)) return null;
  const m = readFileSync(file, 'utf8').match(/PUBLIC_SITE_ORIGIN\s*=\s*['"](https?:\/\/[^'"]+)['"]/);
  return m ? m[1].replace(/\/$/, '') : null;
}

/** The Pages folder name that serves `origin`: its host, e.g. `rankedfitness.github.io`. */
export function pagesFolderFor(origin) {
  if (!origin) return null;
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}
