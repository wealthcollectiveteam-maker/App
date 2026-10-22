# Device gate — the checklist before the TestFlight link goes out

**Status: nothing in this build has ever executed on a physical iPhone.**

Every proof this project holds is a Node suite or a `psql` run. Those are real —
`two_client_test.sql` and `preference_sync_test.sql` prove things no UI test
could — but they all run on a machine that is not an iPhone. Twice now this
repo has had a fully green suite alongside a real defect: a task editor no user
could reach, and `anon` holding write privileges on all 19 tables. Both were
invisible to the tests that existed because the tests were not looking where
the defect was.

So this is the wall between `eas build` and eleven people:

```
eas build --profile development --platform ios    ← build A: §3.4.0 only
   ↓                                                 (dev sheet + Metro console)
delete the app, clear its Health access
   ↓
eas build --profile production --platform ios     ← build B: already allowed
   ↓
install the build on MY phone                     ← TestFlight internal, or the direct install
   ↓
WORK THROUGH THIS FILE                            ← the gate
   ↓
eas submit  →  Beta App Review  →  external link  ← only after every box below
```

Two builds, not one — see "Which build each section needs" below. §3.4.0 is
the only box that needs build A, and it cannot be read from build B on a
Windows machine without extra tooling.

**Do not send the link while any box below is unticked or FAIL.**

## How to use it

Each item has a box and a line. Write what you actually saw, not "fine" — the
line exists because "streak looked right" and "streak said 23, the same as the
web app" are different observations and only one of them is evidence.

- `[ ] PASS` / `[ ] FAIL` — tick one.
- `[ ] N/A — needs 17B` — for the two items that genuinely cannot be checked
  until Apple Health is written. They are marked. Do not tick PASS on them.

Keep the web app open on a laptop throughout, signed into the same account.
Half of section 1 is a comparison, and a comparison needs both sides.

### Which build each section needs — read this first

**This gate needs TWO native builds, not one.** That was not written down
before, and it made §3.4.0 — the box everything else in §3.4 hangs off —
unreachable from the build the sequence told you to make.

`§3.4.0` reads the raw HealthKit authorization enum. The only convenient way
to see it is the dev sheet, and the dev sheet is `__DEV__`-only: `AppHeader`
reaches it through a `__DEV__ ? require(...) : null`, so in a production
bundle Metro never follows that require and the whole component is absent from
the binary. Not hidden — absent. There is nothing to long-press.

So:

| | build | why |
|---|---|---|
| **§3.4.0 only** | `--profile development` | the dev sheet exists, and `console.warn` lands in your terminal |
| **everything else** | `--profile production` | it is the artifact going to Beta App Review; a dev build's launch path, session restore and deep links are not the shipping ones |

```
eas build --profile development --platform ios     ← build A, §3.4.0
eas build --profile production  --platform ios     ← build B, everything else
```

They share the bundle id `com.aly786.rankedfitness`, so **they cannot be
installed at the same time** and the second install replaces the first.

**Run A first, then B.** iOS holds the Health authorization against the bundle
id, so granting Health on build A leaves build B looking like an app that has
already asked — and §3.4.1 is explicitly "before you have ever granted
permission", the case every friend hits first. Deleting the app removes its
Health access, so:

- do the dev pass on A,
- **delete the app** from the phone,
- confirm in **iOS Settings → Privacy & Security → Health → Apps** that Ranked
  Fitness is no longer listed,
- then install B and start at §1.

Doing it the other way round costs you a delete-and-reinstall anyway, and you
would not know you needed one until §3.4.1 read wrong.

**What build A can and cannot tell you.** A dev build runs JS from the Metro
server on your PC: unminified, unoptimised, and re-attached to the bundler on
every launch. That is fine for reading a native return value and no good at
all for judging launch behaviour. Do NOT tick these on build A — they are
production-only, and are marked as such in place:

- **§3.2** — force-quit and relaunch. The dev client shows its own launcher
  while it reconnects to Metro, so "no sign-in screen flashed on the way in"
  is not a thing you can observe.
- **§3.3** — cold launch from a notification, and the `rankedfitness://`
  sign-in link. A dev-client launch is intercepted to attach the bundler; the
  route the shipping app takes is a different one.
- **§4** — the expiry safety net. There is no TestFlight build here to expire.

**What is worth doing on build A while you have it**, beyond §3.4.0:

- **§2.1's day-boundary states.** The dev sheet's *Advance day (rollover)*
  reaches "after noon, the app moved off yesterday on its own" without waiting
  for noon.
- **§3.4's card states.** *Simulate Health data* draws the populated card
  without granting anything, which separates "the card renders wrong" from
  "the grant did not work".

> **Use a throwaway account for build A.** Against a live backend those dev
> sheet rows are not simulations — `Advance day` winds your real start date
> back and seals today, and *Day 1 — fresh start* **ends the challenge and
> deletes its history**. Your `.env` points build A at the production Supabase
> project. Sign in as a test account, not as yourself.

`--profile development` is `distribution: internal` in `eas.json`. Your
friends never receive it, and nothing diagnostic exists in build B.

### Before you start

**Do these in this order. The order is settled — see "Deploy order" below for
why, and for what happens if you stop between any two of them.**

