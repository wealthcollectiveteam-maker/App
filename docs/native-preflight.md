# Native build pre-flight (Phase 38G, G3) — no build, no credentials, no EAS run

Written 2026-09-24 against the repo at the 38G commits. Nothing here was
executed on a device or through EAS. Each answer names what it was read
from; the unknowns are listed as unknowns.

## 1. Hermes and `Intl` — first, above everything

`app.json` sets no `jsEngine`, so the build takes Expo SDK 54's default:
Hermes, on the New Architecture. Whether `Intl` works on that Hermes is the
question every date path in this app depends on, and I could not verify it
here. What I can say from the code is exactly where it would break.

**Every call site**, from a grep of `src/` for `Intl.`, `toLocale*`,
`DateTimeFormat` and the localization module:

| File | Call | What it does |
|---|---|---|
| `src/lib/dayLabel.ts:45` | `new Intl.DateTimeFormat('en-US', { timeZone })` + `formatToParts` | The calendar date a day number means. The Day 18 / "Sunday, November 1" label on check-in. |
| `src/lib/dayLabel.ts:71` | `new Intl.DateTimeFormat(undefined, { ...options, timeZone: 'UTC' })` | Formats that date for display. |
| `src/lib/writeDay.ts:132,150` | `new Intl.DateTimeFormat('en-US', { timeZone })` + `formatToParts` | **The day-boundary timer**: when the next midnight or noon is, in the challenge's zone. |
| `src/services/backend/api.ts:418` | `Date.toLocaleTimeString(undefined, { hour, minute })` | The completion time shown on a ticked task row. |
| `src/services/backend/SupabaseDataService.ts:1702` | `toLocaleTimeString` | Same, for an optimistic tick. |
| `src/services/timerEffects.ts:109` | `toLocaleTimeString` | "ends at 7:45 PM" in timer notifications. |
| `src/components/TodaysHealthCard.tsx:17,24` | `toLocaleTimeString`, `toLocaleDateString` | Health card times and dates. |
| `src/components/WeeklyCheckinCard.tsx:107,201`, `src/app/metrics-history.tsx:33`, `src/app/my-challenge.tsx:44`, `src/components/WorkoutSuggestion.tsx:26` | `toLocaleDateString` / `toLocaleTimeString` | Dates and times on cards. |
| `src/app/(tabs)/squad.tsx:731`, `track.tsx:273`, `you.tsx:153`, `TodaysHealthCard.tsx:133,140` | `Number.toLocaleString()` | Thousands separators on XP, calories, steps. |
| `src/app/(tabs)/index.tsx` (38G) | `toLocaleDateString(undefined, { month, day, timeZone: 'UTC' })` | "September 29" in the restore offer; falls back to the ISO date. |
| `src/services/backend/session.ts:34`, `src/store/useAppStore.ts:467` | `expo-localization` `getCalendars()` / `getLocales()` | The device zone sent to `create_challenge`, and the unit default. Native module, not `Intl`. |

**What breaks if `Intl` is absent**, in order of harm:

1. `writeDay.ts` — `usableZone()` wraps its `DateTimeFormat` in a try/catch,
   so an absent `Intl` degrades to the device zone rather than throwing, but
   `msUntilNextBoundary` then computes the wrong noon for a person whose
   phone is not in the challenge's zone. The foreground refresh is the
   backstop, so the failure is "stale window until reopened", not a wrong
   write. Every write still names its day and the server refuses a closed
   one.
2. `dayLabel.ts` — `dayThatCloses` throws on an unknown zone and the caller
   falls back; with no `Intl` at all it would throw inside `formatToParts`
   and the date label on check-in would be missing or wrong. Labels only.
3. `toLocale*` — on an engine without `Intl`, these return an unlocalized
   fallback string rather than throwing (the ECMA-262 non-`Intl` behaviour).
   Times would read like `19:45:00` and numbers lose separators. Ugly, not
   wrong.

**How it would be caught before TestFlight, not after.** Two ways, in order:

- **Expo Go on the provisioned device, first.** Expo Go ships Hermes with
  the same `Intl` the build would have. Open the app, look at the check-in
  screen's date label and a ticked task's time. If both render as they do on
  the web, the paths above work on this Hermes. This costs nothing and needs
  no credentials.
