/**
 * THE MIDNIGHT DAY-BOUNDARY PROOF (Phase 20).
 *
 * THE INCIDENT. At 12:20 AM on 2026-09-10, in one sitting thirteen seconds
 * long, two taps landed on day 3 and eleven landed on day 2. Nothing was
 * broken in the ordinary sense: every write succeeded, every row is valid, and
 * the user was looking at the screen the whole time.
 *
 * THE MECHANISM. The day the screen DISPLAYED and the day the database
 * RECEIVED were decided by two different clocks at two different moments:
 *
 *   - displayed: `day` in the store, from get_day_window()'s is_today row,
 *     refreshed only when the app is foregrounded (_layout.tsx AppState).
 *   - written:   nothing at all. useAppStore.ts's today branch called
 *     DataService.completeTask(key, at) with no day, api.ts sent
 *     p_day: null, and complete_task resolved
 *     `v_day := coalesce(p_day, challenge_day(c))` — the SERVER's clock, at
 *     the instant of the write.
 *
 * Between local midnight and the next foreground those two answers differ, and
 * the grace window means the older of them is still writable, so nothing
 * refuses and nothing warns.
 *
 * WHAT THIS FILE PROVES. One property, stated once and checked against both
 * implementations:
 *
 *     THE DAY WRITTEN EQUALS THE DAY THE SCREEN DISPLAYED.
 *
 * Not "a day was written". Not "the write succeeded". The same day.
 *
 * HOW "BEFORE" IS RUN. The pre-Phase-20 call sites cannot be imported here —
 * they were edited, and useAppStore.ts pulls in react-native besides. So the
 * old behaviour is modelled below, in `OLD`, from the exact lines the Stage 0
 * audit quoted; each field cites the file and line it reproduces. Run it with
 *
 *     DAY_IMPL=old node --experimental-strip-types scripts/day-boundary.test.mjs
 *
 * and the property fails. Run it with no env var and the real modules are
 * used, and it passes. The model is a faithful reproduction, not the deleted
 * code itself, and that distinction is worth keeping in mind when reading the
 * "before" output.
 *
 *   node --experimental-strip-types scripts/day-boundary.test.mjs
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

import {
  BOUNDARY_SLACK_MS,
  dayWindowIsStale,
  msUntilNextBoundary,
  scheduleDayBoundaries,
  writeDay,
} from '../src/lib/writeDay.ts';
import { dayDateLabel } from '../src/lib/dayLabel.ts';

const IMPL = process.env.DAY_IMPL === 'old' ? 'old' : 'new';

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log('PASS: ' + name);
  } catch (err) {
    failures += 1;
    console.log('FAIL: ' + name);
    console.log('      ' + err.message.split('\n')[0]);
  }
}

// ---------------------------------------------------------------------------
// THE TWO IMPLEMENTATIONS
// ---------------------------------------------------------------------------

/**
 * `coalesce(p_day, challenge_day(c))` — 0011_grace_window.sql:214, verbatim in
 * behaviour. This is the server and it is NOT changing: it is a correct
 * default for any caller that omits the day. The fix is that our client stops
 * being such a caller.
 */
function serverResolve(pDay, serverToday) {
  return pDay ?? serverToday;
}

const OLD = {
  /**
   * useAppStore.ts today branch, pre-Phase-20:
   *   `if (options?.sync !== false) DataService.completeTask(key, at);`
   * No day argument, so api.ts:294 sent `p_day: null`.
   */
  writeDay(view) {
    if (view.activeDay === 'yesterday' && view.yesterday?.open) {
      return view.yesterday.day;
    }
    return undefined;
  },
  /**
   * checkin.tsx:419-420, pre-Phase-20:
   *   `{grace ? 'Day ' + grace.day : 'Check-in'}`
   * In the default state the screen displayed NO day. Null is not a stand-in
   * here — it is the literal string 'Check-in' and the absence of any number.
   */
  displayedDay(view) {
    if (view.activeDay === 'yesterday' && view.yesterday?.open) {
      return view.yesterday.day;
    }
    return null;
  },
};