- [ ] **0. BEFORE applying anything, run `supabase/checks/0013_before.sql`**
      in the SQL editor. It writes nothing. Both rows must read `OK` —
      `prefs_synced_at` must be **ABSENT**, and row 2 tells you what your N is
      so that "0 of N" means something later.
      **If row 1 says FINDING the column already exists, which means something
      wrote to this project that neither of us knows about. STOP** — do not
      apply 0013, do not deploy — run `0013_after.sql` and bring back its last
      two rows.
      prefs_synced_at: __________   my N: __________

- [ ] **1. Apply `0013_preference_sync.sql`** to `dmlgdqufkrtrjgbofpkd`, then
      run `supabase/checks/0013_after.sql`. All **four** rows must read `OK` —
      including `accounts already stamped` reading `0 of N` with the N from
      step 0, and `stamped rows claiming a Health grant` reading `0`.
      This goes FIRST. It is inert to the client that is live right now — that
      build names none of these columns — and going first means no live user
      ever meets a build whose settings toggles raise "That change didn't
      save". Each row's stop condition is written into that file's header.
      What I saw: ______________________________________________

- [ ] **2. `dist/` REBUILT from this branch** (`npm run build:web`).
      **This is now enforced, not remembered.** `npm run predeploy` refuses to
      pass a `dist/` that is older than `src/`, that carries the denied build
      id `cfaab51c…`, or whose bundle shows any pre-fix fingerprint
      (`healthEnabled` defaulting true, `health_enabled` in the synced column
      map, `workouts: []`, "No workouts recorded today"). `build:web` runs the
      same fingerprint gate and refuses to *produce* such a bundle at all.
      New buildId (must not be `cfaab51c…`): ______________________

- [ ] **3. `npm run predeploy` exits 0**, then copy to Pages. If it refuses,
      read what it names and fix that — do not copy anyway.
      **It now checks the DESTINATION as well as `dist/`**: it refuses if the
      Pages working tree is not identical to `origin/main`. It refused on
      2026-09-05 for exactly that reason — 21 modified files and two stale
      8.7 MB bundles left by an uncommitted copy from 31 August, all of which
      step 4's commit would have carried. A clean `dist/` copied into a dirty
      folder still publishes a wrong site.
      What I saw: ______________________________________________

- [ ] **3b. `npm run postdeploy` exits 0** — after the copy, before you commit.
      The last moment a wrong publish can be caught. It asserts that every
      bundle the pages load is on disk, that no bundle on disk is unreferenced,
      that all pages name the same one, that `version.json` agrees, that
      `.nojekyll` / `index.html` / `404.html` / `manifest.json` /
      `version.json` are at the ROOT, and that every file matches `dist/`
      byte for byte. An `index.html` naming a bundle that is not in the commit
      is a blank site, and this project has shipped one.
      What I saw: ______________________________________________

- [ ] **4. The web build redeployed** from that fresh `dist/` (the Pages copy).
      Web and native must be the same code for section 1 to mean anything.
      What I saw: ______________________________________________

- [ ] **5. Re-run `supabase/repair/phase16b_audit_production.sql`.**
      Confirmation, not discovery: it read 0 findings across 321 checks on
      2026-09-04, including `anon` holding nothing on any of the 22 tables.
      0013 adds a column to an existing table and adds no grant, so this
      should be unchanged — which is exactly why it is worth 30 seconds.
      Findings: __________ (expect 0)
      What I saw: ______________________________________________

- [ ] **6. Build A — `eas build --profile development --platform ios`.**
      Install it, run `npx expo start --dev-client` on the PC, sign in **as a
      test account**, and work §3.4.0. Then delete the app from the phone and
      confirm Ranked Fitness is gone from iOS Settings → Privacy & Security →
      Health → Apps.
      raw / typeof / parsedAs: __________________________________

- [ ] **7. Build B — `eas build --profile production --platform ios`.**
      Install it on a phone with no Ranked Fitness on it and no Health grant
      for it. Everything from §1 onward runs against this build — **starting
      with §2.1.1 M0**, a two-minute check of whether the day-boundary fix can
      work on an iPhone at all. If M0 fails, stop there and report it.
      Build number: __________

### Deploy order — and why it is this way round

Two earlier notes in this project gave opposite orders. This is the resolved
version; the other has been removed rather than left to be re-read.

The live web build **writes no preference to the server at all** — not the
unit preference, not a switch, not the marker. `reconcilePreferences` and
`savePreferences` do not exist in it. So `0013` cannot disturb it: the
migration adds one nullable column, changes no default, no grant, no policy,
and the live client never names it.

That makes the migration the safe thing to move first, and the client the
risky thing to move second — the opposite of the usual instinct.

| | **0013 NOT applied** | **0013 applied** |
|---|---|---|
| **live client** (what your friends run now) | Today. Settings are device-local, nothing syncs. | **Inert.** No behaviour change for anyone. |
| **this branch's client** | Reads fine (`select *`, marker absent → "never synced", keeps its own state). Unit preference still syncs. Every switch write fails **visibly**: the setting holds on the device, a toast says it didn't save, once per toggle and once per sign-in. Recoverable — apply 0013 and the next write lands. | The intended state. |

**Nothing in that table writes a wrong value that cannot be corrected.** The
one combination that could — the partway-through build in `dist/`, against a
0013-applied database — is not in the table because it must not be deployed.
Step 2 above is what stops it.

If you are interrupted:

- **after 1, before 2/3** — nothing has changed for anyone. The column sits
  unused. You can stop here indefinitely.
- **after 2, before 3** — nothing has changed for anyone; `dist/` is a local
  folder until it is copied.
