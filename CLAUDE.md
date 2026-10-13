# Ranked Fitness

iOS social-accountability app for 75 Hard-style challenges. A squad of friends runs the same challenge; everyone sees completion status, nobody sees anyone else's private data.

## Hard constraints — never violate

- **Expo SDK 54.** Do not bump. Pinned for App Store Expo Go compatibility.
- **Bundle ID `com.aly786.rankedfitness`.** Apple certificates, push key, and the provisioned device are bound to it. Changing it destroys a working signing setup.
- `.env` stays gitignored. Only the anon/publishable Supabase key ever reaches the app — **never** `service_role`.
- No paid third-party APIs. No MyFitnessPal scraping or unofficial clients.
- Public contact address is `rankedappfitness@gmail.com`. No personal email or real name anywhere in the repo.

## Privacy — non-negotiable

- **HealthKit values never leave the device.** Not to Supabase, not to AsyncStorage, not to `console.log`, not into the squad feed. Only a user-confirmed "task completed" boolean syncs.
- Squadmates can never read another member's metrics, nutrition, journal entries, or workout logs. Enforced by RLS and verified **through the API**, not the UI.

## Architecture

- `services/DataService.ts` is the single interface contract. Everything goes through it. Mock and Supabase implementations both fulfil it; `EXPO_PUBLIC_USE_MOCK=1` selects the mock.
- **Day-start snapshots**: each day freezes its task set. All counts, completions, and streaks read that snapshot, never the live task list. This is what makes "edits start tomorrow" true and what the cheat test verifies.
- Server owns the clock. Streaks, XP, day count, and ping quotas are computed by `SECURITY DEFINER` RPCs, never trusted from the client.
- Client state: Zustand + AsyncStorage. Gestures: react-native-gesture-handler + Reanimated, on the UI thread.

## Database

Supabase project ref `dmlgdqufkrtrjgbofpkd`. Migrations in `supabase/migrations/`.

**Grants use an allow-list**: revoke all, then grant back only what's sanctioned — the `0002` pattern. Never a blanket grant. The local Postgres stub does **not** reproduce Supabase's default role grants, so a passing local proof means nothing; verify against the real project.

## Design

Ground is near-black. Accent blue is a FILL, not only an outline — primary actions
are solid blue. Skewed parallelogram shapes are the signature form: badges, timer
controls, ping buttons, save controls. Two type families only: a grotesque (Inter)
for everything structural, and a serif italic reserved for quotes and descriptors.
Uppercase micro-labels carry wide letter-spacing. Headings are heavy and tight.
All colour comes from `src/theme/tokens.ts`. No hardcoded hex anywhere else.

## How to work here

- **Audit before building.** Partial work from earlier agent runs exists. Finish what's there; don't rebuild it.
- Work in small steps. Typecheck and commit between them.
- If a spec conflicts with what's actually in the repo, say so and propose the better fit rather than forcing it.
- **Flag anything you could not verify without a physical device.** Passing tests have twice coexisted with real defects here — a feature no user could find, and `anon` holding write privileges on all 19 tables.

## Commands

```
npm install
npx expo start                  # dev server; --tunnel if the phone can't connect
npx tsc --noEmit
npx expo lint
npm run test:rls                # must run against the real project, and assert grants
npx eas-cli@latest build --profile preview --platform ios
```
