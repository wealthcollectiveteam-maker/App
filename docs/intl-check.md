# The Intl check — inside the development build, on your phone

## Read this first: not Expo Go

**Do not use Expo Go for this, and do not upgrade the project to make Expo Go
work.** The Expo Go app in the App Store only runs the newest Expo SDK. This
project is pinned to SDK 54 on purpose (it is a hard constraint in
`CLAUDE.md`), so Expo Go refuses it. On 2026-09-25 the attempt to make it
work ran `npm install expo@^57` and `expo install --fix`, which upgraded
every package; it was reverted with `git restore` and `npm ci`, and nothing
from it is in the repo. That is the whole reason this file no longer mentions
Expo Go: the check runs in the development build instead, which is the real
app on the real phone — a better test anyway.

If someone tells you to "just open it in Expo Go", the answer is no.

## What this checks

Every date and time the app shows, and the timer that refreshes the screen
at midnight and noon, depend on a part of the phone's JavaScript engine
called `Intl`. The app now has a fallback for every piece of it it uses
(`src/lib/intl.ts`, Phase 38I), so nothing breaks either way — but the
fallback is worse (it follows the phone's clock rather than the challenge's
timezone), so we want to know which one the phone is running.

## Steps

You need the development build installed on your iPhone
(`docs/first-dev-build.md`, steps 1 to 7) and the dev server running on the
laptop.

1. Open **Ranked Fitness** (the development build) on the phone and connect
   it to the laptop's dev server, as in `first-dev-build.md` step 7. Sign in
   with your usual email and code. You land on Home.

2. Tap the **You** tab, then **Settings**. Scroll to the very bottom.

3. In a development build there is a section called **Developer** with a
   card titled **INTL DIAGNOSTICS (dev only)**. It is not in the App Store
   build; if you do not see it, you are in a production build, not the
   development one.

4. Read the first line of the card. It says one of three things:

   - **GOOD — every capability the app uses is present.**
     Every row below says `present`, and the last line, "Now in America/…",
     shows the right weekday, date and time for your challenge's timezone.
     This is the answer we want.

   - **BAD — named timezones are not honoured.**
     The rows say `present` except "named timezone honoured", which says
     `MISSING`, and the "Now in" line shows the wrong hour (UTC, usually five
     hours ahead of Toronto). The app still works, but the midnight and noon
     refresh follows the phone's clock rather than the challenge's. Tell me
     this result; there is a build setting that includes the timezone data,
     and it goes in before the next build.

   - **BAD — Intl is missing.**
     Every row says `MISSING`. Dates and times use the plain fallback
     format. Same fix, same place. Tell me this result.

5. The laptop's terminal (the dev server) also printed one line when the app
   started, beginning `[intl]`. It says the same thing as the card; copy it
   into your message as well.

6. Also look at the **check-in** tab: under the day number there is a date
   like "Friday 26 September". If it shows the right weekday and date, that
   is a second confirmation of GOOD.

7. Take a screenshot of the card and send it with the `[intl]` line.

## Why the card exists only in the development build

The card is loaded through a `__DEV__` check, which the bundler resolves at
build time. A development build has `__DEV__` true and the card is in it; a
production build has it false and the card's code is not in the binary at
all. Both halves are proved, not assumed: the deploy gate refuses a
production bundle containing the card's title, and a development-mode export
contains it.
