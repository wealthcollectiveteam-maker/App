# The Intl check — five minutes, on your phone, before any build

Every date and time this app shows, and the timer that refreshes the screen
at midnight and noon, depends on a part of the phone's JavaScript engine
called `Intl`. The native app runs on an engine (Hermes) that may or may not
have all of it. This check tells us, on your actual phone, without building
anything or spending anything.

You need: your iPhone, this laptop, both on the same Wi-Fi, and about five
minutes.

## Steps

1. On the iPhone, install **Expo Go** from the App Store if it is not already
   there. It is free.

2. On the laptop, open a terminal in `C:\dev\App` and run:

       npx expo start

   Wait until a QR code appears in the terminal. If the phone cannot connect
   in step 3, stop it with Ctrl+C and run this instead:

       npx expo start --tunnel

3. On the iPhone, open the **Camera** app and point it at the QR code. Tap the
   banner that appears. Expo Go opens and the app loads. The first load takes
   a minute.

4. Sign in with your usual email and code, exactly as on the website. You
   land on Home.

5. Tap the **You** tab, then the gear or **Settings**. Scroll to the very
   bottom. In Expo Go and development builds only, there is a section called
   **Developer** with a card titled **INTL DIAGNOSTICS (dev only)**. That card
   does not exist in the App Store build.

6. Read the first line of the card. It says one of three things:

   - **GOOD — every capability the app uses is present.**
     Everything below it says `present`, and the last line, "Now in
     America/…", shows the right weekday, date and time for your challenge's
     timezone. This is the answer we want. Nothing else to do.

   - **BAD — named timezones are not honoured.**
     The rows say `present` except "named timezone honoured", which says
     `MISSING`, and the "Now in" line shows the wrong hour (UTC, usually five
     hours ahead of Toronto). The app still works, but the midnight and noon
     refresh would follow the phone's clock rather than the challenge's. Tell
     me this result; there is a known fix (a build setting that includes the
     timezone data) and it goes in before the first build.

   - **BAD — Intl is missing.**
     Every row says `MISSING`. Dates and times will show in a plain fallback
     format. Also a known fix, same place. Tell me this result.

7. Also look at the **check-in** tab: under the day number there is a date
   like "Wednesday 24 September". If it shows the right weekday and date,
   that is a second confirmation of GOOD.

8. Take a screenshot of the diagnostics card and send it to me. Then stop the
   terminal with Ctrl+C.

## What this does not check

Expo Go does not include Apple Health, so the health card shows its
"unavailable" state there. That is expected and not a problem. It also does
not test notifications' behaviour with the app closed, which needs a real
build.

## If the app will not load in Expo Go at all

Send me the error text on the phone screen. The most common causes are the
phone and laptop being on different networks (use `--tunnel`), or the laptop
firewall blocking the connection.
