# Privacy notes

Working documentation for Apple's App Privacy questionnaire and future
backend work. Keep this current when data handling changes.

## Apple Health (HealthKit) — read-only

The app requests **read-only** access to exactly three things:

| Data type | Why it is read | What happens to it |
|---|---|---|
| Dietary energy consumed (today) | To offer a one-tap "mark diet complete?" prompt when food was logged in another app | Rendered in the prompt on-device; discarded on refresh |
| Body mass (most recent sample) | To pre-fill the optional weekly weight check-in so it's a confirm, not a retype | Pre-fills an editable field on-device; only the value the user explicitly saves is stored |
| Workouts (today) | To offer a "mark workout complete?" prompt when a workout at least as long as the tier's duration exists | Rendered in the prompt on-device; discarded on refresh |

Hard rules, enforced in `src/services/HealthService.ts`:

- **No write permission is ever requested.** The config plugin sets
  `NSHealthUpdateUsageDescription: false`, so the write entitlement does not exist.
- **HealthKit values never leave the device.** They are not written to any
  backend, not included in sync payloads, and not logged. They exist only in
  in-memory state (`healthReadings`) used to render prompts and pre-fill fields.
- Health data is never used for advertising and never shared with third
  parties (Apple HealthKit rules; also just the right thing).
- The connection is opt-out-able in Settings. When permission is denied,
  revoked, or HealthKit is unavailable (web, Android, Expo Go), every read
  resolves to null and the app behaves identically with no prompts or nags.
- **Never auto-complete:** health data only ever produces a prompt; the user
  confirms. Completion goes through the same path as a manual tap.

## Body metrics (weekly check-in)

- Weight and mood check-ins are optional, dismissible, and permanently
  disableable in Settings. No push notifications are attached to them.
- Metrics are private to the owner. Squadmates see task-completion status
  only — never weight, mood, calories, or workout detail.
- Included in account deletion.
- When the backend lands, `metric_checkins` requires RLS restricting reads
  to the owner only.

## Nutrition data

- Nutrition attachment on meals is optional enrichment; plain-text logging
  is the primary path. No calorie goals, targets, or over/under judgments
  are shown anywhere.
- Food lookups go to USDA FoodData Central with only the search term; no
  user identity is attached beyond the API key. Lookups are cached on-device
  by food ID.
- Meal nutrition rows are owner-read-only when synced (same RLS posture as
  `metric_checkins`). Squadmates never see them.
- Included in account deletion (including the local lookup cache).
