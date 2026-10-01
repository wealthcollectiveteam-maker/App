# Your first iPhone development build — every step, in order

Written 2026-09-26 (Phase 38K). This gets the real app onto your own iPhone
so the Intl check (`docs/intl-check.md`) and the reminder can run on a
phone. It is not the App Store, not TestFlight, not a review. Everything
here you do yourself; none of it was run for you.

**What you do NOT need yet** — so you do not go looking: an App Store
Connect app record, screenshots, the privacy questionnaire, TestFlight, App
Review, a Mac. A development build is compiled in the cloud and installed
straight onto a phone you have registered.

Commands are PowerShell, run in `C:\dev\App`. After each step there is a
check; do not move on until it passes.

## 1. Accounts

**Expo account** — free. Sign up at https://expo.dev/signup with the
`rankedappfitness@gmail.com` address. Check: you can sign in at
https://expo.dev and see an empty dashboard.

**Apple Developer Program** — this is the paid one, US$99 a year. The
`CLAUDE.md` says the certificates and the provisioned device for bundle id
`com.aly786.rankedfitness` already exist, which means this account has been
active before. To tell whether it still is: sign in at
https://developer.apple.com/account and open **Membership details**. It
shows a renewal date. If it says the membership has expired, renew it there
before anything else; nothing below works without it.

Check: Membership details shows a renewal date in the future.

## 2. Install the EAS command line and sign in

```powershell
npm install -g eas-cli
eas --version
eas login
```

`eas login` asks for your Expo email or username, then your password (or
offers to open the browser). Nothing else.

Check: `eas whoami` prints your Expo username.

If `eas` is not recognised after installing, close PowerShell and open it
again.

## 3. Register your iPhone

```powershell
eas device:create
```

It asks you to sign in to your Apple account: Apple ID, password, then the
six-digit two-factor code your other Apple devices show. Then it asks how
to register the device; choose **Website**. It prints a link and a QR code.

On the iPhone: open the link (or scan the QR with the Camera app). Safari
says the website is trying to download a configuration profile; tap
**Allow**. Then go to **Settings**; near the top it says **Profile
Downloaded**. Tap it, tap **Install**, enter your passcode, tap **Install**
again. That registers the phone's identifier with your Apple account.

Check: back on the laptop, `eas device:list` shows your phone.

If the phone was registered before (the CLAUDE.md suggests it was), the
website says so and there is nothing to install.

## 4. Turn on Developer Mode on the phone

Without this the build installs but will not open. On the iPhone:
**Settings → Privacy & Security → Developer Mode** → turn it on → the phone
asks to restart → after the restart it asks once more; tap **Turn On** and
enter your passcode.

Check: Settings → Privacy & Security → Developer Mode shows on.

If Developer Mode is not listed, it appears after step 3's profile is
installed, or after the app from step 6 is installed. Come back to it then.

## 5. Start the build

```powershell
eas build --profile development --platform ios
```

What it asks, in order, and what to answer:

- **Log in to your Apple account?** Yes. Apple ID, password, two-factor
  code. This is only to manage certificates; nothing is submitted anywhere.
- **Generate a new Apple Distribution Certificate?** and **Generate a new
  Provisioning Profile?** — Yes, let EAS manage them. EAS keeps them in your
  Expo account, reuses them on every later build, and renews them when they
  expire. Managing them by hand means a Mac, Keychain Access and a folder
  of files that break a build a year from now when nobody remembers where
  they are. The bundle id does not change; EAS attaches its certificate to
  the existing App ID.
- It may say it is **enabling capabilities** on the App ID — HealthKit and
  Push Notifications. That is expected and automatic (see the note at the
  end).

Then it uploads the project and queues the build. On the free tier the
queue wait varies from a few minutes to an hour at busy times; the build
itself takes about 15 to 25 minutes. You can close the terminal — the link
in it, and https://expo.dev under your project's **Builds**, show progress.

Check: the build page shows **Finished** with an **Install** button and a
QR code.

If it fails: open the build page, then the **Logs**. Send me the last
thirty lines of the phase that failed, with the phase name. Do not retry
until you have them; a retry after a real failure fails the same way.

## 6. Install it on the phone

On the iPhone, open the build page in Safari (scan the QR, or sign in to
expo.dev on the phone and open the build) and tap **Install**. iOS asks to
install "Ranked Fitness"; tap **Install**. The icon appears on the Home
Screen.

Check: the icon is there and the app opens. If it opens to a screen asking
you to connect to a development server, that is right — go to step 7. If
iOS says the app cannot be opened because Developer Mode is off, do step 4.

## 7. Start the dev server and connect

On the laptop, in `C:\dev\App`:

```powershell
npx expo start --dev-client
```

Phone and laptop on the same Wi-Fi. The app on the phone shows the running
server in its list; tap it. If it does not appear, stop the server with
Ctrl+C and run:

```powershell
npx expo start --dev-client --tunnel
```

then scan the QR code the terminal prints with the phone's Camera.

The app loads from the laptop and shows the sign-in screen. Sign in with
your usual email and code.

Check: Home shows your day number and streak, the same as the website.

## 8. Run the Intl check

Follow `docs/intl-check.md` from its step 2. Send the screenshot of the
INTL DIAGNOSTICS card and the `[intl]` line from the laptop's terminal.

## 9. Turn the reminder on

In the app: **You → Settings → Notifications → Daily reminder**, switch it
on. iOS asks whether Ranked Fitness may send notifications; tap **Allow**.
The row's text then reads "One notification at 8:00 PM while the day is
still open." If you tap Don't Allow, the switch stays off and the row tells
you notifications are off in iOS Settings with a button to open them — that
is the app being honest, not broken.

What to check tomorrow: at 8:00 PM a notification reading "Day N is open
until noon tomorrow." with your day number. If you seal today's day in the
app before eight, no reminder comes tonight and tomorrow's is scheduled
instead. If you do not open the app for several days, a reminder still comes
each evening at eight — seven are kept scheduled — the later ones reading
"Today's tasks stay open until noon tomorrow." Tell me which ones arrived and
when.

## A note on the capabilities EAS enables

The build asks Apple for two capabilities on the App ID: **HealthKit**,
because the app reads Health data on the device, and **Push
Notifications**, because the notifications library's config plugin always
adds the push entitlement even though this app's reminder is local and
sends nothing through Apple's servers. EAS Build turns both on in your Apple
account automatically when the build runs; you do not tick anything in the
developer portal. No push key is used by this build.