- **after 3, before the native build** — web users get the fixed client
  against a prepared database. This is a good resting state.
- **if you do 3 before 1** — eleven people get "That change didn't save" on
  every settings toggle and once per sign-in until you apply 0013. Their
  settings still work on their own device. Annoying, visible, fully
  recoverable, and the reason 1 goes first.

---

## 1. Migration continuity — the whole point of 17A

A friend on day 23 opens the native app, signs in, and is on day 23. Nothing
here is about the app working; it is about the app being the SAME app.

### 1.1 Cold launch and sign in

- [ ] PASS  [ ] FAIL — Fresh install. Launch it. It does not crash, and it
      lands on the sign-in screen rather than a setup flow.
      What I saw: ______________________________________________

- [ ] PASS  [ ] FAIL — Sign in with my real email. The 6-digit code arrives and
      is accepted. (The emailed *link* is the other path — section 3.3.)
      What I saw: ______________________________________________

- [ ] PASS  [ ] FAIL — **It lands on Track, not on "create a challenge".**
      This is A2.2 proved on hardware. The code read says a valid session plus
      an active challenge routes to Track; a cold device has no local state,
      which is the exact input that would make a "no local state = new user"
      assumption misfire.
      What I saw: ______________________________________________

- [ ] PASS  [ ] FAIL — No setup step, no tier picker, no "what's your why"
      appeared anywhere on the way in.
      What I saw: ______________________________________________

### 1.2 The numbers are the same numbers

Read each one off the phone and off the browser, and write both down.

- [ ] PASS  [ ] FAIL — **Day number.** Phone: ______  Web: ______

- [ ] PASS  [ ] FAIL — **Streak / flame.** Phone: ______  Web: ______

- [ ] PASS  [ ] FAIL — **XP and level.** Phone: ______  Web: ______

- [ ] PASS  [ ] FAIL — **Best flame / perfect days.** Phone: ______  Web: ______

- [ ] PASS  [ ] FAIL — **Today's task list is identical** — same tasks, same
      targets, same ones already ticked.
      What I saw: ______________________________________________

- [ ] PASS  [ ] FAIL — **The squad is there**, with the same name, and every
      member present with the same day number and flame as the web roster shows.
      Members: ______________________________________________

- [ ] PASS  [ ] FAIL — Journal entries, meals logged today, and milestones all
      appear.
      What I saw: ______________________________________________

### 1.3 Units — fix #1 proving itself

The unit preference used to be re-derived from the device locale on every
install. A phone and a laptop browser can easily disagree, so this is the item
that silently turns someone's weight display from lb to kg.

- [ ] PASS  [ ] FAIL — Settings → the unit row reads the same on the phone as on
      the web app, before touching anything.
      Phone: ______  Web: ______

- [ ] PASS  [ ] FAIL — Change it on the phone (KG/CM ⇄ LB/FT). Refresh the web
      app. The web app now shows the new one.
      What I saw: ______________________________________________

- [ ] PASS  [ ] FAIL — Change it back on the WEB. Pull to refresh on the phone.
      The phone follows.
      What I saw: ______________________________________________