- **A dev-only boot assertion.** A small check at app root, `__DEV__` only,
  that constructs `new Intl.DateTimeFormat('en-US', { timeZone:
  'America/New_York' }).formatToParts(new Date())` and reads a `day` part,
  and logs one unmistakable line if it cannot. It would fire in Expo Go and
  in a development build. Not written in this phase; it is a two-line
  follow-up once the Expo Go check says what the engine does.

What I could not determine: whether SDK 54's Hermes build includes the
`Intl` ICU data for `timeZone` names on iOS. The Expo and Hermes docs I have
read in earlier phases say Hermes has had `Intl` on iOS since React Native
0.70, and SDK 54 is RN 0.81, but I have not run it and will not claim it.

## 2. `app.json` and `eas.json` for an iOS build today

Read from both files.

Present and right: `ios.bundleIdentifier` `com.aly786.rankedfitness`;
`ITSAppUsesNonExemptEncryption: false` (skips the export-compliance
question); `expo-updates` with a runtime policy and an EAS project id;
HealthKit plugin with the `NSHealthShareUsageDescription` text; `preview`
and `production` profiles with the Supabase URL and the publishable key in
`env`; `appVersionSource: remote`; `autoIncrement` on production.

Missing or worth a decision before the first build:

- **No `ios` block in `eas.json` profiles.** No `simulator`, no `resourceClass`,
  no `image`. Defaults are fine for a first internal build; they are listed
  because they are unset, not because they are wrong.
- **`version` is `1.0.0` and there is no `ios.buildNumber`.** With
  `appVersionSource: remote` EAS manages the build number; the marketing
  version stays `1.0.0` until changed by hand.
- **`submit.production` is empty.** A submit needs `appleId`, `ascAppId`
  and `appleTeamId` or interactive login. Nothing here submits.
- **`NSHealthUpdateUsageDescription` is `false`** — correct, the app never
  writes to Health, and this is what keeps the write entitlement out of the
  binary.
- **No `expo-notifications` plugin entry.** The package is installed and
  used by the timer. On iOS, local notifications need no plugin config, but
  a custom sound or icon would; and the notification permission string is
  Apple's default. Fine for a first build.
- **`newArchEnabled` is not set**, so SDK 54's default applies (New
  Architecture on). `@kingstinct/react-native-healthkit` 14 supports it per
  its own README; not verified here.
- **`runtimeVersion.policy: appVersion`** ties OTA updates to `1.0.0`. Any
  native change (a new plugin, a permission string) must bump the version
  or the update channel will serve JS that assumes native code the build
  does not have.
- **`web.output: static`** is irrelevant to iOS and harmless.

## 3. What else is identity-bearing

Beyond the bundle id, which does not change:

- The **EAS project id** `13ba3946-…` in `app.json` `extra.eas.projectId`
  and the `updates.url` that embeds it. Both must belong to the same Expo
  account the build runs under.
- The **Apple Team ID and the distribution certificate / provisioning
  profile** that EAS holds for this bundle id. Not in the repo. A build
  under a different Expo account or Apple team would try to create new
  ones and fail on the existing registration.
- The **push key** the CLAUDE.md mentions is bound to the bundle id. Not
  used yet (no remote push in the app), but it exists in the Apple account
  and must not be regenerated by accident during credential setup.
- The **`scheme`** `rankedfitness` for deep links, and the Supabase auth
  redirect URL that must match it (`docs/testflight-external.md` D1 covers
  adding it without replacing the web one).
- The **Supabase project** `dmlgdqufkrtrjgbofpkd` and its publishable key,
  baked in at build time from `eas.json`. A build from a different `env`
  would talk to nothing.
- The **update channel** names `preview` / `production` in `eas.json`,
  which the built binary asks for by name.

## 4. What a phone does that the web build never had to handle

- **Background and foreground.** The root layout already listens to
  `AppState` and refreshes on `active`; on web that is the visibility
  event. On iOS it is the real thing, and the app can be killed in the
  background at any time. The day-boundary timer (`scheduleDayBoundaries`)
  does not fire while suspended; the foreground refresh is the backstop
  and the code says so. The timer store rehydrates on launch and completes
  an elapsed timer. Nothing here is new to the code; all of it is new to
  execution.
