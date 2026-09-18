# Draft correction for `public/privacy.html` — NOT DEPLOYED

You publish that file yourself. Nothing here has been written into
`public/privacy.html` or into the Pages checkout. This is the wording to read
first.

`public/privacy.html` and the live `https://alymalji.github.io/privacy.html`
are byte-identical right now, so what is below is the change to both.

---

## 1. The Health paragraph

### What it says today (line 64, inside "Two things never leave your phone")

> **Apple Health data.** If you grant Health access, the app reads it into
> memory to show you your numbers. It is never transmitted, never written to
> our database, and never logged.

### What the app actually reads

Five types, from `READ_TYPES` in `src/services/HealthService.ts` — the same
five passed to `requestAuthorization`, so the same five the iOS sheet lists:

| HealthKit identifier | Plain name | Where it surfaces |
|---|---|---|
| `HKQuantityTypeIdentifierStepCount` | Steps, today | Today's Health card |
| `HKQuantityTypeIdentifierActiveEnergyBurned` | Active energy, today | Today's Health card |
| `HKWorkoutTypeIdentifier` | Workouts, today | Today's Health card; workout-task suggestion |
| `HKQuantityTypeIdentifierDietaryEnergyConsumed` | Logged food energy, today | Diet-task suggestion |
| `HKQuantityTypeIdentifierBodyMass` | Most recent weight | Today's Health card; weekly check-in pre-fill |

Write access is never requested: the share list is empty and
`NSHealthUpdateUsageDescription` is `false`, so the entitlement does not exist.

### Do they match?

**Not a mismatch, but not a match either.** The published policy makes no
false claim — everything in that sentence is true, and it does not undercount
the way `PRIVACY_NOTES.md` did, because it never counts at all. It says "your
numbers" and enumerates nothing.

That is fine for accuracy and thin for an App Privacy questionnaire and a
HealthKit review, both of which turn on *which* categories are read. A
reviewer comparing the permission sheet against the policy finds five types on
one side and an unenumerated "your numbers" on the other.

### Proposed replacement for line 64

> **Apple Health data.** Health access is off until you turn it on. If you do,
> the app reads five things — today's steps, today's active energy, today's
> workouts, the food energy you have logged today, and your most recent
> recorded weight — into memory, to show them to you and to offer to mark a
> daily task complete or pre-fill your weekly check-in. It never writes
> anything back to Health. None of it is transmitted, written to our database,
> or logged, and no squadmate can see any of it. iOS does not tell apps which
> Health categories were allowed, so where a value is missing the app says so
> rather than showing a zero.

The last sentence is optional but I would keep it: it is the one behaviour a
user might otherwise read as a bug, and saying it in the policy costs nothing.

---

## 2. Progress photos — the policy is correct

> **Progress photos.** The app has no camera access and no photo storage. When
> a challenge asks for a progress photo, you take it with your own camera app
> and keep it yourself. Ranked Fitness never sees it.

Verified, and it holds:

- no `expo-camera`, `expo-image-picker` or `expo-media-library` in
  `package.json`
- no `ImagePicker`, `MediaLibrary` or `launchCamera` anywhere in `src/`
- no `NSCameraUsageDescription` or `NSPhotoLibraryUsageDescription` in
  `app.json`, so the binary cannot request either

No change needed.

---

## 3. Journal entries — the policy is correct

> **Anything you log** — journal entries, meals and their macros, body metrics
> such as weight, and workout notes.

> **Your squadmates cannot see:** your journal entries, your meals or macros,
> your body metrics, or your workout logs. Not a summary of them, not a count,
> nothing.

> This is not enforced by hiding a screen. It is enforced in the database
> itself with row-level security…

All three hold, and the third is the one with a proof rather than a code read:

- `journal_entries` is owner-only under RLS. `rls_test.sql` asserts it through
  the API as a squadmate, not through the UI — *"squadmate sees name only — no
  journals, meals, metrics, why, milestones, workout logs, snapshots,
  completions"* — and that suite passed on the local stub on 2026-09-04.
- The deletion claim ("Settings → Delete account… removes… your journal
  entries") is covered by *"delete_account leaves no application row
  referencing the user"* in the same suite.

Caveat, stated correctly: the stub reproduces Supabase's *shape*, so that
suite passing is not by itself a statement about production. Production's
grant surface is separately proven — `supabase/repair/phase16b_audit_production.sql`
interrogated it directly on 2026-09-04: 321 checks, 0 findings, including
`anon` holding nothing on any of the 22 tables. What remains unproven is that
the local suite would CATCH a regression in it, which is a different claim and
a smaller one. Re-run that audit after 0013 as confirmation (step 5 of the
pre-flight in `device-gate.md`).

No change needed.

---

## 4. Related, and already changed in the repo

`app.json`'s `NSHealthShareUsageDescription` — **the string iOS shows on the
permission sheet** — carried the same three-of-five undercount that
`PRIVACY_NOTES.md` did. It named "logged food energy, most recent weight, and
today's workouts" while the sheet requests five types, and it gave no purpose
at all for steps and active energy.

That one I have corrected in `app.json`, because it is repo source rather than
something you publish. It only reaches a device through a rebuild, so nothing
has changed for anyone yet — and if you would rather word it differently,
change it before you build.
