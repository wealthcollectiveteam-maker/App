# Can a reminder reach a web user today? (Phase 38E, E3 — estimate only)

Written 2026-09-24 against the build deployed from `e53f395` (bundle
`entry-4e114cc9…`). No code changed for this document. Every claim below
names where it was read; anything read from the network names the page.

## a. Service worker

**None is shipped and none is registered.**

- `dist/` after `npm run build:web` contains no `sw.js`, no `workbox-*`, no
  `service-worker*` file at any depth (`find dist -iname '*sw*.js' -o -iname
  '*service*worker*' -o -iname 'workbox*'` returns nothing).
- The only `serviceWorker` references in the bundle
  (`dist/_expo/static/js/web/entry-*.js`) belong to expo-notifications'
  web module, and they are the refusal path, not a registration:

      serviceWorker)throw new o.CodedError('ERR_UNAVAILABLE','Notifications cannot be used because …
      … `serviceWorkerPath` in `app.json` to use push notifications on the web. Provide the path to th…

  That code runs only if something calls the web push registration, and
  nothing in `src/` does: the app's one notification consumer is the workout
  timer (`src/services/timerEffects.ts`), which schedules local
  notifications and is a no-op where the module is unavailable.
- Expo's static web export (`web.output: "static"` in `app.json`) does not
  generate a service worker on its own; the `dist/` listing above is the
  evidence. The SDK 54 expo-notifications reference page lists
  `Platforms: android, ios` and says nothing about web
  (https://docs.expo.dev/versions/v54.0.0/sdk/notifications/, read
  2026-09-24). Whatever the package's web module can do, it is not a
  documented surface for this SDK.

So a web reminder means writing and registering a service worker ourselves,
plus the subscription and sending pieces in section c.

## b. The manifest, and installability as it stands

`public/manifest.json` (copied verbatim to the Pages root; `npm run
postdeploy` checks it is there):

    name "Ranked Fitness", short_name "Ranked", id "/", start_url "/",
    scope "/", display "standalone", orientation "portrait",
    theme_color / background_color #0A0B0D,
    icons: 192 any, 512 any, 512 maskable

Every exported page also carries, from `src/app/+html.tsx`:

    <link rel="manifest" href="/manifest.json">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="apple-mobile-web-app-title" content="Ranked">
    <meta name="mobile-web-app-capable" content="yes">
    <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">

Against Chrome's published installability criteria
(https://web.dev/articles/install-criteria, read 2026-09-24): the manifest
must have `short_name` or `name`, icons at 192 and 512, `start_url`, a
`display` of fullscreen / standalone / minimal-ui / window-controls-overlay,
no `prefer_related_applications: true`, and the site must be served over
HTTPS. GitHub Pages is HTTPS. Every item is met. That page lists no service
worker requirement for install; I did not find a statement of when that
requirement was dropped, so I am not asserting a date.

On iOS, Add to Home Screen needs only the manifest plus the apple meta tags
above (the WebKit post in section c describes "Home Screen web apps" as
sites added with a manifest whose `display` is `standalone` or
`fullscreen`).

**So the app is installable today on both platforms, on paper.** Nobody has
been asked to install it, there is no in-app prompt, and I could not
confirm the install on a device.

## c. iOS Safari: what web push actually requires

Source: WebKit, "Web Push for Web Apps on iOS and iPadOS"
(https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/,
read 2026-09-24). What it says:

- Introduced in iOS and iPadOS 16.4, for **Home Screen web apps** — sites
  added to the Home Screen with a manifest whose `display` is `standalone`
  or `fullscreen`. A page open in a Safari tab cannot subscribe.
- Permission must come from a tap: "A web app that has been added to the
  Home Screen can request permission to receive push notifications as long
  as that request is in response to direct user interaction — such as
  tapping on a 'subscribe' button provided by the web app."
- It is "the use of Push API, Notifications API, and Service Workers all
  working together", the same W3C Web Push Safari 16.1 shipped on macOS.

So the real preconditions on iOS are, in order: the person installs the app
to the Home Screen; the app registers a service worker (section a: we have
none); the person taps a subscribe control; the app stores the resulting
push subscription; and something on our side sends to it. None of those
five exists today. The first is the one we do not control.

I could not independently confirm the iOS note on caniuse
(https://caniuse.com/push-api): the fetched page showed iOS Safari 16.4
onward as partial support but the note text did not come through. The
WebKit post is the primary source and is sufficient.

## d. Android Chrome

- caniuse (same page, read 2026-09-24) lists Chrome for Android as
  supported, and global Push API support at 96.27%.
- web.dev's push overview (https://web.dev/articles/push-notifications-overview,
  read 2026-09-24): a service worker is required ("JavaScript code that can
  run in the background, even when your website isn't open or the browser
  is closed"); the permission request "should be triggered by a user
  gesture"; and application server keys (VAPID) are effectively required on
  Chrome ("the easiest implementation on Chrome requires it").
- Neither page conditions Android support on Home Screen installation.
  Push subscribes from an ordinary tab.

So on Android the gate is only the pieces we have to build. On iOS it is
those pieces plus an install the person has to perform.

## e. A local scheduled notification in the native build

What already exists: `expo-notifications ~0.32.17` is installed
(`package.json`) and in use. `src/services/timerEffects.ts` sets the handler
at app root, has a permission flow (`getNotificationPermissionStatus`,
`ensureNotificationPermission`), and schedules DATE-triggered notifications
for the timer. The daily-reminder preference and its server column survived
Phase 38A on purpose; only the Settings row that promised it was disabled.

What A4-native would add:

- One repeating schedule per device: expo-notifications' `DailyTriggerInput`
  (`{ hour, minute }`), scheduled when the preference turns on or the app
  foregrounds, cancelled on sign-out or preference off. Content must be
  static and private-data-free (the trigger repeats the same content), e.g.
  "Ranked — tasks still open today." Anything day-specific means
  re-scheduling on every foreground instead.
- Permission: the existing flow, invoked from the Settings switch (a tap,
  as iOS requires).
- Timezone: a daily trigger fires at the device's wall-clock hour. The
  challenge's day boundary is in the CHALLENGE's zone. A person who travels
  gets the reminder at 20:00 where they are, which is the right thing for a
  reminder even when it is not the challenge's 20:00; the only bad case is a
  device more than about 16 hours from the challenge zone, where "tonight"
  could already be past the day's noon close. The Expo reference does not
  say what happens to an existing daily trigger when the zone changes; I
  could not verify that without a device.
- It works in Expo Go: the SDK 54 reference states "Local notifications
  (in-app notifications) remain available in Expo Go" — push is what needs a
  development build. So it can be tried on the provisioned device without
  an App Store build.

Rough size: one small service file beside timerEffects, the Settings row
re-enabled with true copy, cancel on sign-out, schedule on foreground. Four
files, one short phase. It needs no server. It reaches nobody in the squad
today, because the squad is on the web build.

## f. Recommendation

**Ship A4 on the web first, as Web Push, gated on Home Screen install for
iOS.**

Why: the people section 0 of the brief is about are on the web build, the
native build has no ship date and sits behind App Store review, and web push
already reaches Android Chrome from a tab and iOS 16.4+ from an installed
app — which the manifest already permits. The cost is real but bounded and
all of it is ours to control: a service worker, a subscribe control that a
tap drives, a `push_subscriptions` table under owner-only RLS, VAPID keys,
and a sender (a Supabase Edge Function on a schedule, or pg_cron with
pg_net) that sends one evening reminder in the challenge's timezone, only
when the day has open tasks, and never to a dormant owner. Web Push is a
protocol to Apple's and Google's own push services; there is no paid third
party in it.

The first deliverable inside that is not the push itself but the install
prompt, because on iOS nothing else can happen before it. That should be
built and measured (`navigator.standalone` at sign-in tells us who
installed) before the sender is written.

What would change my mind:

1. If the squad turns out to be mostly iOS and does not install to the Home
   Screen when asked. Then web push reaches nobody who matters and the
   native local reminder in section e is the better first move, cheap and
   serverless.
2. If the native build reaches TestFlight inside the A4 window. Then the
   local reminder ships in a day and the web work can follow.
3. If the sender cannot run inside the project's existing free surface.
   I do not believe that is the case, but it is the only cost that is not
   ours.

## Not verified without a device

- That Add to Home Screen on iOS produces a standalone app with the icon
  and title above.
- That Chrome on Android offers the install prompt for this site.
- The behaviour of an iOS or Android daily local trigger across a timezone
  change.
- That the WebKit conditions are unchanged in the iOS version the squad is
  on; the post is from 2023 and I did not find a newer statement.
