/**
 * RENDER CHECK — the class of bug no unit test in this repo can reach.
 *
 * Everything else here asserts that a function returns the right value.
 * scripts/checkin-card.test.mjs closed one gap by making "which card should
 * show" a pure function, but it still cannot see a card that decides to
 * render and then paints at zero height, behind the tab bar, or off-screen.
 * Twice now this project has shipped exactly that: a task editor no user
 * could reach, and a tab bar eating ~55pt of the screen it sat on.
 *
 * So this loads the REAL BUILT BUNDLE from dist/ in a REAL BROWSER, over
 * HTTP, and measures pixels.
 *
 *   npm run test:render
 *
 * WHAT IT ASSERTS
 *   1. "Weekly check-in" is on the Track screen and has a non-zero box.
 *   2. The tab bar's bottom edge sits at the bottom of the viewport.
 *   3. At every scroll position, including the very bottom, no content is
 *      clipped behind the tab bar.
 *   4. The app header (RANKED + tier badge) sits at the SAME rect on every
 *      bottom tab, and its top and height are integral. Phase 33: a header
 *      that moved up and went blurry on tab switch was reported on an
 *      iPhone; a rect that shifts between tabs, or lands on a half pixel,
 *      is the measurable form of that report.
 *
 * HOW IT REACHES A SIGNED-IN SCREEN WITHOUT A SERVER
 *   A production build refuses to run on mock data — deliberately, and that
 *   refusal is not being weakened here. Instead the browser is given a
 *   session in localStorage and every Supabase request is answered locally by
 *   Playwright's router. The BUNDLE is the shipped one, unmodified; only the
 *   network beneath it is canned. If the app cannot reach 'signedIn' the run
 *   FAILS rather than quietly asserting nothing.
 *
 * BROWSER: the Chrome already installed on this machine, via playwright-core's
 * `channel`. No 150 MB browser download, and nothing to keep in sync.
 *
 * SKIPPING: if no Chrome/Edge is installed the script exits 0 with a loud
 * SKIP. A machine without a browser should not fail a build, but it must not
 * look like a pass either.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright-core';

// The dist path is the first argument that is not a flag. It used to be
// argv[2] unconditionally, so `npm run test:render -- --prove` served a
// directory named "--prove", every page 404ed, the session gate failed, and
// each sabotage was reported CAUGHT by that one gate failure — a prove mode
// that proved nothing (found in Phase 33).
const DIST =
  process.argv
    .slice(2)
    .filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--sabotage')[0] ?? 'dist';
const PROJECT_REF = 'dmlgdqufkrtrjgbofpkd';
const USER_ID = '00000000-0000-0000-0000-0000000000aa';
const VIEWPORT = { width: 390, height: 844 }; // iPhone 14 Pro logical size

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures++;
}

// ---------------------------------------------------------------------------
// A static server over dist/. No dependency: the routes are static HTML and
// the router resolves the rest, exactly as GitHub Pages serves it.
// ---------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.ttf': 'font/ttf',
  '.wav': 'audio/wav',
};

async function serve(root) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      let path = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
      if (path === '') path = 'index.html';
      let file = join(root, path);
      try {
        if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
      } catch {
        // A route with no file of its own: Pages serves <route>.html.
        file = join(root, `${path}.html`);
      }
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, port: server.address().port };
}

// ---------------------------------------------------------------------------
// The canned backend. Enough for the app to reach 'signedIn' and hydrate.
// Anything not named here answers with an empty list, which is what the
// optional reads expect when an account simply has none of that thing.
// ---------------------------------------------------------------------------
const TASKS = [
  { key: 'workout1', shortName: 'Workout 1', proof: false, target: { value: 45, unit: 'minutes' }, tierStandard: { value: 45, unit: 'minutes' } },
  { key: 'workout2', shortName: 'Workout 2', proof: false, target: { value: 45, unit: 'minutes' }, tierStandard: { value: 45, unit: 'minutes' } },
  { key: 'water', shortName: 'Water', proof: false, target: { value: 1, unit: 'gallons' }, tierStandard: { value: 1, unit: 'gallons' } },
  { key: 'read', shortName: 'Read', proof: false, target: { value: 10, unit: 'pages' }, tierStandard: { value: 10, unit: 'pages' } },
  { key: 'diet', shortName: 'Follow the diet', proof: false, target: null, tierStandard: null },
  { key: 'photo', shortName: 'Progress photo', proof: true, target: null, tierStandard: null },
];
const CHALLENGE_ID = '11111111-1111-4111-8111-111111111111';
const DAY_ROW = {
  id: '22222222-2222-4222-8222-222222222222',
  challenge_id: CHALLENGE_ID,
  day: 12,
  task_snapshot: TASKS,
  sealed_at: null,
};

function cannedBody(url) {
  const u = url.toLowerCase();
  if (u.includes('/rpc/get_or_freeze_today')) return DAY_ROW;
  if (u.includes('/rpc/get_day_window')) {
    return [
      {
        challenge_id: CHALLENGE_ID,
        day: 12,
        is_today: true,
        is_open: true,
        closes_at: new Date(Date.now() + 36e5).toISOString(),
        sealed_at: null,
        outcome: null,
        tasks_total: TASKS.length,
        tasks_done: 0,
        task_snapshot: TASKS,
      },
    ];
  }
  if (u.includes('/rest/v1/profiles')) return { name: 'You', xp: 240, unit_preference: 'metric' };
  if (u.includes('/rest/v1/challenges')) {
    // An OBJECT, not an array: getChallengeConfig reads this row with
    // .single(), and an array body left `challenge.flame` undefined — so
    // every render check before Phase 38G measured a header on flame 0,
    // reading "Streak starts today", and never the streak itself.
    // best_flame ABOVE flame on purpose: the Home header then renders
    // "STREAK 11 · BEST 29", the widest thing it can say, and the header-fit
    // check below measures it against the tier badge.
    return { id: CHALLENGE_ID, base_tier: 'hard', duration_days: 75, flame: 11, best_flame: 29, missed_notice_day: null, restarted_from: null, duration_previous: null, timezone: 'UTC' };
  }
  if (u.includes('/rest/v1/tier_history')) return [{ tier: 'hard', from_day: 1 }];
  if (u.includes('/auth/v1/user')) return { id: USER_ID, email: 'render@check.local' };
  // Everything else — completions, customs, overrides, journal, meals,
  // milestones, metric_checkins, workout_logs, blocked, squads.
  return [];
}

/**
 * PROOF THAT THESE ASSERTIONS HAVE TEETH.
 *
 *   npm run test:render -- --prove
 *
 * Each entry breaks one property with CSS injected into the real page, and
 * the run is expected to FAIL. A render check that passes against a screen
 * with no card on it is worth less than no check at all — which is the exact
 * failure this whole phase is about.
 */
