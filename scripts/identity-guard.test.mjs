/**
 * THE IDENTITY GUARD (Phase 38I, I2).
 *
 * Nothing that ships in the app bundle, in `app.json`, or on the public site
 * may carry the owner's personal handle or personal email, and nothing may
 * ship a placeholder host either. This is a guard, not a proof of a fix: it
 * is EXPECTED TO FAIL until the owner chooses a neutral host for the legal
 * pages and `src/constants/legal.ts` is changed to it. Its job until then is
 * to keep failing, loudly, in the normal test run, so a build that carries
 * the handle is caught here and not by an App Reviewer.
 *
 * What it scans: every text file under src/ and public/, plus app.json and
 * eas.json. What it does not scan: docs/, scripts/, supabase/, the briefs —
 * none of it ships.
 *
 * The bundle id `com.aly786.rankedfitness` is NOT flagged: it is fixed by the
 * signing setup and cannot change (CLAUDE.md), and it is not the handle.
 *
 *   npm run test:identity
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

/** Each is a reason a file must not ship. */
const FORBIDDEN = [
  { id: 'personal-handle', pattern: /alymalji/i, why: 'the owner\'s personal GitHub handle' },
  { id: 'personal-email', pattern: /alymmalji@gmail\.com/i, why: 'the owner\'s personal email address' },
  // Only inside a URL: the word in a comment, or in the check that detects
  // it, is not a shipped host.
  { id: 'placeholder-host', pattern: /https?:\/\/[^'"`\s]*(REPLACE-ME|example\.invalid)/, why: 'a placeholder host that must not ship' },
];

const TEXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.json', '.html', '.txt', '.md', '.css', '.webmanifest']);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      walk(full, out);
    } else if (TEXT.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

const files = [
  ...walk(path.join(root, 'src')),
  ...walk(path.join(root, 'public')),
  path.join(root, 'app.json'),
  path.join(root, 'eas.json'),
].filter((f) => {
  try {
    return statSync(f).isFile();
  } catch {
    return false;
  }
});

const hits = [];
for (const file of files) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const f of FORBIDDEN) {
      if (f.pattern.test(line)) {
        hits.push({ file: path.relative(root, file).split(path.sep).join('/'), line: i + 1, id: f.id, why: f.why, text: line.trim().slice(0, 120) });
      }
    }
  });
}

console.log(`identity guard — scanned ${files.length} shipped file(s) for ${FORBIDDEN.length} pattern(s)`);
if (hits.length === 0) {
  console.log('PASS: nothing that ships carries the personal handle, the personal email, or a placeholder host');
  process.exit(0);
}
for (const h of hits) {
  console.log(`FAIL  ${h.file}:${h.line}  [${h.id}] ${h.why}\n      ${h.text}`);
}
console.log(
  `\n${hits.length} hit(s). This guard is meant to fail until the neutral host is chosen and ` +
    'src/constants/legal.ts PUBLIC_SITE_ORIGIN is changed to it. Do not ship a build while it fails.',
);
process.exit(1);