- **Notification permission.** The timer asks on first use
  (`ensureNotificationPermission`). iOS asks once, and a refusal is
  permanent until Settings. The web build never showed this dialog. The
  reminder (A4) will need the same permission and should ask from a tap in
  Settings, not at launch.
- **HealthKit permission.** The dialog the web build never had. The
  `health-auth` and `health-card` suites cover the state machine; the
  dialog itself has never been seen. `docs/device-gate.md` §3.4 is the
  checklist for it.
- **Timezone change mid-run.** The challenge's zone is fixed at creation
  and every boundary is computed in it, server-side. A phone that travels
  gets labels in the challenge's zone (`dayLabel.ts` reads
  `challengeTimezone`) and a boundary timer in the challenge's zone
  (`writeDay.ts`). What changes on a phone: `expo-localization` reports the
  new zone, but nothing re-reads it after sign-up, so a traveller's
  challenge stays in its zone. Correct, and worth saying in the app once.
- **Cold launch from a notification** — handled (`handleColdLaunchNotification`).
- **No address bar.** The update banner is the only way to a new build's JS
  on web; on iOS, `expo-updates` does the same job on launch and foreground.
  Both exist; neither has run on a device.
- **Keyboard and safe areas** — the setup screen uses
  `KeyboardAvoidingView` with iOS padding and one `SafeAreaProvider` at
  root; measured only in Chrome.

## 5. What would leak a real name or a personal email

From `git grep` over tracked files:

- **`src/constants/legal.ts:21`** — `PRIVACY_POLICY_URL` is
  `https://alymalji.github.io/privacy.html`. This URL goes into App Store
  Connect as the privacy policy link and is visible to every reviewer and
  user. The host is a personal GitHub handle. The policy page itself uses
  `rankedappfitness@gmail.com`, which is right; the address bar does not.
- **`docs/testflight-external.md`**, **`docs/device-gate.md:903`**,
  **`docs/privacy-html-draft.md:7`** — the same host, in documentation. Not
  shipped, but in the repo.
- **`new-ui.pdf`** at the repo root — a binary that matches the grep for
  the personal handle. It is tracked. It should not be.
- **The bundle id** `com.aly786.rankedfitness` carries a handle too, and it
  cannot change. It is visible in the App Store URL scheme and in
  crash logs, not on the store page.
- **Git history** — every commit author is `wealthcollectiveteam-maker`
  with a team address, not a personal name. History is not submitted.
- `package.json` has no `author` field. `app.json` has no `owner`. Good.

Nothing in `src/` besides the privacy URL.

## 6. The smallest first build, and what it would not prove

**`eas build --profile development --platform ios`** on the provisioned
device — a development client, internal distribution, with the dev sheet
and the Metro console. `docs/device-gate.md` already names this as build A.
It proves: the native modules link (HealthKit, notifications, audio,
localization, updates); the app boots on Hermes; `Intl` does what the code
assumes; sign-in with the emailed code reaches the tabs; a tick writes to
the real project.

It would **not** prove: the production bundle's credential inlining (a dev
client loads JS from Metro); the update channel; the App Store review
questions (Health usage string wording, export compliance); the
notification permission dialog under a release entitlement; anything about
TestFlight distribution to eleven people; or the reminder, which does not
exist yet.

Cheaper still, and first: **Expo Go on the same phone**, which needs no
build, no credentials and no money, and answers the `Intl` question and the
"does it boot on Hermes" question tonight. Its limit is HealthKit, which
Expo Go does not include, so the health card shows its "unavailable" state
there — which the code already handles.

## Unknowns, plainly

- Whether SDK 54's Hermes on iOS has `Intl` with `timeZone` support. Testable
  in Expo Go in five minutes; not tested.
- Whether `@kingstinct/react-native-healthkit` 14 builds under the New
  Architecture with SDK 54's toolchain.
- The state of the Apple credentials EAS holds: the CLAUDE.md says they
  exist and work; nothing in the repo can confirm it.
- Whether the privacy policy URL is acceptable to review as is. It is a
  valid HTTPS page; the concern is the handle in the host, not the policy.