const SABOTAGE = {
  'card-hidden': {
    css: '[data-testid="weekly-checkin-card"]{display:none !important}',
    why: 'the card is not rendered at all',
  },
  'card-collapsed': {
    css:
      '[data-testid="weekly-checkin-card"]{height:0 !important;min-height:0 !important;' +
      'padding:0 !important;overflow:hidden !important}',
    why: 'the card renders but paints at zero height',
  },
  'tabbar-floating': {
    css: '[data-testid="tab-bar"]{margin-bottom:60px !important}',
    why: 'the tab bar is not flush with the bottom edge',
  },
  'tabbar-doubled': {
    css: '[data-testid="tab-bar"]{height:200px !important;min-height:200px !important}',
    why: 'the tab bar eats the screen (the Phase 12B defect)',
  },
  // Phase 33. The header must not move between tabs and must not land on a
  // fractional pixel. The shift is keyed to the SELECTED tab through
  // aria-selected, so it appears only after a tab switch — the shape of the
  // report, not a header that is simply wrong everywhere.
  // Keyed to the SQUAD tab having focus, which is what a tab has right after
  // it is clicked: react-native-web emits no aria-selected for a tab's
  // selected state, so :focus is the one attribute a tab switch leaves in
  // the DOM. The shift therefore appears only after that switch — the shape
  // of the report, not a header that is simply wrong everywhere.
  'header-shift': {
    css:
      'body:has([role="tab"][aria-label="SQUAD"]:focus) ' +
      '[data-testid="app-header"]{margin-top:-8px !important}',
    why: 'the header moves up when a different tab is selected',
  },
  'header-fractional': {
    css: '[data-testid="app-header"]{padding-top:10.5px !important}',
    why: 'the header lands on a half-pixel boundary',
  },
};

