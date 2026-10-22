# App Store Connect — App Privacy answers, and what Apple Health changes

Written 2026-09-27 (Phase 38N, N5b). A note for whoever fills in the App
Privacy questionnaire in App Store Connect. It is not the questionnaire; it
is the reasoning, with Apple's own words for the part that matters.

## The expectation: Apple Health changes nothing

The app reads eleven Apple Health types on the phone (listed in
`docs/privacy-html-draft.md`, section 1). None of them is transmitted,
stored on a server, written to the device's own storage, or logged. They
are held in memory while a screen is open and discarded with it.

Under Apple's definition, that is not "collection", so nothing about Health
needs to be declared in the App Privacy answers.

## Apple's words

From Apple's page "App privacy details on the App Store"
(https://developer.apple.com/app-store/app-privacy-details/), read on
2026-09-27:

Under **Data collection**:

> "Collect" refers to transmitting data off the device in a way that allows
> you and/or your third-party partners to access it for a period longer
> than what is necessary to service the transmitted request in real time.

Under **Additional guidance**, the case that is exactly ours:

> You use location, device identifiers, and other sensitive data, but only
> on device, and the data is never sent to a server.
>
> Data that is processed only on device is not "collected" and does not
> need to be disclosed in your answers.

And the data type Apple Health falls under, from **Types of data**:

> **Health** — Health and medical data, including but not limited to data
> from the Clinical Health Records API, HealthKit API, Movement Disorder
> API, or health-related human subject research or any other user provided
> health or medical data

So the Health & Fitness category exists on the form, and the answer for
this app is that it is **not collected**, because it never leaves the
device. Do not tick it.

## What the app DOES collect, for the rest of the form

Unchanged by this phase. The Health work added no server write. What
reaches Supabase is what reached it before: account email, the challenge
and its daily completions, the squad feed rows, journal entries, meals,
weekly weight and mood check-ins, and the preference columns in
`profile_private` — none of which is a Health value. The task-to-Health
links added in 38N are kept on the device only (AsyncStorage,
`ranked.healthLinks.v1`) and contain the rule ("at least 6 h"), never a
reading.

One thing to watch if that changes: `docs/privacy-html-draft.md`,
`PRIVACY_NOTES.md` and this note all say the same thing, and a future
phase that syncs the links to the server (see the 38N report) keeps it
true — a rule is configuration, not health data — but the person filling
in the form should re-read this note when it happens.

## How to verify the claim before submitting

Two greps and one proof, all in the repo:

- `grep -rn "console\." src` — every log line; none carries a reading.
- `grep -rn "AsyncStorage.setItem\|persist(" src` — every device write;
  the keys are preferences, links, check-ins, the timer, and never a
  reading.
- `npm run test:rls` against the real project — there are no HealthKit
  tables to protect, because no Health value has a place to land.