const NEW = {
  writeDay(view) {
    return writeDay(view);
  },
  /**
   * checkin.tsx now renders `{'Day ' + target}` where `target` is the SAME
   * writeDay() call. Identical expression, identical state — the two cannot
   * diverge without the callers passing different views.
   */
  displayedDay(view) {
    return writeDay(view);
  },
};

const impl = IMPL === 'old' ? OLD : NEW;

// ---------------------------------------------------------------------------
// THE SCENARIOS
// ---------------------------------------------------------------------------

/**
 * CASE 1 — 00:20, the previous day still open, a tap on the default deck.
 *
 * The client has refreshed since midnight, so it knows today is day 3, and the
 * server agrees. Day 2 closes at noon and is still open and still unfinished.
 * The user has not touched the DaySwitcher: activeDay is 'today', the default,
 * which Phase 20 explicitly does not change.
 */
const justPastMidnight = {
  activeDay: 'today',
  today: 3,
  yesterday: { day: 2, open: true },
};

/**
 * CASE 2 — the stale window. The app was foregrounded at 22:00 and left open.
 * At 00:20 the server has rolled to day 3; the client's window still says day
 * 2, because nothing refreshes it until the app is foregrounded again.
 *
 * This is the production incident. The screen was showing day 2 and the server
 * was answering day 3.
 */
const staleWindow = {
  activeDay: 'today',
  today: 2, // fetched at 22:00, before the roll
  yesterday: { day: 1, open: false },
};
const SERVER_TODAY_AT_0020 = 3;

// ---------------------------------------------------------------------------
// THE PROPERTY
// ---------------------------------------------------------------------------

check(
  'case 1 — 00:20, previous day open, default deck: written day === displayed day',
  () => {
    const displayed = impl.displayedDay(justPastMidnight);
    const written = serverResolve(impl.writeDay(justPastMidnight), 3);
    assert.equal(
      written,
      displayed,
      `wrote day ${written}, screen displayed ${displayed === null ? 'NO DAY AT ALL' : 'day ' + displayed}`,
    );
  },
);

check(
  'case 2 — stale window, tap at 00:20: written day === displayed day',
  () => {
    const displayed = impl.displayedDay(staleWindow);
    const written = serverResolve(
      impl.writeDay(staleWindow),
      SERVER_TODAY_AT_0020,
    );
    assert.equal(
      written,
      displayed,
      `wrote day ${written}, screen displayed ${displayed === null ? 'NO DAY AT ALL' : 'day ' + displayed}`,
    );
  },
);

check('the client never leaves the day to the server', () => {
  for (const view of [justPastMidnight, staleWindow]) {
    assert.notEqual(
      impl.writeDay(view),
      undefined,
      'a write path sent no day; the server would pick from its own clock',
    );
  }
});

check('switching to the open previous day writes to THAT day', () => {
  const view = { ...justPastMidnight, activeDay: 'yesterday' };
  assert.equal(impl.writeDay(view), 2);
  assert.equal(impl.displayedDay(view), 2);
});

check('the default is still today — the defect was silence, not the default', () => {
  assert.equal(impl.writeDay(justPastMidnight), justPastMidnight.today);
});

// ---------------------------------------------------------------------------
// THE SUPPORTING PARTS (new implementation only — the old one has no such code)
// ---------------------------------------------------------------------------