async function main(sabotage) {
  const { server, port } = await serve(DIST);
  const origin = `http://127.0.0.1:${port}`;
  console.log(`render-check — serving ${DIST} at ${origin}`);

  let browser;
  for (const channel of ['chrome', 'msedge']) {
    try {
      browser = await chromium.launch({ channel, headless: true });
      console.log(`render-check — driving installed ${channel}`);
      break;
    } catch {
      /* try the next one */
    }
  }
  if (!browser) {
    server.close();
    console.log(
      'SKIP  no installed Chrome or Edge to drive. The render check did NOT run — ' +
        'this is not a pass.',
    );
    process.exit(0);
  }

  const context = await browser.newContext({ viewport: VIEWPORT });

  // Every Supabase call, answered locally. The bundle is untouched.
  await context.route(`**/*${PROJECT_REF}*/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: cors() });
    }
    return route.fulfill({
      status: 200,
      headers: { ...cors(), 'content-type': 'application/json' },
      body: JSON.stringify(cannedBody(req.url())),
    });
  });

  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });

  // A session that supabase-js will accept from storage without a round trip.
  await page.addInitScript(
    ({ ref, userId }) => {
      const oneYear = Math.floor(Date.now() / 1000) + 31_536_000;
      window.localStorage.setItem(
        `sb-${ref}-auth-token`,
        JSON.stringify({
          access_token: 'render-check',
          refresh_token: 'render-check',
          token_type: 'bearer',
          expires_in: 31_536_000,
          expires_at: oneYear,
          user: {
            id: userId,
            aud: 'authenticated',
            role: 'authenticated',
            email: 'render@check.local',
            app_metadata: {},
            user_metadata: {},
            created_at: new Date(0).toISOString(),
          },
        }),
      );
    },
    { ref: PROJECT_REF, userId: USER_ID },
  );

  await page.goto(`${origin}/track`, { waitUntil: 'load' });

  // The gate has to actually open. A run that asserted against the sign-in
  // screen would pass every layout check and mean nothing.
  let reached = true;
  try {
    await page.waitForSelector('[data-testid="track-scroll"]', { timeout: 20_000 });
  } catch {
    reached = false;
  }
  if (sabotage) {
    await page.addStyleTag({ content: SABOTAGE[sabotage].css });
    await page.waitForTimeout(200);
  }

  check(
    'the Track screen renders (the session gate opened)',
    reached,
    reached ? '' : `still on ${new URL(page.url()).pathname} — ` +
      (consoleErrors[0] ?? 'no console error'),
  );
  if (!reached) {
    await browser.close();
    server.close();
    return;
  }

  // -------------------------------------------------------------------------
  // 1. The card is there, and it occupies space.
  // -------------------------------------------------------------------------
  const cardText = await page
    .getByText('Weekly check-in', { exact: false })
    .first()
    .isVisible()
    .catch(() => false);
  check('"Weekly check-in" is present on Track', cardText);

  const card = page.locator('[data-testid="weekly-checkin-card"]').first();
  const cardBox = await card.boundingBox().catch(() => null);
  check(
    '...and has a non-zero bounding box',
    !!cardBox && cardBox.width > 0 && cardBox.height > 0,
    cardBox ? `${Math.round(cardBox.width)}x${Math.round(cardBox.height)}` : 'no box',
  );

  // The weight field and the Save button, not just the heading: a card that
  // rendered its title and nothing else is the same failure wearing a hat.
  const input = page.locator('[data-testid="weekly-checkin-card"] input').first();
  const inputBox = await input.boundingBox().catch(() => null);
  check(
    'the weight input is rendered and has size',
    !!inputBox && inputBox.width > 0 && inputBox.height > 0,
    inputBox ? `${Math.round(inputBox.width)}x${Math.round(inputBox.height)}` : 'no box',
  );
  check(
    'it is a decimal keypad',
    (await input.getAttribute('inputmode')) === 'decimal',
    `inputmode=${await input.getAttribute('inputmode')}`,
  );
  // The input must be INSIDE the card's box. A card collapsed to a 2px
  // border with overflow hidden still has a non-zero box, and its input
  // still reports a rect — clipped, unreachable, and until Phase 33 green.
  check(
    'the weight input sits inside the card',
    !!cardBox &&
      !!inputBox &&
      inputBox.y >= cardBox.y - 0.5 &&
      inputBox.y + inputBox.height <= cardBox.y + cardBox.height + 0.5,
    cardBox && inputBox
      ? `card y ${cardBox.y.toFixed(1)} h ${cardBox.height.toFixed(1)}, input y ${inputBox.y.toFixed(1)} h ${inputBox.height.toFixed(1)}`
      : 'no boxes',
  );
  check(
    'the Save control is on screen',
    await page.getByText('Save check-in', { exact: false }).first().isVisible().catch(() => false),
  );

  // -------------------------------------------------------------------------
  // 2. The tab bar sits ON the bottom edge — no more, no less.
  //
  // Phase 12B: the bar occupied ~140pt where ~83 was expected, because the
  // safe-area inset was applied twice. Both halves are asserted: its bottom is
  // flush with the viewport, and its height is sane for a labels-only bar.
  // -------------------------------------------------------------------------
  const bar = page.locator('[data-testid="tab-bar"]').first();
  const barBox = await bar.boundingBox().catch(() => null);
  check('the tab bar is rendered', !!barBox);
  if (barBox) {
    const bottomGap = VIEWPORT.height - (barBox.y + barBox.height);
    check(
      'its bottom edge is at the bottom of the viewport',
      Math.abs(bottomGap) <= 1,
      `${bottomGap.toFixed(1)}px gap below it`,
    );
    check(
      'it spans the full width',
      Math.abs(barBox.width - VIEWPORT.width) <= 1,
      `${Math.round(barBox.width)}px of ${VIEWPORT.width}`,
    );
    // A labels-only bar with a 10px floor plus padding. 100 is generous; the
    // Phase 12B defect measured ~140.
    check(
      'it is not eating the screen',
      barBox.height <= 100,
      `${Math.round(barBox.height)}px tall`,
    );
  }

  // -------------------------------------------------------------------------
  // 3. Nothing is clipped behind it, at any scroll position.
  //
  // Scrolled to the very bottom, the last thing in the scroll content must be
  // fully ABOVE the tab bar's top edge. That is the property the user loses
  // when the content inset does not account for the bar: the final card is
  // reachable by scrolling but never fully visible.
  // -------------------------------------------------------------------------
  if (barBox) {
    const scroller = page.locator('[data-testid="track-scroll"]').first();
    const positions = [];
    // Top, middle, bottom — a bar that is correct at rest and wrong once the
    // content moves is still wrong.
    for (const frac of [0, 0.5, 1]) {
      await scroller.evaluate((el, f) => {
        el.scrollTop = (el.scrollHeight - el.clientHeight) * f;
      }, frac);
      await page.waitForTimeout(150);
      const tail = await page
        .locator('[data-testid="track-tail"]')
        .first()
        .boundingBox()
        .catch(() => null);
      positions.push({ frac, tail });
    }
    const atBottom = positions[positions.length - 1];
    check(
      'the page actually scrolls to a bottom',
      !!atBottom.tail,
      'the tail of the Track content was not measurable',
    );
    if (atBottom.tail) {
      const overlap = atBottom.tail.y + atBottom.tail.height - barBox.y;
      check(
        'at full scroll, the last content clears the tab bar',
        overlap <= 1,
        `${overlap.toFixed(1)}px of it is behind the bar`,
      );
    }
    // And the card specifically is fully visible somewhere in that range.
    let everFullyVisible = false;
    for (const frac of [1, 0.75, 0.5]) {
      await scroller.evaluate((el, f) => {
        el.scrollTop = (el.scrollHeight - el.clientHeight) * f;
      }, frac);
      await page.waitForTimeout(150);
      const b = await card.boundingBox().catch(() => null);
      if (b && b.y >= 0 && b.y + b.height <= barBox.y + 1) {
        everFullyVisible = true;
        break;
      }
    }
    check(
      'the check-in card can be brought fully into view above the bar',
      everFullyVisible,
    );
  }

  // -------------------------------------------------------------------------
  // 4. The header is where it was, on every tab, on whole pixels.
  //
  // Phase 33. Measured per tab AFTER the switch settles, and compared to the
  // first measurement: identical rect (top, left, width, height) and integral
  // top and height. A header that cannot be found is a FAIL, not a skip —
  // the assertion must not go green by losing its target.
  // -------------------------------------------------------------------------
  // Every tab screen keeps its OWN header mounted. The inactive screens are
  // not display:none — they are stacked behind with aria-hidden="true",
  // pointer-events:none and z-index -1 — so "the first header" is the first
  // screen ever mounted, whatever tab is showing. The active header is the
  // one with no aria-hidden ancestor.
  const headerRect = async () => {
    const boxes = await page.locator('[data-testid="app-header"]').evaluateAll((els) =>
      els
        .filter((el) => !el.closest('[aria-hidden="true"]'))
        .map((el) => el.getBoundingClientRect())
        .filter((r) => r.width > 0 && r.height > 0)
        .map((r) => ({ top: r.top, left: r.left, width: r.width, height: r.height })),
    );
    return boxes.length === 1 ? boxes[0] : null;
  };
  const first = await headerRect();
  check('the app header is rendered and measurable', !!first, 'no visible [data-testid="app-header"]');
  if (first) {
    const isInt = (n) => Math.abs(n - Math.round(n)) < 1e-6;
    const same = (a, b) =>
      ['top', 'left', 'width', 'height'].every((k) => Math.abs(a[k] - b[k]) < 0.01);
    const fmt = (r) => `top ${r.top} left ${r.left} ${r.width}x${r.height}`;
    check(
      'its top and height are whole pixels',
      isInt(first.top) && isInt(first.height),
      fmt(first),
    );
    // Every bottom tab, in order, then back to the first. The tab names are
    // read from the bar itself so a renamed or added tab is still covered.
    const tabs = await page.locator('[data-testid="tab-bar"] [role="tab"]').evaluateAll((els) =>
      els.map((el) => el.getAttribute('aria-label')).filter(Boolean),
    );
    check('the tab bar exposes its tabs', tabs.length >= 2, `${tabs.length} tab(s)`);
    const moved = [];
    for (const name of [...tabs, tabs[0]]) {
      await page.getByRole('tab', { name, exact: true }).click();
      await page.waitForTimeout(300);
      const r = await headerRect();
      if (!r) {
        moved.push(`${name}: header not measurable`);
        continue;
      }
      if (!same(r, first) || !isInt(r.top) || !isInt(r.height)) {
        moved.push(`${name}: ${fmt(r)} (was ${fmt(first)})`);
      }
    }
    check(
      'the header sits at the same whole-pixel rect on every tab',
      moved.length === 0,
      moved.join('; '),
    );

    // THE HEADER'S WIDEST LINE (Phase 38G, G1). Only Home carries the streak,
    // and with the stub's flame 11 / best 29 it reads "STREAK 11 · BEST 29"
    // beside the tier badge — the case 38C flagged as a width risk and could
    // not measure. Measured here: nothing runs past the header's right edge,
    // and the wordmark and the streak group do not overlap.
    const homeTab = tabs.find((t) => /home/i.test(t)) ?? tabs[0];
    await page.getByRole('tab', { name: homeTab, exact: true }).click();
    await page.waitForTimeout(300);
    const fit = await page.locator('[data-testid="app-header"]').evaluateAll((els) => {
      const el = els.find((e) => !e.closest('[aria-hidden="true"]'));
      if (!el) return null;
      const h = el.getBoundingClientRect();
      const leaves = [...el.querySelectorAll('*')].filter(
        (n) => n.children.length === 0 && (n.textContent || '').trim(),
      );
      const rect = (n) => n.getBoundingClientRect();
      const byText = (re) => leaves.find((n) => re.test((n.textContent || '').trim()));
      const word = byText(/^RANKED$/);
      const streak = byText(/^STREAK$/i);
      const best = byText(/BEST/i);
      return {
        headerRight: h.right,
        maxRight: Math.max(...leaves.map((n) => rect(n).right)),
        wordRight: word ? rect(word).right : null,
        streakLeft: streak ? rect(streak).left : null,
        bestText: best ? (best.textContent || '').trim() : null,
      };
    });
    check(
      'Home header shows the best beside the streak (stub: flame 11, best 29)',
      !!fit && !!fit.bestText,
      fit ? JSON.stringify(fit) : 'no visible header on Home',
    );
    check(
      '...and nothing in the header runs past its right edge',
      !!fit && fit.maxRight <= fit.headerRight + 0.5,
      fit ? `text ends at ${fit.maxRight}, header ends at ${fit.headerRight}` : '',
    );
    check(
      '...and the wordmark and the streak group do not overlap',
      !!fit && fit.wordRight != null && fit.streakLeft != null && fit.wordRight < fit.streakLeft,
      fit ? `RANKED ends at ${fit.wordRight}, STREAK starts at ${fit.streakLeft}` : '',
    );
  }

  await browser.close();
  server.close();
}

function cors() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': '*',
    'access-control-expose-headers': 'content-range',
  };
}

const PROVE = process.argv.includes('--prove');
// `--sabotage <name>` runs ONE sabotage with full output, so a reader can see
// the exact FAIL lines an assertion produces against a broken screen.
const SABOTAGE_ONE = process.argv.includes('--sabotage')
  ? process.argv[process.argv.indexOf('--sabotage') + 1]
  : null;

async function run() {
  if (SABOTAGE_ONE) {
    if (!SABOTAGE[SABOTAGE_ONE]) {
      console.log(`unknown sabotage "${SABOTAGE_ONE}"; known: ${Object.keys(SABOTAGE).join(', ')}`);
      return 2;
    }
    console.log(`SABOTAGE ${SABOTAGE_ONE}: ${SABOTAGE[SABOTAGE_ONE].why}. This run is EXPECTED TO FAIL.\n`);
    await main(SABOTAGE_ONE);
    console.log(
      failures
        ? `\n${failures} render check(s) FAILED under sabotage "${SABOTAGE_ONE}" — the assertion has teeth.`
        : `\nNOTHING FAILED under sabotage "${SABOTAGE_ONE}" — the assertion is toothless.`,
    );
    return failures ? 1 : 3;
  }
  if (!PROVE) {
    await main(null);
    console.log(
      failures
        ? `\n${failures} render check(s) FAILED — measured in a real browser, against ${DIST}.`
        : `\nEverything measured on screen where it should be, in ${DIST}.`,
    );
    return failures ? 1 : 0;
  }

  console.log('PROVING THE CHECKS FAIL WHEN THE SCREEN IS BROKEN.\n');
  let toothless = 0;
  for (const [name, { why }] of Object.entries(SABOTAGE)) {
    failures = 0;
    const quiet = console.log;
    console.log = () => {};
    await main(name);
    console.log = quiet;
    const caught = failures > 0;
    if (!caught) toothless++;
    console.log(
      `${caught ? 'CAUGHT ' : 'MISSED '} ${name.padEnd(16)} ${why} ` +
        `(${failures} assertion${failures === 1 ? '' : 's'} fired)`,
    );
  }
  console.log(
    toothless
      ? `\n${toothless} sabotage(s) went undetected. Those assertions prove nothing.`
      : '\nEvery sabotage was caught. The checks measure what they claim to.',
  );
  return toothless ? 1 : 0;
}

run()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`\nrender-check crashed: ${error?.stack ?? error}`);
    process.exit(1);
  });