- [ ] PASS  [ ] FAIL — Force-quit the app and relaunch. The preference is still
      what I last chose (not the phone's locale default).
      What I saw: ______________________________________________

> If the first of these three fails but the second and third pass, the sync is
> working and the SEED did not run — which happens if the web app was not
> opened once after the redeploy. That is recoverable and worth noting rather
> than treating as a blocker: set it once on the phone and it is correct
> everywhere from then on.

### 1.4 The switches — fix #4 proving itself

- [ ] PASS  [ ] FAIL — Settings → turn a notification switch OFF on the phone.
      Force-quit, relaunch. It is still off.
      Which switch: ____________  What I saw: ________________

- [ ] PASS  [ ] FAIL — Refresh the web app. The same switch is off there.
      What I saw: ______________________________________________

- [ ] PASS  [ ] FAIL — Turn the weekly check-in card off in Settings on the web,
      pull to refresh on the phone: the card is gone on the phone too. Turn it
      back on.
      What I saw: ______________________________________________

### 1.5 A task crosses between the two clients

- [ ] PASS  [ ] FAIL — Complete a task **on the web**. Pull to refresh on the
      phone. It shows as complete, and the counter moved by exactly one.
      What I saw: ______________________________________________

- [ ] PASS  [ ] FAIL — Complete a different task **on the phone**. Refresh the
      web app. Same.
      What I saw: ______________________________________________

- [ ] PASS  [ ] FAIL — Tick the SAME task on both, one after the other. The
      count goes up once, not twice, on both screens.
      What I saw: ______________________________________________
      (`two_client_test.sql` PROOF 3 says the server cannot double-count this.
      What this checks is that neither screen invents a second one.)

### 1.6 The weekly check-in week — fix #2 proving itself

- [ ] PASS  [ ] FAIL — Save this week's check-in on the WEB. Pull to refresh on
      the phone. The card shows the summary row, not an empty entry form asking
      for the week again.
      What I saw: ______________________________________________

---

## 2. The three features never once run on hardware

### 2.1 Grace window

The boundary is noon in the CHALLENGE's timezone, not the phone's. Proved in
`grace_window_test.sql`; never tapped on a device.

**Tick these on build B.** If waiting for noon is impractical, build A's dev
sheet has *Advance day (rollover)* — but on a **test account only**: against a
live backend that row winds your real start date back and seals today.

- [ ] PASS  [ ] FAIL — In the morning, before noon: the check-in screen offers
      yesterday as well as today.
      What I saw: ______________________________________________

- [ ] PASS  [ ] FAIL — Complete a task against YESTERDAY inside the window. It
      ticks, and it stays ticked after a pull to refresh.
      What I saw: ______________________________________________

- [ ] PASS  [ ] FAIL — Seal yesterday from inside the window. **The streak
      survives** — write down the flame before and after.
      Before: ______  After: ______

- [ ] PASS  [ ] FAIL — After noon, the app has moved off yesterday on its own
      (without a force-quit) and no longer offers to write to it.
      What I saw: ______________________________________________

- [ ] PASS  [ ] FAIL — Attempt a completion against yesterday after noon (if
      the UI still offers one anywhere): it is refused with a readable message,
      and **the tick does not stay on screen**.
      What I saw: ______________________________________________

### 2.1.1 Local midnight — the day-boundary fix (Phase 20)

On 2026-09-10 at 12:20 AM, in one sitting, two taps landed on day 3 and eleven
on day 2. The screen named one day and the database received another. Phase 20
is meant to make those the same day. `day-boundary.test.mjs` proves that for
pure functions in Node. It cannot suspend a JS timer, lock a phone, or drop a
network, and those are the situations where this defect lives.

**Which build.** Build B (`--profile production`), **and then the same pass on
the Home Screen web app**, because that is what eleven people run until the
TestFlight link goes out. Not build A. A dev client re-attaches to Metro on
resume, so its foreground path is not the shipping one. The dev sheet's
*Advance day* moves the SERVER's clock, while this section is about the PHONE's
clock and the server's clock disagreeing. It needs a real night.

- [ ] PASS  [ ] FAIL — **M0. RUN THIS FIRST, BEFORE ANY OTHER GATE ITEM:
      Intl with a timezone, under Hermes, on this iPhone.** Two minutes, no
      night needed.
      **Why it goes first.** The check-in date line and the noon/midnight
      refresh timer both read the CHALLENGE's wall clock through
      `Intl.DateTimeFormat(…, { timeZone })` and `formatToParts()`
      (`src/lib/dayLabel.ts`, `src/lib/writeDay.ts`). `day-boundary.test.mjs`
      proves the arithmetic in Node. The web app runs on Safari's engine, which
      has full Intl. The native app runs on **Hermes**, a different
      implementation, and nothing in this repo has ever run on it. If Hermes
      lacks either call, the day-boundary fix works **for web users only**, and
      M1–M7 would be testing a timer and a label that are not doing what they
      say.
      **When.** Between 12:00 and 23:59 New York time. In that window Tokyo is
      already on the next calendar day, so a label computed in the wrong zone
      shows a different date.
      1. Laptop, web app, Check-in: write down the date line under the day
         number, e.g. `MONDAY 14 SEPTEMBER`.
      2. Phone, build B, signed in, Check-in: the same line reads the same.
      3. iOS Settings → General → Date & Time → **Set Automatically OFF** →
         Time Zone → **Tokyo**. The phone's clock now shows **tomorrow's** date.
      4. Force-quit Ranked Fitness, relaunch, open Check-in, pull to refresh.
      **PASS:** the date line still reads **the laptop's New York date**,
      identical to step 1.
      **FAIL, no date line under the day number at all:** `Intl.DateTimeFormat`
      or `formatToParts()` threw under Hermes. The label deliberately renders
      nothing rather than "Invalid Date".
      **FAIL, the date line shows tomorrow (Tokyo's date):** Hermes ignored
      `timeZone`. The timer then targets the phone's noon and midnight, not the
      challenge's.
      **On either FAIL: stop and report it before running any other item in
      this file.** Write down exactly what the line said, or that it was absent.
      5. Put it back: **Set Automatically ON**, and confirm the phone's clock is
         right before continuing.
      What this does NOT prove: the timer also reads hour, minute and second
      parts with `hour12: false`, which the label never touches. M5 is the
      end-to-end proof of that path.
      Laptop date line: ______________  Phone, Tokyo zone: ______________

**Set up before 23:30.**

- Laptop open on the web app, signed in to the same account. It is the witness
  for which day a tick actually landed on.
- Leave **at least one of today's tasks unticked**. The still-open notice only
  appears for a previous day that is open *and* unfinished.
- For M1 and M2: iOS Settings → Display & Brightness → **Auto-Lock → Never**.
  Put it back afterwards.
- Every "What I saw" line gets the phone's clock time. "It rolled" is not
  evidence. "00:00:40, header read DAY 21 · MONDAY 14 SEPTEMBER" is.

- [ ] PASS  [ ] FAIL — **M1. Left open across midnight.** At 23:50 open
      Check-in and write down the header, both the day number and the date line
      under it. Do not touch the phone. At 00:02, still without touching it:
      the header shows the **next day number** and the date line shows **the
      date on the iOS lock screen**. Directly under the header is **DAY N IS
      STILL OPEN** with its sentence ("You are filling in day N+1. Day N is x of
      y and stays open until noon…"). On this phone's real width every word of
      that sentence is readable, nothing is cut off or ellipsised, and the
      notice does not overlap the day switcher below it.
      23:50 header: ______________  00:02 header: ______________
      Notice fully readable? ______  Phone model / width: ______________

- [ ] PASS  [ ] FAIL — **M2. The first tap after the roll.** At about 00:05,
      without touching the switcher, swipe one task done on the default deck.
      Refresh the web app on the laptop: the tick is on **the day the phone's
      header named** (N+1). Then tap YESTERDAY on the switcher. The header turns
      ember and reads Day N **with Day N's date**. Tick one task there, and the
      web app shows it on Day N.
      Header when I tapped: ______  Web shows it on: ______

- [ ] PASS  [ ] FAIL — **M3. The incident, reproduced on purpose.** This is
      the case a foreground refresh or a midnight timer cannot rescue, so it is
      the one that proves whether the WRITE names its day. At 23:50 turn on
      **airplane mode** with Check-in open and the screen on. Past midnight the
      header may still show Day N. That is expected, because the refresh failed
      offline. At 00:05 turn airplane mode OFF, wait for signal, and **without
      pulling to refresh or leaving the app** immediately tick one task.
      **Correct:** the web app shows that tick on **Day N**, the day the header
      showed, or the phone shows a refusal and the tick disappears.
      **FAIL:** the tick lands on Day N+1 while the phone said Day N. That is
      the 2026-09-10 defect, still live.
      Header when I tapped: ______  Web shows it on: ______  Toast: ______

- [ ] PASS  [ ] FAIL — **M4. Backgrounded across midnight.** At 23:00 lock the
      phone with Check-in open. Unlock at about 01:00. Within a few seconds,
      without pulling to refresh, the header shows the new day and date and the
      still-open notice is there. Pull to refresh: nothing changes further.
      Repeat on another night, unlocking at about 09:00 instead. The result is
      the same, and the notice says how long is left before noon.
      01:00: ______________  09:00: ______________

- [ ] PASS  [ ] FAIL — **M5. Noon, left open.** With Day N still unfinished,
      switch the deck to YESTERDAY (Day N), keep Check-in open, and leave the
      screen on across 12:00 without touching it. The app re-arms its one timer
      for noon as well as midnight, both measured in the challenge's timezone,
      and refreshes a few seconds after each. **By 12:01, on its own:** the
      ember switcher and the DAY N IS STILL OPEN notice are gone, and the deck
      is back on today with today's day number and date. Then, as a second
      check, try to reach Day N anywhere in the app. If any control still
      offers it, a tick there is **refused visibly and does not stay ticked**.
      A silent write anywhere is a FAIL.
      12:00:30 screen: ______________  12:01 screen: ______________
      Any way left to tick Day N: ______________

- [ ] PASS  [ ] FAIL — **M6. Two midnights, and the noon between them.** On
      a charger with Auto-Lock at Never, leave Check-in open from one evening
      to the morning two days later. Both mornings, the header had rolled to
      the right day and date without a touch. At the noon in between, the
      still-open notice cleared on its own, which proves the timer re-armed for
      midnight after firing at noon rather than stopping.
      Morning 1: ______________  Noon between: ______________  Morning 2: ______________

- [ ] PASS  [ ] FAIL — **M7. The fall-back weekend (Sat 31 Oct – Sun 1 Nov
      2026).** On Saturday 31 October the check-in date line reads **SATURDAY
      31 OCTOBER**, not SUNDAY 1 NOVEMBER. On Sunday morning, before noon,
      switching to yesterday reads 31 October and today reads 1 November. Only
      checkable on that weekend. Fill it in then rather than ticking it early.
      Sat: ______________  Sun (yesterday / today): ______________

### 2.2 Weekly check-in card

The bug this replaced rendered nothing at all for a whole week. The one
invariant: enabled ⇒ the card is on screen.

- [ ] PASS  [ ] FAIL — The card is visible on Track, in the entry state, not
      collapsed and not missing.
      What I saw: ______________________________________________

- [ ] PASS  [ ] FAIL — Save a mood with the weight field left BLANK. The card
      becomes the summary row and stays reachable — there is still a way back
      in and a history link.
      What I saw: ______________________________________________

- [ ] PASS  [ ] FAIL — The history screen opens and lists past check-ins,
      including ones recorded on the web.
      What I saw: ______________________________________________

### 2.3 Decimal weight

`numeric(6,2)` since 0012. Proved in SQL; never typed on an iOS keypad, and the
keypad is half the risk — a device that offers no decimal point makes the whole
thing untestable by the user.

- [ ] PASS  [ ] FAIL — The weight field brings up a keypad **with a decimal
      point on it**.
      What I saw: ______________________________________________

- [ ] PASS  [ ] FAIL — Enter `91.6`. Save. Reopen the card / history.
      It reads back exactly `91.6` — not `92`, not `91.60000001`, not `91.6 kg`
      rendered from a rounded integer.
      What I saw: ______________________________________________

- [ ] PASS  [ ] FAIL — Switch units to LB, enter `201.4`, save, switch back to
      KG and back to LB. It still reads `201.4`.
      What I saw: ______________________________________________

---

## 3. The things only a device can show

A headless Chrome render check measures layout in a browser. It cannot see a
UIKit safe-area inset, it has no home indicator, it never backgrounds, and it
has no notification centre. Everything in this section is invisible to it by
construction.

### 3.1 Safe areas and the tab bar

- [ ] PASS  [ ] FAIL — On Track, scrolled to the very bottom: the last card is
      fully visible **above** the tab bar. Nothing is cut in half.
      What I saw: ______________________________________________

- [ ] PASS  [ ] FAIL — The tab bar sits above the home indicator, and the
      indicator does not overlap a label or an icon.
      What I saw: ______________________________________________

- [ ] PASS  [ ] FAIL — Every tab (Track, Check-in, Squad, Settings) reaches its
      own bottom without content trapped underneath the bar.
      Which tab was worst: ______________________________________

- [ ] PASS  [ ] FAIL — Nothing is clipped under the Dynamic Island / notch at
      the top of any screen, including the modal screens (timer, history,
      settings sub-pages).
      What I saw: ______________________________________________

- [ ] PASS  [ ] FAIL — Rotate the phone / use it in a Zoomed display mode if
      you have one set. Nothing overlaps.
      What I saw: ______________________________________________

### 3.2 It does not sign me out — the storage-jar fix proving itself

**Build B (production) only.** A dev client shows its own launcher while it
reconnects to Metro, so "no sign-in screen flashed on the way in" is not
observable on build A.

This is the failure that made friends re-login on the web every launch. The
native client keeps its session in the app's own storage rather than in
Safari's, so it should not happen here. That is a code read until this box is
ticked.

- [ ] PASS  [ ] FAIL — Background the app (home swipe), use another app for a
      minute, come back. Still signed in, still on the same screen, still the
      right day.
      What I saw: ______________________________________________

- [ ] PASS  [ ] FAIL — Force-quit from the app switcher and relaunch. Still
      signed in. **No sign-in screen flashed on the way in**, and no empty
      "day 1" appeared before the real day.
      What I saw: ______________________________________________

- [ ] PASS  [ ] FAIL — Turn the phone off and on. Launch. Still signed in.
      What I saw: ______________________________________________

- [ ] PASS  [ ] FAIL — Put the phone in airplane mode and launch. It shows my
      real day and streak from the mirror, not an empty state, and says
      something honest about being offline rather than pretending.
      What I saw: ______________________________________________

- [ ] PASS  [ ] FAIL — Still in airplane mode, tick a task. Turn the network
      back on. Either it saved or it told me it didn't — **the screen and the
      toast agree**.
      What I saw: ______________________________________________

### 3.3 Notifications and the timer

**Build B (production) only.** A dev-client launch is intercepted to attach
the bundler, so the cold-launch and deep-link boxes here would be testing a
route the shipping app does not take.

The permission prompt is requested when a timer STARTS
(`useTimerStore.hydrate` → `ensureNotificationPermission`), not at launch. So
this needs a real timer run.

- [ ] PASS  [ ] FAIL — Start a workout timer. The iOS notification permission
      prompt appears. Allow it.
      What I saw: ______________________________________________

- [ ] PASS  [ ] FAIL — Leave the timer running and background the app. The
      running/halfway/5-minute notifications arrive, and each one says the
      right thing at the right time.
      Which fired: ____________________________________________

- [ ] PASS  [ ] FAIL — **Only one of each.** No duplicate "halfway" from the
      clear-then-post sequence.
      What I saw: ______________________________________________

- [ ] PASS  [ ] FAIL — Tap a timer notification while the app is CLOSED. It
      cold-launches and lands on the timer screen, not on Track.
      What I saw: ______________________________________________

- [ ] PASS  [ ] FAIL — Let a timer run out while backgrounded. Come back: the
      task is complete and the elapsed time was recorded.
      What I saw: ______________________________________________

- [ ] PASS  [ ] FAIL — Settings shows the notification permission banner
      correctly for the current iOS setting (deny it in iOS Settings and check
      the banner tells the truth).
      What I saw: ______________________________________________

- [ ] PASS  [ ] FAIL — Tap an emailed sign-in LINK on the phone (rather than
      typing the code). It opens the app and signs in. **If this fails, check
      D1 in `testflight-external.md` first** — a missing
      `rankedfitness://` entry on the Supabase redirect allow-list produces
      exactly this and nothing else.
      What I saw: ______________________________________________

### 3.4 HealthKit — read this item before ticking it

**This section changed. It used to tell you to expect a FAIL. It no longer
does, and the reason matters more than the boxes.**

The build ships the entitlement and the usage description, so the OS will
present a Health permission sheet **when the app asks for it**. It does not ask
on its own. `requestAuthorization` is still called from exactly one place —
the Health switch going ON, either in Settings or via **Connect** on the
Today's Health card.

What changed is what happens before you touch that switch. `healthEnabled`
used to default to TRUE, so on a fresh install the switch was already on,
nothing ever asked, no grant ever existed, every reading came back null, and
the card drew them as `0 steps`, `0 active kcal`, `—`, "No workouts recorded
today." Those zeroes were the absence of permission being printed as data.

Three things now prevent that:

1. **`healthEnabled` defaults to FALSE.** OFF is the only value that is true
   on a phone that has never asked, and it makes the switch mean "ask me now".
2. **The switch and the card read CONNECTED, not the stored preference.**
   Connected = HealthKit is present AND iOS says this device has been shown
   the sheet AND the switch is on. A phone carrying a `true` from an older
   build still lands on the Connect prompt.
3. **A null reading is never rendered as a number.** It renders as `—`, and
   the card says why it cannot be more specific.

**The thing the app genuinely cannot know, and does not pretend to.** iOS
reports no authorization status for READ types. A denied type returns no
samples — byte for byte identical to a type you simply have no data in — and
there is no API that separates them. That is deliberate on Apple's part:
"this app was denied heart rate" would itself be a health disclosure. So when
nothing comes back, the card says nothing came back and that iOS will not say
which reason, and it offers you Settings. It does not guess. **If you see the
app assert either answer, that is a FAIL.**

#### 3.4.0 READ THE RAW AUTH STATUS FIRST — everything below depends on it

**This box is build A (`--profile development`). Every other box in §3.4 is
build B.** See "Which build each section needs" at the top of this file.

**Do this before any other Health box. If it fails, none of the rest of §3.4
is testable and you should stop rather than work through boxes that cannot
pass.**

`getRequestStatusForAuthorization` is the one call this whole section hangs
off: it is what tells the app "this device has been shown the sheet", and
every state below is downstream of it. It is a Nitro native call and **it has
never executed**. The JS enum is numeric at runtime — verified in
`node_modules` — but nothing short of your phone proves the native side hands
back a number.

If it hands back something else, the app resolves `'unknown'`, treats that as
not-asked, and the card reads **"Not connected" for ever even after you grant
access**. That symptom is indistinguishable from a denied permission, which is
an hour spent on the wrong theory. The parser now also accepts the numeric
string and the enum spelled by name, so several plausible surprises are
already handled — this box tells you which one you actually got.

**How to read it. This is build A, and it is the reason build A exists.**

**The route to take — `--profile development` (build A).** Two ways to the
same value, neither needing anything you do not already have:

1. `npx expo start --dev-client` on the PC, launch the app, open Track. The
   line prints straight into that terminal window:
   `[health:auth-status] raw=… typeof=… parsedAs=…`. A dev build runs its JS
   from Metro, so its console is your console.
2. Long-press the **RANKED** wordmark in the header for 600ms to open the dev
   sheet, and read the row **"Health auth status (raw)"**. Same value, and it
   survives a scrolled-away terminal.

**Why not just read it off the TestFlight build.** The `console.warn` is
unconditional — it fires in build B too — but on iOS it goes to the device's
unified log, and getting at that from Windows means:

- **`idevicesyslog`**, from **libimobiledevice** (Windows builds:
  `libimobiledevice-win32`, or the `imobiledevice-net` packages). Needs Apple
  Mobile Device Support installed for the USB driver, and needs the device
  paired and unlocked. `idevicesyslog | findstr health:auth-status` is the
  whole command once it works. Getting it to work on a current iOS is the
  part that is not five minutes.
- or **3uTools** for Windows, which has a *Real-Time Log* pane over the same
  service with a GUI instead of a pairing dance.

Neither is wrong, and if you already have one running, use it. But **the
honest answer is that on Windows this is more work than making build A**, and
build A also gives you the dev sheet, the day-rollover control and the
simulated-Health card while you have it.

**Console.app and Xcode are the Mac answers and are not the plan.** You do
not have a Mac. Nothing in this gate requires one — `eas build` compiles in
the cloud, and everything else is readable from the phone or from Metro.

Nothing about this ships as a visible element to your friends: the dev sheet
is `__DEV__`-only and absent from a production bundle, and a log line is not a
surface. The value logged is an **OS authorization enum (0/1/2)** — never a
health value. No step count, no weight, no workout goes anywhere near it.

- [ ] PASS  [ ] FAIL — Fresh install, before granting anything. Open Track,
      then read the raw value.
      raw: __________  typeof: __________  parsedAs: __________
      **Expect `raw=1 typeof=number parsedAs=not-requested`.**

- [ ] PASS  [ ] FAIL — Now grant access (Connect → Allow), pull to refresh on
      Track, read it again.
      raw: __________  typeof: __________  parsedAs: __________
      **Expect `raw=2 typeof=number parsedAs=requested`.**

**If `typeof` is not `number`:** that is the diagnosis. Write down exactly what
came back — that string is the whole fix. If `parsedAs` still resolved
correctly, the tolerant parser absorbed it and you can carry on through §3.4,
noting it. If `parsedAs` is `unknown`, **stop**: every box below will fail for
this one reason, and none of those failures would be about what it is testing.

#### 3.4.1 Before you have ever granted permission — the case every friend hits first

**Build B, and it must be a genuinely first launch.** If you granted Health on
build A, delete the app and confirm Ranked Fitness is gone from iOS Settings →
Privacy & Security → Health → Apps before you start — otherwise iOS reports
this device as already asked and this box tests nothing.

Do this on the FIRST launch after installing, before opening Settings.

- [ ] PASS  [ ] FAIL — Track screen. The Apple Health card reads
      **"Apple Health — Not connected."** with a short line about steps,
      energy and workouts and a **Connect** button. There is **no** row of
      figures, **no** `0`, and **no** "No workouts recorded today."
      What I saw: ______________________________________________

- [ ] PASS  [ ] FAIL — Settings → Apple Health. The **Connect Apple Health**
      switch is **OFF**, and the three sub-rows (diet prompt, workout prompt,
      weight pre-fill) are **hidden** — they only appear once connected.
      What I saw: ______________________________________________

- [ ] PASS  [ ] FAIL — Nothing anywhere in the app claims to have Health data.
      Check the check-in card in particular: no weight is pre-filled, and no
      workout suggestion appears on any task row.
      What I saw: ______________________________________________

#### 3.4.2 Asking, and the two answers

- [ ] PASS  [ ] FAIL — Tap **Connect** on the Track card (or turn the Settings
      switch ON — same code path). The iOS Health sheet appears, listing
      read-only access to dietary energy, body mass, steps, active energy and
      workouts, and **no write access**. You should NOT have to turn the
      switch off and on again to reach it — that was the old bug.
      What I saw: ______________________________________________

- [ ] PASS  [ ] FAIL — **Deny it** (turn every category off, tap Allow). The
      app does not crash. The card now says Apple Health returned nothing for
      today, states that this is *either* no data *or* no access, *and* that
      iOS does not tell apps which — and offers **Check access in Settings**.
      It does **not** show zeroes, and it does **not** claim you denied it.
      Write down the card's exact wording: ____________________
      ____________________________________________________________

- [ ] PASS  [ ] FAIL — Tap **Check access in Settings**. iOS Settings opens on
      the Ranked Fitness page, with a **Health** row you can go into and change.
      What I saw: ______________________________________________

- [ ] PASS  [ ] FAIL — Now grant it (Settings → Health → turn the categories
      on), return to the app, pull to refresh on Track. The app does not
      crash, and whatever it now shows matches the Health app for today.
      Health app steps: ______  Card steps: ______
      Health app active kcal: ______  Card active kcal: ______

- [ ] PASS  [ ] FAIL — Grant SOME but not all: leave **Workouts** off, keep
      steps on. The card shows real steps, and the workout line reads
      "Apple Health returned no workouts for today" — **never** "No workouts
      recorded today", because with workouts denied the app has not been told
      anything about your day.
      What I saw: ______________________________________________

- [ ] PASS  [ ] FAIL — Any figure the app has not been given is a **dash**,
      with the footnote explaining that a dash means Apple Health returned
      nothing and iOS does not say whether that is no data or no access. If
      you have never weighed yourself in Health, the weight cell is the easy
      one to check.
      What I saw: ______________________________________________

- [ ] PASS  [ ] FAIL — Turn the Settings switch back OFF. The card returns to
      the Connect prompt immediately. No stale figures remain on screen.
      What I saw: ______________________________________________

#### 3.4.3 The preference-sync interaction — check this on the SECOND device

This is the item that would be invisible on one phone. `health_enabled` is
**not** synced to your account, deliberately: an Apple Health grant is issued
by iOS to one device and cannot travel. If it synced, a second device would
show an ON switch having never asked for anything — the same defect as the old
default, arriving by sync instead.

- [ ] PASS  [ ] FAIL — With Health connected and granted on this phone, sign
      into the same account on the web app (or a second device). The Health
      switch there is **OFF / the section is absent** (the web build has no
      HealthKit at all, so the whole section is correctly missing).
      What I saw: ______________________________________________

- [ ] PASS  [ ] FAIL — Turn a **diet prompt / workout prompt / weight pre-fill**
      sub-switch off on the phone, then check it stayed off after a
      sign-out/sign-in. Those three ARE account preferences and must survive.
      What I saw: ______________________________________________

- [ ] PASS  [ ] FAIL — Run the last two rows of `0013_preference_sync.sql`'s
      verification `SELECT` again, after all of the above. Both must read
      **OK**; `stamped rows claiming a Health grant` must be `0`. A non-zero
      there means a client wrote `health_enabled = true` to your account,
      which no fixed build can do.
      What I saw: ______________________________________________

#### 3.4.4 Still 17B

- [ ] N/A — needs 17B — Health-derived workout suggestions matching a task.
      The prompt-and-confirm flow exists in the store and is now correctly
      gated on a real connection, but 17B is where reading Health becomes a
      feature with a spec. Do not tick this PASS.

- [ ] N/A — needs 17B — Weight pre-fill from Health into the weekly check-in.
      Same reason.

---

## 4. What happens when the build expires — the safety net

**Build B only** — there is no TestFlight build on build A to expire.

A TestFlight build stops working 90 days after upload. A 75-day challenge does
not fit inside that with room to spare, and some of the live challenges finish
after this build dies (the exact dates are in `testflight-external.md`, D3).

**Nobody is locked out when that happens.** The web version stays live at
<https://alymalji.github.io/>, on the same Supabase project, with the same
account, the same challenge row, the same streak and the same squad — which is
what `two_client_test.sql` proves and what section 1 of this file confirms on
hardware. An expired build is an inconvenience: reinstall the new one, or
finish on the web. It is not lost progress, and no day is missed by it.

That is the argument for keeping the web app running **permanently**, not just
through the transition:

- it is the fallback for an expired build, a lost phone, an Android friend, and
  anyone who does not want TestFlight at all;
- it costs nothing to keep — a static GitHub Pages site against a database that
  is already there for the app;
- and it means "install the app" is always an invitation, never a requirement.

- [ ] PASS  [ ] FAIL — With the native app installed and signed in, open the
      web app on a laptop, signed into the same email. Both show the same day,
      the same streak and the same squad at the same moment.
      What I saw: ______________________________________________

---

## 5. Sign-off

- [ ] Every box above is PASS, or FAIL with a written decision beside it.
- [ ] The two `N/A — needs 17B` items are still N/A and are not being counted
      as working.
- [ ] Anything that failed is either fixed and re-run, or written down here as
      a known issue I have decided to ship with:

  ________________________________________________________________
  ________________________________________________________________
  ________________________________________________________________

Date run: ____________   Build number: ____________   iOS version: ____________

Only now: `eas submit`, Beta App Review, and the link goes out.
