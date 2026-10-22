# TestFlight — the production build, step by step

Written 2026-10-21 (Phase 38S). This takes the app from the laptop's dev
server to a standalone iPhone app you install from TestFlight, that opens
without the laptop and reminds you before noon.

**Nothing here was run for you.** No `eas build`, no `eas submit`, no
credentials were used. Every step is yours; each has a check, and what to do
if the check fails.

Commands are PowerShell, run in `C:\dev\App`. Use `eas.cmd`, not `eas`
(PowerShell's script policy blocks `eas.ps1`). If `eas.cmd` is not found,
`npm install -g eas-cli` first (same as `docs/first-dev-build.md` §2).

The order:

1. **Internal TestFlight, you only.** No Beta App Review. Installable the
   same hour.
2. You use it for a few days.
3. **[EXTERNAL]** External TestFlight for the squad. That needs Beta App
   Review; §7 has it, and nothing in §1–§6 waits on it.

---

## 0. Before you start — what is in this build

Everything that reached native since the 27 Sep development build:

| Phase | What |
| --- | --- |
| 38M | Health speaks the installed HealthKit library's call shapes; a dev build is told apart from Expo Go; a Health diagnostics card (dev builds only). |
| 38N | One workout recorded by two apps counts once; six more Health reads (sleep, water, mindful minutes, resting HR, HRV, respiratory rate) and the purpose string that names all eleven; "last night" and "woke up" defined; link a task to Health; Last Night, recovery and 7 days on Track. |
| 38O | PROOF: the screen (native only), its model, the halfway and Day 75 reports, reading the two weeks before Day 1. |
| 38P | A missed day can be restored every time, not once per run; the client keeps no memory of a restore. |
| 38Q | Catch-up: a run of unlogged days reopens in one go (up to 14 days back), and the deck walks them oldest first, then today. |
| 38R | The Reopen button sends the RPC the offer named (`catch_up_missed_days` for a range). |
| 38S | The last-call reminder before noon; a reminder tap opens check-in; no Push entitlement; roster fixes (no "0/0", no "Squad starts today" on day 35, one set of initials); notification copy. |

The production bundle was exported and checked (`npx expo export --platform
ios`): neither diagnostics card's title is in it, there is no `service_role`
string and no `sb_secret_` key. One `sb_secret_` byte sequence exists, and it
is supabase-js's own prefix check (`key.startsWith("sb_secret_")`), not a key.

---

## 1. App Store Connect → the app record

1. Sign in at <https://appstoreconnect.apple.com> with your Apple Developer
   account → **Apps** → the **+** at the top left → **New App**.
2. Fill in:
   - **Platforms:** iOS.
   - **Name:** `Ranked Fitness`.
   - **Primary language:** English (U.S.) or (U.K.), whichever you prefer.
   - **Bundle ID:** pick `com.aly786.rankedfitness` from the list. It is
     there because the development build registered it.
   - **SKU:** anything only you will see, e.g. `RANKEDFITNESS001`. It never
     appears to users and cannot be changed later.
   - **User Access:** Full Access.
3. **Create**.

**Check:** the app opens on its App Information page. Under **General
Information** there is an **Apple ID** — a number like `6740000000`. Write it
down; `eas submit` may ask for it, and it is the `ascAppId`.

**If the name is taken** ("The app name you entered is already being used"):
App Store names are unique across the whole store. Use a variant — `Ranked
Fitness: Squad 75`, `Ranked — Fitness Squad`, `Ranked Fitness Challenge`. The
name on the phone's home screen comes from `app.json` (`Ranked Fitness`), not
from this field, so TestFlight testing is unaffected by which variant you
pick. You can rename the App Store record later, before a public release.

**If `com.aly786.rankedfitness` is not in the Bundle ID list:** sign in at
<https://developer.apple.com/account/resources/identifiers/list> and confirm
the identifier exists. If it does not, stop: something is wrong with the
account the dev build was made on — do not create a new bundle id
(`CLAUDE.md`: changing it destroys the signing setup).

**What testers see as the developer.** On an individual (not organization)
Apple Developer account, Apple says: "Your personal legal name is needed so
that you can enter into contracts with Apple. Your name will be displayed as
the seller name of your apps on the App Store."
(<https://developer.apple.com/programs/enroll/>, "Enrolling as an
individual"). Apple's TestFlight page does not say what TestFlight shows; in
practice expect the same seller name. If you do not want your legal name on
the public listing, the only route Apple offers is an organization
membership, which needs a legal entity and a D-U-N-S number. That matters for
§7, not for internal testing.

---

## 2. The build — `eas.cmd build --profile production --platform ios`

```powershell
eas.cmd whoami          # must print the Expo account; if not: eas.cmd login
eas.cmd build --profile production --platform ios
```

What it asks, in order, and what to answer:

1. **"Do you want to log in to your Apple account?"** → **Yes**. Your Apple
   ID email and password, then the **two-factor code** on your iPhone or Mac.
   This is EAS talking to Apple for you; the password is not stored in the
   repo.
2. Possibly **"Select a Team"** → your individual team.
3. **Remote build number.** `eas.json` has `appVersionSource: remote` and
   `autoIncrement: true`, so EAS keeps the build number on its servers and
   adds one on every production build. On the first one it may ask whether
   to initialize it (from `1`, what `app.json` would give) → **Yes**.
4. **Distribution certificate.** "Generate a new Apple Distribution
   Certificate?" → **Yes**. Let EAS manage it. (The development build used
   a *development* certificate; the store needs a *distribution* one. If EAS
   finds an existing distribution certificate it offers to reuse it → yes.)
5. **Provisioning profile.** "Generate a new Apple Provisioning Profile?" →
   **Yes**. It will be an App Store profile with **HealthKit** and nothing
   else — no Push Notifications, because the app does not use push (see
   "Why no Push" below).
6. Possibly **"Would you like to set up Push Notifications?"** → **No**.

Then it uploads the project and queues. **Typical time: 15–30 minutes**
(queue + about 10–15 minutes of build). You can close the terminal; the link
it prints shows progress at <https://expo.dev>.

**Check — it succeeded when:** the terminal (or the build page) says
**Build finished** and shows an **.ipa** artifact; the build page lists
Profile `production`, Distribution `store`, version `1.0.0`, and a build
number. A store build cannot be installed from that page — that is expected;
it goes through TestFlight.

**If it fails:**

- **At "Install dependencies"** with `Missing: @emnapi/... from lock file`:
  the 38L failure. The lock must be written by npm 10:
  `npx -y npm@10.9.4 install --package-lock-only --ignore-scripts`, commit,
  rebuild. (38S re-checked: the committed lock passes `npm ci` under
  npm 10.9.4.)
- **At credentials** ("You have reached the maximum number of
  certificates"): Apple allows a small number of distribution certificates.
  Revoke an old unused one at developer.apple.com → Certificates, or let EAS
  reuse an existing one.
- **Anything else:** open the build page, expand the failed phase, and copy
  the first red line. That line is what to search or hand back.

### Why no Push

The daily reminder is a *local* notification: the app schedules it on the
phone. Nothing asks for a push token. expo-notifications' SDK 54 plugin adds
`aps-environment` regardless (and Expo applies that plugin even when it is
not listed), so `plugins/withoutPushEntitlement.js` takes it out. The
`enableRemoteNotifications: false` switch in Expo's current docs
(<https://docs.expo.dev/versions/v54.0.0/sdk/notifications/>: "If set to
`false`, the plugin does not add the APNs entitlement") is not in the
installed 0.32.17 plugin, which reads only `mode`, `sounds` and
`enableBackgroundRemoteNotifications`. `npm run test:entitlements` holds the
result:

```
$ npx expo config --type introspect   →   ios.entitlements
{
  "com.apple.developer.healthkit": true
}
```

---

## 3. Upload — `eas.cmd submit --profile production --platform ios --latest`

```powershell
eas.cmd submit --profile production --platform ios --latest
```

`--latest` submits the most recent iOS build (`eas submit --help`: "Submit
the latest build for specified platform"). What it asks:

1. **Apple ID** (first run) and the 2FA code, as in §2.
2. **Which app** — it may ask for the **ascAppId** from §1 (the number under
   General Information → Apple ID). It is not in `eas.json` yet; once you
   know it you can add it under `submit.production.ios.ascAppId` so it never
   asks again.
3. **An App Store Connect API key.** Recommended: let EAS **generate a new
   API key** when it offers. It is stored with your Expo account's
   credentials, not in the repo. (Expo documents it under
   `eas credentials --platform ios` → "Set up your project to use an API Key
   for EAS Submit"; <https://docs.expo.dev/submit/ios/>.) The alternative is
   an **app-specific password** from <https://account.apple.com> → Sign-In
   and Security → App-Specific Passwords, supplied as
   `EXPO_APPLE_APP_SPECIFIC_PASSWORD`. The key is less fiddly.

**Check:** it ends with **"Submitted your app to Apple App Store Connect!"**
(or similar). Expo: "the build appears in TestFlight after processing, which
usually takes 10 to 15 minutes" (<https://docs.expo.dev/submit/ios/>).

**If it fails:** "No suitable application records were found" → §1 was not
done, or with a different bundle id. "Authentication failed" → re-run and
choose the API key route.

---

## 4. App Store Connect → TestFlight → your phone

1. App Store Connect → your app → **TestFlight** tab. The build shows under
   **iOS Builds** as **Processing**. Wait. 10–15 minutes usually; it can be
   longer.
2. **Export compliance.** `app.json` sets `ITSAppUsesNonExemptEncryption:
   false`, so the build should not show **Missing Compliance**. If it does:
   **Manage** → "None of the algorithms mentioned above" (the app uses only
   the HTTPS iOS provides) → Save.
3. **Add yourself as an internal tester.** Left sidebar → **Internal
   Testing** → **+** → name the group `Me` → add yourself (you are an App
   Store Connect user already, as the account holder) → enable automatic
   distribution → **Create**. Then on the group, **Builds → +** and pick the
   build if it is not there. Internal groups take "up to 100 App Store
   Connect users" and no review applies to them; review is only when "you
   invite external testers"
   (<https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview>).
4. On the iPhone: install **TestFlight** from the App Store. Open the
   invitation email (sent to your Apple ID address) → **View in TestFlight**
   → **Install**. Or open TestFlight; the app is listed.

**Check:** a **Ranked Fitness** icon (the R with the flame) on the home
screen. It opens with the laptop switched off.

The development build and the TestFlight build can both be installed only if
they have different bundle ids; they do not, so installing from TestFlight
**replaces** the development build. Your account, challenge and squad are on
the server and come back when you sign in.

---

## 5. First run on the production build

1. **Sign in** with your email and the 6-digit code. Tapping the link in the
   email should open the app (`rankedfitness://`) — if it opens Safari
   instead, the redirect allow-list is missing the scheme; §7.4. The code
   works either way.
2. **Day 56 and the streak.** Home shows **Day 56** (or whatever today is),
   and the header shows the streak and the best. They must match what the
   web app shows at <https://rankedfitness.github.io>.
3. **Turn the reminder on.** Settings → **Daily reminder** → switch on. This
   is the moment iOS asks "Ranked Fitness Would Like to Send You
   Notifications" → **Allow**. (It is also asked the first time you start a
   timer, whichever comes first; never at launch.) The row says: "At 8:00 PM
   while the day is open, and once more three hours before it closes."
   If you tapped **Don't Allow**: the row says notifications are off and
   offers **Open Settings**.
4. **Connect Health.** Settings → Apple Health → on. The iOS sheet lists the
   eleven types, and its text should begin "Ranked Fitness reads from Apple
   Health only to show you your own numbers…" and say "Everything read stays
   on this phone". Turn on what you want; Today's Health card fills in.
5. **What to check tomorrow morning:**
   - **20:00 tonight**, if today is not locked in: "Day 56 is open until noon
     tomorrow."
   - **09:00 tomorrow**, if today is still not locked in: "Day 56 is still
     open for three more hours." Tapping it opens check-in (until 38S the
     tap opened the app wherever it last was).
   - If you locked Day 56 in **on this phone** before 09:00, that 09:00 one
     must **not** arrive. That is the case that matters.
   - The times follow the server's noon in the challenge's timezone, minus
     three hours, on the phone's clock. If the phone is in another zone, the
     time shifts; the words do not name a clock time.

**What cannot be checked without a phone, and was not:** that iOS delivers
the 09:00 notification while the app is closed; that removing the Push
entitlement leaves local notifications working (expected — they need no
entitlement — but unverified on a device); that the emailed link opens the
production app. And one known limit: a day locked in **on the web** is not
seen by the phone until the app next opens, so the 09:00 reminder for it can
still arrive. It is true when it fires (the day is open for three more hours)
but chases a day already done.

---

## 6. The 90-day expiry

"You can test a build for up to 90 days." and "Your build becomes
unavailable for testers after 90 days."
(<https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview>)

The clock starts when the build is **uploaded** (§3), not when you install
it. Upload on day X → it stops opening on about day X + 90. TestFlight shows
the days left on the build.

**There is no update that extends it.** An `eas update` (over-the-air
JavaScript) does not reset the clock: the binary is what expires. The only fix
is a new build and a new upload — §2 and §3 again. `autoIncrement` gives it the
next build number; testers get it through TestFlight. Put a calendar entry at
**upload + 60 days** to rebuild. If it does lapse, nobody is locked out: the
web app at <https://rankedfitness.github.io> is the same account, challenge
and squad.

---

## 7. [EXTERNAL] Later — the squad

None of this blocks §1–§6.

### 7.1 External group and test information

TestFlight → **External Testing** → **+** → group `Squad`. Fill in **Test
Information** (left sidebar): beta app description, feedback email
`rankedappfitness@gmail.com`, privacy policy URL
`https://rankedfitness.github.io/privacy.html`, and the review notes below.
Add the build to the group → **Submit for Review**. "A review is required only
for the first build. Subsequent builds may not require a full review." Once
approved, turn on **Public Link** for the group and send it to the squad.

**Before submitting:** deploy the web build so the live privacy page is the
38S one (`npm run build:web`, then the Pages copy). It now names every Health
type the app reads and says none of it leaves the phone; the live one does
not yet.

### 7.2 Reviewer access — what you create

Per `docs/testflight-external.md` D2:

- **A dedicated review mailbox** — a new address only for App Review, with
  web access, never a personal one. You create it.
- **Two demo accounts** signed up with it (and a second address for B),
  **in their own squad**: A creates `Demo Squad`, B joins with its code.
  Never in the friends' squad, and never give either the friends' code.
- About ten days of history on both before submitting.

`supabase/tests/demo_account_test.sql` (in `npm run test:rls`) proves the
shape before either exists: the reviewer sees the demo squadmate's roster row
and nothing behind it, and reads no row of a real user's in 14 tables or the
roster RPC; its writes, pings and code-less joins are refused. It ran on the
local Docker stub, not the live project; once the accounts exist, run the
three-row check in `docs/testflight-external.md` D2 in the live SQL editor.

### 7.3 Beta App Review notes — draft

> **What it is.** Ranked Fitness is a challenge tracker for a small group of
> friends running the same daily challenge (75 Hard style). Each person ticks
> off their own daily tasks; the squad sees who has finished today, never the
> details.
>
> **Signing in.** There is no password. Enter the demo address
> `<review mailbox address>` on the sign-in screen; a 6-digit code is emailed
> to it. The mailbox is at `<provider URL>`, password `<password>`. Enter the
> code in the app. This account is in a squad with a second demo account so
> the Squad tab has someone in it.
>
> **Apple Health.** Optional, off until the user turns it on in Settings →
> Apple Health. The app only reads (steps, active energy, workouts, dietary
> energy, water, weight, sleep, mindful minutes, resting heart rate, heart
> rate variability, respiratory rate) to show the user their own numbers and
> to suggest ticking off a task they linked to Health. Health data never
> leaves the device: it is not sent to our server, not stored, not logged,
> and not visible to squadmates. Only a task the user confirms as done is
> shared.
>
> **Empty Health data is expected** on a review device with no Health
> history: the cards say there is nothing recorded rather than showing a
> zero.
>
> **Notifications.** Local only: an optional daily reminder scheduled on the
> device. No push service.
>
> **Account deletion.** Settings → Delete account.

### 7.4 `rankedfitness://` on the Supabase redirect allow-list

**Not verified** — the dashboard needs your login. To check, and add only if
missing:

Supabase dashboard → project `dmlgdqufkrtrjgbofpkd` → **Authentication** →
**URL Configuration** → **Redirect URLs**.

- **Site URL: do not touch.**
- In **Redirect URLs**, whatever is there **stays**. Look for
  `rankedfitness://` and `rankedfitness://**`. If either is missing,
  **Add URL** → type it → Save. Add, never edit or replace an entry.
- The web origin is now `https://rankedfitness.github.io` (38J). If it is
  not on the list, add `https://rankedfitness.github.io/**` as well.

Check: sign in on the web with an emailed link (still works), then on the
phone (the link opens the app). The full reasoning is
`docs/testflight-external.md` D1; its host names predate the 38J move.

---

## Reported, not fixed (need SQL; none blocks this build)

- **XP is never awarded.** "LVL 1 · 0 XP" beside 34 perfect days is not a
  display bug and not working as designed. XP is meant to be server-computed
  (`CLAUDE.md`: "Streaks, XP … are computed by SECURITY DEFINER RPCs"), but
  no migration ever increments `profiles.xp` — the only writes set it to 0
  (restart, delete). The app adds XP on screen optimistically (20 a task,
  120 a day) and the next refresh puts back the server's 0. Fixing it needs
  an RPC or trigger that pays XP on completion and seal, and a decision on
  back-paying past days.
- **"Still finishing Day N · 0/0".** `get_squad_status` returns
  `grace_tasks = 0` when the open day has no `challenge_days` row (the
  member never opened the app that day, so nothing froze it). The roster now
  drops the count instead of showing 0/0; the root fix is to fall back to the
  member's task count in the RPC.
- **The feed after a reopen.** A correction line *is* posted: 0019's restore
  posts "reopened Day N. The miss stands until the day is completed." when it
  finds the miss item, and 0020's catch-up always posts "reopened Days A–B.
  The misses stand until each day is completed." But it is posted at the
  time of the reopen, at the top of the feed, not beside the miss; and
  **nothing is posted when a reopened day is then sealed** — `seal_day`
  writes no feed row, and the app's own "locked in" line is local only. So a
  squadmate's feed still ends on "the miss stands until the day is completed"
  for a day that was completed. Fixing it needs `seal_day` to post a line
  when it seals a day that was reopened.
- **The duplicate member.** `docs/sql/duplicate-roster-names.sql` — one
  read-only statement with a `section` column — says whether a name shown
  twice is two accounts or one drawn twice. `squad_members`' primary key is
  `(squad_id, user_id)`, so two rows for one squad are two user ids at the
  database level; the query shows both accounts' sign-in dates and masked
  emails so you can tell whether it is one person on two addresses. Nothing
  is changed until you have read it.