if (IMPL === 'new') {
  check('a yesterday the server has closed resolves back to today', () => {
    assert.equal(
      writeDay({
        activeDay: 'yesterday',
        today: 3,
        yesterday: { day: 2, open: false },
      }),
      3,
      'a stale activeDay must not write into a day the server would refuse',
    );
  });

  check('staleness is a calendar question, not an elapsed one', () => {
    assert.equal(dayWindowIsStale('2026-09-09', '2026-09-10'), true);
    assert.equal(dayWindowIsStale('2026-09-10', '2026-09-10'), false);
    assert.equal(
      dayWindowIsStale(null, '2026-09-10'),
      false,
      'nothing fetched yet is not staleness',
    );
  });

  check('the boundary timer targets the next noon or midnight, and never fires instantly', () => {
    const NY = 'America/New_York';
    // 22:00 EDT -> midnight, two hours away. 10:00 EDT -> noon, two hours away.
    assert.equal(msUntilNextBoundary(new Date('2026-09-10T02:00:00Z'), NY), 2 * 60 * 60 * 1000);
    assert.equal(msUntilNextBoundary(new Date('2026-09-10T14:00:00Z'), NY), 2 * 60 * 60 * 1000);
    assert.ok(
      msUntilNextBoundary(new Date('2026-09-10T15:59:59.999Z'), NY) >= 1000,
      'a timer scheduled for the instant it fires would spin',
    );
  });

  check('the date label names the day, in the challenge timezone', () => {
    // Day 2 closes at noon New York on 2026-09-10, so day 2 IS 2026-09-09.
    const label = dayDateLabel('2026-09-10T16:00:00Z', 'America/New_York');
    assert.ok(label, 'expected a label');
    assert.match(label, /9|September|Sept/, `got ${label}`);
    assert.match(label, /Wed/i, `expected a Wednesday, got ${label}`);
  });

  check('an unparseable boundary renders nothing rather than "Invalid Date"', () => {
    assert.equal(dayDateLabel('not-a-date', 'America/New_York'), null);
    assert.equal(dayDateLabel(null, 'America/New_York'), null);
  });

  // -------------------------------------------------------------------------
  // THE DAY MUST REACH THE RPC (Phase 24). Everything above proves the store
  // CHOOSES the right day. It proved nothing about whether that day survives
  // the trip: SupabaseDataService forwarded `day` only when it named
  // yesterday, and today's complete, uncomplete and seal went out with no day
  // at all — api.ts turns that into p_day: null and the server picks from its
  // own clock. That is the 2026-09-10 path, exactly, behind a green suite.
  //
  // STRUCTURAL, and saying so. SupabaseDataService imports react-native and
  // the Supabase client, so plain Node cannot construct one.
  //
  // ENUMERATED, NOT LISTED. The first version of this check named three
  // methods and their day positions. A day-bearing method added next month —
  // or a fourth call site on a path nobody thought of, which is how the
  // timer's write hid through Phase 20 — would have passed it silently. So
  // nothing below names a method. It derives, at every run:
  //
  //   1. from supabase/migrations: every SQL function whose p_day has a
  //      DEFAULT. Those are the ones that silently pick a day when it is
  //      omitted; a required p_day fails loudly on its own.
  //   2. every .rpc('<that function>', …) in src/ must send p_day.
  //   3. from api.ts: every method with a parameter whose name contains
  //      "day", and its position. A method that sends p_day WITHOUT such a
  //      parameter fails the check, so it cannot go blind.
  //   4. every call to one of those methods, in every file under src/, must
  //      supply that argument — and not as a literal undefined or null.
  //
  // The scanner is a set of functions so that the check after this one can
  // point it at synthetic source and prove it catches what it claims to.
  // Comments are blanked before scanning; string literals are skipped. A regex
  // literal containing a quote could still confuse it, which is why the real
  // check also refuses to pass if it finds implausibly few calls.
  // -------------------------------------------------------------------------

  /** Replace comments with spaces, keeping every newline so line numbers hold. */
  const blankComments = (src) => {
    let out = '';
    for (let i = 0; i < src.length; i += 1) {
      const ch = src[i];
      const next = src[i + 1];
      if (ch === '/' && next === '/') {
        while (i < src.length && src[i] !== '\n') {
          out += src[i] === '\r' ? '\r' : ' ';
          i += 1;
        }
        if (i < src.length) out += '\n';
      } else if (ch === '/' && next === '*') {
        out += '  ';
        i += 2;
        while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
          out += src[i] === '\n' || src[i] === '\r' ? src[i] : ' ';
          i += 1;
        }
        out += '  ';
        i += 1;
      } else if (ch === "'" || ch === '"' || ch === '`') {
        out += ch;
        i += 1;
        while (i < src.length && src[i] !== ch && (ch === '`' || src[i] !== '\n')) {
          if (src[i] === '\\') {
            out += src[i];
            i += 1;
          }
          out += src[i];
          i += 1;
        }
        if (i < src.length) out += src[i];
      } else {
        out += ch;
      }
    }
    return out;
  };

  /**
   * The top-level parts of a list that starts just after its opening bracket.
   * `angle` counts <…> as nesting, for TypeScript signatures; call arguments
   * leave it off, because there `<` is a comparison.
   */
  const splitTopLevel = (src, from, angle) => {
    const parts = [];
    let depth = 1;
    let cur = '';
    let i = from;
    for (; i < src.length; i += 1) {
      const ch = src[i];
      if (ch === "'" || ch === '"' || ch === '`') {
        let j = i + 1;
        while (j < src.length && src[j] !== ch) j += src[j] === '\\' ? 2 : 1;
        cur += src.slice(i, j + 1);
        i = j;
        continue;
      }
      if ('([{'.includes(ch) || (angle && ch === '<')) depth += 1;
      else if (')]}'.includes(ch) || (angle && ch === '>' && src[i - 1] !== '=')) depth -= 1;
      if (depth === 0) break;
      if (ch === ',' && depth === 1) {
        parts.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    if (cur.trim()) parts.push(cur.trim());
    return { parts, end: i };
  };

  const lineOf = (src, index) => src.slice(0, index).split('\n').length;

  /** SQL functions whose p_day has a default — the LATEST definition wins. */
  const defaultedDayFunctions = (sqlFiles) => {
    const latest = new Map();
    for (const sql of sqlFiles) {
      for (const m of sql.matchAll(
        /create\s+or\s+replace\s+function\s+(?:public\.)?(\w+)\s*\(([\s\S]*?)\)\s*returns/gi,
      )) {
        latest.set(m[1].toLowerCase(), /\bp_day\s+\w+\s+default\b/i.test(m[2]));
      }
    }
    return new Set([...latest].filter(([, defaulted]) => defaulted).map(([name]) => name));
  };

  /** .rpc('<fn>', …) calls to a day-defaulting function that send no p_day. */
  const rpcsMissingDay = (file, rawSrc, functions) => {
    const src = blankComments(rawSrc);
    const out = [];
    for (const m of src.matchAll(/\.rpc\(\s*['"](\w+)['"]/g)) {
      if (!functions.has(m[1].toLowerCase())) continue;
      const { parts } = splitTopLevel(src, m.index + '.rpc('.length, false);
      if (!/\bp_day\b/.test(parts[1] ?? '')) {
        out.push(`${file}:${lineOf(src, m.index)} rpc('${m[1]}') sends no p_day`);
      }
    }
    return out;
  };

  /** api.ts methods with a day-named parameter, and the ones that hide one. */
  const dayBearingMethods = (rawApiSrc) => {
    const src = blankComments(rawApiSrc);
    const members = [...src.matchAll(/^ {2}([A-Za-z_$][\w$]*): (?:async )?\(/gm)];
    const methods = new Map();
    const blind = [];
    members.forEach((m, i) => {
      const { parts, end } = splitTopLevel(src, m.index + m[0].length, true);
      const body = src.slice(end, i + 1 < members.length ? members[i + 1].index : src.length);
      const names = parts.map(
        (p) => (p.match(/^(?:\.\.\.)?\s*([A-Za-z_$][\w$]*)/) ?? [])[1] ?? '',
      );
      const days = names
        .map((param, index) => ({ position: index + 1, param }))
        .filter(({ param }) => /day/i.test(param));
      if (days.length) methods.set(m[1], days);
      else if (/\bp_day\b/.test(body)) blind.push(m[1]);
    });
    return { methods, blind };
  };

  /** Calls to a day-bearing api method that omit the day, or pass it as a literal nothing. */
  const callsMissingDay = (file, rawSrc, methods) => {
    const src = blankComments(rawSrc);
    const out = [];
    let calls = 0;
    for (const m of src.matchAll(/\bapi\.([A-Za-z_$][\w$]*)\(/g)) {
      const days = methods.get(m[1]);
      if (!days) continue;
      calls += 1;
      const { parts } = splitTopLevel(src, m.index + m[0].length, false);
      for (const { position, param } of days) {
        const arg = parts[position - 1];
        // A literal null is refused too. No day-named parameter in api.ts is
        // meant to be handed a constant nothing; if one ever is, that is a
        // decision to make out loud, here.
        if (!arg || /^(undefined|null|void 0)$/.test(arg)) {
          out.push(`${file}:${lineOf(src, m.index)} api.${m[1]}(${parts.join(', ')}) — no ${param}`);
        }
      }
    }
    return { missing: out, calls };
  };

  check('the dropped-day scanner enumerates: a new method, a fourth call site, a literal undefined and a p_day-less RPC are all caught', () => {
    // Each entry is one migration FILE; a definition never spans two files.
    const sql = [
      'create or replace function public.complete_task(p_task_key text, p_day integer default null)\nreturns void language sql as $$ select 1 $$;',
      'create or replace function public.defer_task(\n  p_task_key text,\n  p_day integer default null\n) returns void language sql as $$ select 1 $$;',
      'create or replace function public.sim_jump(p_day integer) returns void language sql as $$ select 1 $$;',
    ];
    const functions = defaultedDayFunctions(sql);
    assert.deepEqual([...functions].sort(), ['complete_task', 'defer_task'], 'a required p_day is loud already and is not listed');

    const apiSrc = [
      'export const BackendApi = {',
      '  /** `day` omitted goes as p_day: null — a comment, not a body. */',
      '  completeTask: (taskKey: TaskKey, durationSeconds?: number, day?: number) =>',
      "    sb().rpc('complete_task', { p_task_key: taskKey, p_day: day ?? null }),",
      '  // A method nobody has written yet, with a decoy "day" inside a type.',
      '  deferTask: async (taskKey: TaskKey, opts: { note: string; day: number }, day?: number) =>',
      "    sb().rpc('defer_task', { p_task_key: taskKey, p_day: day ?? null }),",
      '  hidden: (taskKey: TaskKey, when?: number) =>',
      "    sb().rpc('complete_task', { p_task_key: taskKey, p_day: when ?? null }),",
      "  forgot: (taskKey: TaskKey) => sb().rpc('defer_task', { p_task_key: taskKey }),",
      '};',
    ].join('\n');
    const { methods, blind } = dayBearingMethods(apiSrc);
    assert.deepEqual(methods.get('deferTask'), [{ position: 3, param: 'day' }], 'the day inside an object type is not the day parameter');
    assert.deepEqual(blind, ['hidden'], 'a p_day RPC with no day-named parameter must be reported, not skipped');
    assert.deepEqual(
      rpcsMissingDay('api.ts', apiSrc, functions).map((s) => s.split(' ')[0]),
      ['api.ts:10'],
      'an RPC to a day-defaulting function that sends no p_day must be reported',
    );

    const service = [
      'class S {',
      '  a() { return api.completeTask(taskKey, undefined, day); }',
      '  b() { return api.completeTask(taskKey); }',
      '  c() { return api.deferTask(k, { note: "a, b", day: 1 }); }',
      '  d() { return api.completeTask(k, 30, undefined); }',
      '  // e() { return api.completeTask(k); }',
      '}',
    ].join('\n');
    const { missing, calls } = callsMissingDay('S.ts', service, methods);
    assert.equal(calls, 4, 'the commented-out call is not a call');
    assert.deepEqual(
      missing.map((s) => s.split(' ')[0]),
      ['S.ts:3', 'S.ts:4', 'S.ts:5'],
      `got ${missing.join(' | ')}`,
    );
  });

  check('every day-bearing call in src/, derived from the migrations and api.ts, names its day', () => {
    const repo = new URL('../', import.meta.url);
    const migrations = new URL('supabase/migrations/', repo);
    const sqlFiles = readdirSync(migrations)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .map((f) => readFileSync(new URL(f, migrations), 'utf8'));
    const functions = defaultedDayFunctions(sqlFiles);
    for (const name of ['complete_task', 'uncomplete_task', 'seal_day']) {
      assert.ok(functions.has(name), `migrations: ${name} has no defaulted p_day — the SQL scan is broken, not the code`);
    }

    const srcRoot = new URL('src/', repo);
    const API = 'services/backend/api.ts';
    const { methods, blind } = dayBearingMethods(readFileSync(new URL(API, srcRoot), 'utf8'));
    assert.deepEqual(blind, [], `api.ts sends p_day from a method with no day-named parameter: ${blind.join(', ')}`);
    for (const [name, position] of [['completeTask', 3], ['uncompleteTask', 2], ['sealDay', 1]]) {
      assert.ok(
        methods.get(name)?.some((d) => d.position === position),
        `api.ts: ${name}'s day was not found at position ${position} — the scanner is broken, not the code`,
      );
    }

    const files = readdirSync(srcRoot, { recursive: true })
      .map((p) => String(p).replace(/\\/g, '/'))
      .filter((p) => /\.(ts|tsx)$/.test(p));
    let calls = 0;
    const missing = [];
    const unscannable = [];
    for (const rel of files) {
      const raw = readFileSync(new URL(rel, srcRoot), 'utf8');
      missing.push(...rpcsMissingDay(`src/${rel}`, raw, functions));
      if (rel === API) continue;
      const bare = blankComments(raw);
      if (/\bBackendApi\s*\.\s*\w+\s*\(/.test(bare) || /\}\s*=\s*(?:api|BackendApi)\b/.test(bare)) {
        unscannable.push(`src/${rel}`);
      }
      const found = callsMissingDay(`src/${rel}`, raw, methods);
      calls += found.calls;
      missing.push(...found.missing);
    }
    assert.deepEqual(unscannable, [], `api is reached in a way this scan cannot see (BackendApi.x() or destructuring): ${unscannable.join(', ')}`);
    assert.ok(calls >= 10, `only ${calls} day-bearing call(s) found in src/ — this check has gone vacuous`);
    assert.deepEqual(missing, [], `left the day to the server: ${missing.join('; ')}`);
    console.log(
      `      scanned ${files.length} files: ${functions.size} day-defaulting SQL function(s) [${[...functions].join(', ')}], ` +
        `${methods.size} day-bearing api method(s) [${[...methods.keys()].join(', ')}], ${calls} call(s)`,
    );
  });

  // -------------------------------------------------------------------------
  // DST (Phase 24). Not hypothetical: the live challenge started 2026-08-24 in
  // America/New_York and runs 75 days, so day 70 is Sunday 1 November 2026 —
  // the 25-hour day New York falls back on, mid-challenge for eleven people.
  //
  // Both helpers are pure and Node's Intl is timezone-aware, so this is proved
  // here rather than left for a phone at two in the morning.
  //
  // THE DEVICE IS DELIBERATELY NOT IN NEW YORK. The process zone is Tokyo for
  // these checks and restored after them, and every boundary is asked for in
  // America/New_York. A helper that read the phone's zone — as the old
  // msUntilLocalMidnight() did — would answer with Tokyo's noon or midnight
  // here and fail.
  //
  // Instants are written in UTC on purpose. A local-time constructor would ask
  // the very clock under test what 23:00 means.
  // -------------------------------------------------------------------------
  const HOUR = 60 * 60 * 1000;
  const NY = 'America/New_York';
  const hadTZ = Object.prototype.hasOwnProperty.call(process.env, 'TZ');
  const previousTZ = process.env.TZ;
  process.env.TZ = 'Asia/Tokyo';

  const boundaryTarget = (iso, zone = NY) => {
    const now = new Date(iso);
    const ms = msUntilNextBoundary(now, zone);
    return { ms, at: new Date(now.getTime() + ms).toISOString() };
  };

  check('DST: the device zone is Tokyo — deliberately not the challenge zone', () => {
    // Noon JST is 03:00Z. If TZ were ignored, "the phone's zone is ignored"
    // below would prove nothing while still printing PASS.
    assert.equal(
      new Date('2026-07-01T03:00:00Z').getHours(),
      12,
      'process.env.TZ was not honoured by this Node',
    );
  });

  check('DST (a): 23:00 on Sat 31 Oct 2026 targets 00:00 EDT, not an hour out', () => {
    const { ms, at } = boundaryTarget('2026-11-01T03:00:00Z'); // 23:00 EDT
    assert.equal(at, '2026-11-01T04:00:00.000Z', `targeted ${at}`);
    assert.equal(ms, 1 * HOUR);
  });

  check('DST (a, the 25-hour day): 00:30 on Sun 1 Nov targets NOON EST, 12.5 hours away', () => {
    const { ms, at } = boundaryTarget('2026-11-01T04:30:00Z'); // 00:30 EDT
    assert.equal(at, '2026-11-01T17:00:00.000Z', `targeted ${at}`);
    assert.equal(ms, 12.5 * HOUR);
  });

  check('DST (a, the 25-hour day): just past that noon, the next target is Mon 00:00 EST', () => {
    const { at } = boundaryTarget('2026-11-01T17:00:05Z'); // 12:00:05 EST
    assert.equal(at, '2026-11-02T05:00:00.000Z', `targeted ${at}`);
  });

  check('DST (b): 23:00 on Sat 13 Mar 2027 targets 00:00 EST, not an hour out', () => {
    const { ms, at } = boundaryTarget('2027-03-14T04:00:00Z'); // 23:00 EST
    assert.equal(at, '2027-03-14T05:00:00.000Z', `targeted ${at}`);
    assert.equal(ms, 1 * HOUR);
  });

  check('DST (b, the 23-hour day): 00:30 on Sun 14 Mar 2027 targets NOON EDT, 10.5 hours away', () => {
    const { ms, at } = boundaryTarget('2027-03-14T05:30:00Z'); // 00:30 EST
    assert.equal(at, '2027-03-14T16:00:00.000Z', `targeted ${at}`);
    assert.equal(ms, 10.5 * HOUR);
  });

  check("the phone's zone is ignored: 16:00 in New York is 05:00 in Tokyo, and the target is New York's midnight", () => {
    const { at } = boundaryTarget('2026-09-13T20:00:00Z');
    assert.equal(at, '2026-09-14T04:00:00.000Z', `targeted ${at}`);
  });

  check('no zone yet, or one this runtime rejects, falls back to the device zone rather than throwing', () => {
    // Tokyo's next boundary after 05:00 JST is its noon, 03:00Z.
    assert.equal(boundaryTarget('2026-09-13T20:00:00Z', null).at, '2026-09-14T03:00:00.000Z');
    assert.equal(boundaryTarget('2026-09-13T20:00:00Z', 'Not/AZone').at, '2026-09-14T03:00:00.000Z');
  });

  // ---- the scheduler _layout.tsx runs, driven by a fake clock ----
  const fakeClock = (startIso) => {
    let t = Date.parse(startIso);
    let pending = [];
    return {
      now: () => t,
      setTimeout: (run, ms) => {
        const handle = { run, at: t + ms };
        pending.push(handle);
        return handle;
      },
      clearTimeout: (handle) => {
        pending = pending.filter((p) => p !== handle);
      },
      armed: () => pending.length,
      fireNext: () => {
        pending.sort((a, b) => a.at - b.at);
        const handle = pending.shift();
        t = handle.at;
        handle.run();
        return new Date(handle.at).toISOString();
      },
    };
  };
  const plusSlack = (iso) =>
    new Date(Date.parse(iso) + BOUNDARY_SLACK_MS).toISOString();

  check('the timer re-arms after a NOON fire for MIDNIGHT and after midnight for noon — five boundaries across the 25-hour day', () => {
    const clock = fakeClock('2026-10-31T14:00:00Z'); // 10:00 EDT, Sat 31 Oct
    let fired = 0;
    scheduleDayBoundaries(() => NY, () => { fired += 1; }, clock);
    const boundaries = [
      '2026-10-31T16:00:00Z', // Sat noon EDT
      '2026-11-01T04:00:00Z', // Sun midnight EDT — the 25-hour day begins
      '2026-11-01T17:00:00Z', // Sun noon EST — thirteen hours later
      '2026-11-02T05:00:00Z', // Mon midnight EST
      '2026-11-02T17:00:00Z', // Mon noon EST
    ];
    boundaries.forEach((boundary, i) => {
      assert.equal(clock.armed(), 1, `before fire ${i + 1}: ${clock.armed()} timers armed, expected exactly 1`);
      const at = clock.fireNext();
      assert.equal(at, plusSlack(boundary), `fire ${i + 1} landed at ${at}, expected ${plusSlack(boundary)}`);
      assert.equal(fired, i + 1);
    });
    assert.equal(clock.armed(), 1, 'the loop stopped re-arming');
  });

  check('the zone is read at every arm: one that arrives after start is used from the next boundary', () => {
    const clock = fakeClock('2026-10-31T14:00:00Z'); // 23:00 JST, 10:00 EDT
    let zone = null; // not hydrated yet, so the device zone: Tokyo
    scheduleDayBoundaries(() => zone, () => { zone = NY; }, clock);
    assert.equal(clock.fireNext(), plusSlack('2026-10-31T15:00:00Z')); // Tokyo midnight
    assert.equal(clock.fireNext(), plusSlack('2026-10-31T16:00:00Z')); // then New York noon
  });

  check('stopping the timer disarms it, even from inside a fire', () => {
    const clock = fakeClock('2026-10-31T14:00:00Z');
    let stop = () => {};
    stop = scheduleDayBoundaries(() => NY, () => stop(), clock);
    clock.fireNext();
    assert.equal(clock.armed(), 0, 'a stopped timer re-armed itself');
  });

  check('a refresh that throws does not kill the timer', () => {
    const clock = fakeClock('2026-10-31T14:00:00Z');
    scheduleDayBoundaries(() => NY, () => { throw new Error('boom'); }, clock);
    assert.throws(() => clock.fireNext(), /boom/);
    assert.equal(clock.armed(), 1, 'a throwing refresh left no timer armed');
  });

  check('DST (c): day 70, Sun 1 Nov 2026 (closes noon 2 Nov EST) is labelled 1 November', () => {
    const label = dayDateLabel('2026-11-02T17:00:00Z', 'America/New_York');
    assert.match(label ?? '', /Sunday/, `got ${label}`);
    assert.match(label ?? '', /November/, `got ${label}`);
    assert.match(label ?? '', /\b1\b/, `got ${label}`);
  });

  check('DST (c): day 69, Sat 31 Oct 2026 — whose boundary IS noon on 1 Nov — is labelled 31 October', () => {
    // The boundary instant that falls ON 2026-11-01 closes the day BEFORE it.
    // Midnight to noon that morning is thirteen hours, not twelve.
    const label = dayDateLabel('2026-11-01T17:00:00Z', 'America/New_York');
    assert.match(label ?? '', /Saturday/, `got ${label}`);
    assert.match(label ?? '', /October/, `got ${label}`);
    assert.match(label ?? '', /\b31\b/, `got ${label}`);
  });

  check('DST (c, spring): the day closing at noon on Sun 14 Mar 2027 is labelled 13 March', () => {
    const label = dayDateLabel('2027-03-14T16:00:00Z', 'America/New_York');
    assert.match(label ?? '', /Saturday/, `got ${label}`);
    assert.match(label ?? '', /March/, `got ${label}`);
    assert.match(label ?? '', /\b13\b/, `got ${label}`);
  });

  if (hadTZ) process.env.TZ = previousTZ;
  else delete process.env.TZ;
}

// ---------------------------------------------------------------------------

console.log('');
if (failures) {
  console.log(
    `${failures} check(s) FAILED against the ${IMPL.toUpperCase()} implementation.`,
  );
  process.exit(1);
}
console.log(
  `All day-boundary checks passed against the ${IMPL.toUpperCase()} implementation.`,
);
