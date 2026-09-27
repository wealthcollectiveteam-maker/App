# Apple Health on your iPhone — the first run, step by step

Written 2026-09-27 (Phase 38M). Apple Health has been built for a while and
had never run on a phone. Phase 38M read the code against the installed
HealthKit library and fixed what did not match (see "What changed" at the
end), and added a diagnostics card so what your phone does can be read
rather than guessed. This file is the order to do things in. **The order
matters**: once you grant Health access, the "never asked" state is gone for
this app on this phone, and it is the state the first friend to install the
app will be in — so it gets photographed first.

You need the development build on the phone and the dev server running on
the laptop (`docs/first-dev-build.md`, steps 6 and 7). No new build is
needed for any of this: everything in 38M is JavaScript, and the phone loads
JavaScript from the laptop.

## Before you start: get the new JavaScript onto the phone

1. On the laptop, in `C:\dev\App`, pull the latest and start the server:

   ```powershell
   git pull
   npx expo start --dev-client
   ```

2. Phone and laptop on the **same Wi-Fi**. If the phone cannot see the
   server, stop it (Ctrl+C) and start it with `--tunnel`, then scan the QR.

3. **Reload the app** so it picks up the new code. Either of:
   - shake the phone (or long-press with three fingers) → the developer menu
     opens → tap **Reload**; or
   - close the app fully (swipe it away in the app switcher) and open it
     again while the server is running; or
   - press `r` in the laptop terminal running the server.

   You will do this again whenever new code is pushed. The app does not
   need reinstalling.

Send screenshots as you go. Each step says what to capture.

## 1. BEFORE connecting anything — photograph the never-asked state

Do this first. It cannot be redone without deleting the app.

1. Open **Track**. At the top, under the title and above the JOURNAL /
   MEALS / MILESTONES control, there should now be a compact card:
   **Apple Health — Not connected** with a **Connect** button. Do **not**
   tap it yet. **Screenshot.**

   If there is no card at all, that is the thing to report — the
   diagnostics card in the next step says why.

2. Tap **You → Settings**, scroll to the bottom to **Developer**. Under the
   Intl card there is a second card, **HEALTH DIAGNOSTICS (dev only)**.
   Wait for its first line to settle, then **screenshot the whole card**
   (scroll if it does not fit; two screenshots are fine).

   What it should say, before anything is connected:
   - first line: **GOOD — HealthKit is here and this phone has NOT been
     asked yet.**
   - `isRunningInExpoGo()` false, `gate open` true, `native module` loaded,
     `isHealthDataAvailable()` true
   - Authorization: `raw value` **1**, `typeof` **number**, `mapped to`
     **not-requested**
   - Reads: every row **skipped** or **ran · 0 samples** (nothing has been
     granted, so nothing can come back)
   - Health switch **OFF**, read from **built-in default — never stored on
     this phone**

   Anything else on that card is the report. The raw value and typeof lines
   are the ones the code has been waiting a month to see.

3. Also check **Settings → Apple Health** (the section above Developer).
   There should be a **Connect Apple Health** switch, off.

## 2. Put real data in Apple Health

The prompts fire on real data, so there has to be some. Three things, all
in the **Health** app (the white icon with a red heart). Where to tap, for
a manual entry — if you have a watch or the Fitness app recorded these
already, skip the matching one:

