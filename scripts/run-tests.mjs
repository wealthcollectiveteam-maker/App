/**
 * `npm test` — every Node proof in package.json, in one run, with one verdict.
 *
 * There was no aggregate before Phase 38I; each suite was run by name, and a
 * guard that is only run by name is a guard that stops running. This runs
 * every `test:*` script except the two that need something this machine may
 * not have: `test:rls` (a database) and `test:render` (a browser and a
 * built dist/, and it already runs inside `npm run build:web`).
 *
 * A failing suite fails the run. The identity guard is DESIGNED to fail
 * until the owner chooses a neutral host (see scripts/identity-guard.test.mjs),
 * so until then this run is red on purpose, and the summary says which.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const SKIP = new Set(['test:rls', 'test:render']);

const names = Object.keys(pkg.scripts).filter((s) => s.startsWith('test:') && !SKIP.has(s));
const results = [];
for (const name of names) {
  const r = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', '-s', name], {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const last = out
    .split(/\r?\n/)
    .filter((l) => l.trim() && !/MODULE_TYPELESS|Reparsing|To eliminate|trace-warnings/.test(l))
    .pop() ?? '';
  results.push({ name, code: r.status ?? 1, last });
  console.log(`${r.status === 0 ? 'PASS' : 'FAIL'}  ${name.padEnd(24)} ${last}`);
}
const failed = results.filter((r) => r.code !== 0);
console.log(`\n${results.length - failed.length} of ${results.length} suites passed.`);
if (failed.length) {
  console.log(`failed: ${failed.map((f) => f.name).join(', ')}`);
  process.exit(1);
}