**A workout of at least 45 minutes.** Health → **Browse** tab (bottom
right; on newer iOS it may be under **Search**) → **Activity** →
**Workouts** → **Add Data** (top right) → set **Activity Type** to
something like *Traditional Strength Training* → set **Start** and **End**
today, at least 45 minutes apart (the workout task's target) → **Add**.
Make it earlier today, not in the future.

**A weight entry.** Health → **Browse** → **Body Measurements** →
**Weight** → **Add Data** → type today's weight → **Add**.

**Some food energy**, if you log food anywhere. Health → **Browse** →
**Nutrition** → **Dietary Energy** → **Add Data** → any number of calories
(for example 600) → **Add**. If you use a food app that writes to Health,
logging a meal there does the same thing. If you do not log food at all,
skip this; the diet prompt simply will not appear, which is correct.

## 3. Connect

1. Back in Ranked Fitness, on **Track**, tap **Connect** on the Apple
   Health card (or turn on **Settings → Apple Health → Connect Apple
   Health**; they do the same thing).

2. iOS shows its Health access sheet. It lists the five things the app asked
   to read — **Active Energy, Dietary Energy, Steps, Weight** and
   **Workouts** — each with a switch, and a **Turn On All** at the top.
   Tap **Turn On All**, then **Allow** (top right; on some versions it reads
   **Done**). **Screenshot the sheet** before you allow, if you can.

   iOS shows this sheet **once**. If you tap Don't Allow, or leave some
   off, the app is never told — it just gets no samples for those types
   (Apple's rule, deliberately). Changing it later is step 7.

3. If no sheet appears at all, screenshot the diagnostics card again and
   send it — that is the case the old code had, and the card's
   Authorization rows will show which way it went.

## 4. What you should now see — a screenshot of each

**Track** (pull down to refresh if it has not updated): the card is now
**Today's health** with steps, active kcal, and your weight with its date,
then the workout you added with its type, minutes and start time. A dash
(—) in any slot means Health returned nothing for it; the footnote under
the card says so and offers **Check access in Settings**. Zero steps read
from real samples shows as **0**, not a dash. **Screenshot.**

**Home**: under the workout task row, an inline line — *Apple Health saw a
47-min Traditional Strength Training at 3:10 PM* — with **Mark complete**.
It only appears for a workout task that is not done yet and only for a
workout at least as long as the task's target. If you added food energy,
below the task list: *You logged food in another app today — mark diet
complete?* with **Mark complete** and **Not now**. **Screenshot.**

**Check-in**: the same workout line inside the workout task's card, when
that card is on top. **Screenshot.**

**The weekly check-in** (Track, at the bottom, when it is due; or turn it on
in Settings): the weight field is pre-filled from Health, with a small note
saying it came from Apple Health and the date. Once you type in the field
the pre-fill stops. **Screenshot.**

**Settings → Apple Health**: the switch is ON, and three sub-rows appeared
(diet prompt, workout prompt, weight pre-fill), with the sentence that iOS
does not tell the app what it granted and a button to iOS Settings.

**Settings → Developer → HEALTH DIAGNOSTICS**: tap **Re-run**. Now:
Authorization `raw value` **2**, `mapped to` **requested**; the five read
rows say **ran · N samples** — counts only, never values — with 0 for
anything you did not add. **Screenshot.**

If any of these does not match, screenshot what you got and the
diagnostics card together.

## 5. Mark a workout complete from the suggestion

On **Home**, tap **Mark complete** on the Apple Health line under the
workout task. Check all three, because they go through the same path as a
swipe and must be indistinguishable from one:

- the task ticks and the **+20 XP** toast appears, same as a swipe;
- the **Squad** tab shows your completion in the feed exactly as a swipe
  would, with no Health detail attached (squadmates see that a task was
  done, never what Health said);
- the streak and day count on Home are what they would be after a swipe.

The suggestion disappears, and does not come back for that workout: one
recorded workout vouches for one task, ever. If you have two workout tasks
and only one workout, the second task gets no suggestion.

## 6. Dismiss a prompt

If the diet prompt is showing on Home, tap **Not now**. It goes away and
must stay away for the rest of today — leave Home and come back, force-quit
and reopen. Tomorrow it may return if Health has food energy for tomorrow.
(The dismissal is kept only in memory and per day. It is not synced; a
different phone would show the prompt.)

## 7. Revoke access in iOS, and reopen

1. iOS **Settings → Privacy & Security → Health → Ranked Fitness** (on
   newer iOS: **Settings → Apps → Health → Data Access & Devices → Ranked
   Fitness**). Turn every category **off**.

2. Reopen Ranked Fitness. Open Track, Home, Check-in and the weekly
   check-in. Expected:
   - **no error, no crash, no red screen**;
   - the Track card says **Apple Health returned nothing for today. That is
     either no data recorded yet, or access not granted — iOS does not
     tell apps which**, with **Check access in Settings**. Not zeroes, not
     "no workouts recorded". This is the honest state: the app is not told
     it was revoked;
   - no suggestion under any task, no diet prompt, no weight pre-fill;
   - Settings → Apple Health switch still **ON** — it means "this app has
     asked", which is still true; the row under it says where to look;
   - Diagnostics: Authorization still `raw value` **2 / requested** (iOS
     never un-asks), every read row **ran · 0 samples**. **Screenshot.**

   There must be no nag to reconnect. If anything asks you to connect
   again, or shows a number it could not have read, screenshot it.

## 8. Turn it back on

In iOS Settings, turn the categories back on (or **Turn On All**). Reopen
the app, pull Track down to refresh: the readings return. Re-run the
diagnostics; the read counts are back.

Then, separately: turn the app's own switch **off** in **Settings → Apple
Health**. Track must show **nothing** for Health — no card, no Connect
prompt (a deliberate off is respected; Phase 38M). Turn it back on: the
readings return without a new iOS sheet, because iOS was already asked.

## What changed in Phase 38M, in one paragraph each

**Why there was no card on your phone.** The gate that decides whether
HealthKit can exist read `Constants.expoGoConfig` as "this is Expo Go". A
development build served by the laptop's dev server carries that same
config block in its manifest, so the gate closed on a real iPhone and the
app treated Health as unavailable — no card, no prompt, no Settings
section. The gate now asks the `expo` package whether Expo Go's own native
module is present, which is the only signal that is actually about Expo Go.

**Why connecting would not have worked even so.** The installed HealthKit
library (v14) takes `{ toRead }` for authorization; the code passed
`{ read }`, which the library reads as an empty list — no sheet, and an
"already asked" answer to a question about nothing. Every data query also
left out the required `limit` and put the date range in the wrong place, so
each read failed quietly and showed as "nothing returned". All five calls
now build their arguments in one place, `src/lib/healthKitArgs.ts`, and a
test reads the library's own source to check the shapes.

**Never connected vs turned off.** The Track prompt now distinguishes a
phone iOS has never asked (Connect prompt) from a switch someone turned off
after connecting (nothing at all).

**The diagnostics card** exists only in development builds: its code is
behind a compile-time `__DEV__` check, so a production bundle does not
contain it, and the deploy gate refuses any bundle in which its title
appears. It shows counts, types and statuses — never a Health value.
