# Ranked Fitness

A social accountability app for **75 Hard**-style challenges (Hard / Medium / Soft tiers). Complete 6 daily tasks, keep the streak flame alive, earn XP / levels / badges, run the challenge solo or with a squad (pings + leaderboard), journal daily, log meals, track custom milestones — and get a ceremonial full-screen finish on Day 75.

Built with **Expo + TypeScript + Expo Router**, styled with the "Nocturne" design system (dark, compact, blue accent used only as lines / outlines / glows).

## Stack

- [Expo](https://expo.dev) SDK 57 + Expo Router (file-based routing, typed routes)
- TypeScript (strict)
- [Zustand](https://github.com/pmndrs/zustand) for state, backed by a `services/DataService.ts` contract with a mock-data implementation
- [Phosphor](https://phosphoricons.com) icons (regular + fill), Inter via `@expo-google-fonts/inter`
- `react-native-svg` for the progress ring, flair rings and gradient dividers

## Getting started

```bash
npm install
npm run web      # run in the browser
npm start        # Expo dev server (scan QR with Expo Go for iOS/Android)
```

## App structure

| Route | Screen |
| --- | --- |
| `src/app/(tabs)/index.tsx` | Home — status banner, 75-day progress ring, 6-task checklist, squad snapshot |
| `src/app/(tabs)/checkin.tsx` | Check-in — swipeable card deck (right = done +20 XP, left = later) |
| `src/app/(tabs)/track.tsx` | Track — Journal / Meals / Milestones |
| `src/app/(tabs)/squad.tsx` | Squad — members + pings + activity feed, weekly/all-time leaderboard |
| `src/app/(tabs)/you.tsx` | You — level + flair ring, stats, badges, why-I-started |
| `src/app/celebration.tsx` | Full-screen daily "LOCKED IN." celebration |
| `src/app/finish.tsx` | Two-step Day 75 finish flow (feeling → results) |

## Dev scenario switcher

Long-press the **RANKED** wordmark in the header (600ms) to open the hidden dev sheet and switch mock scenarios: **Day 1**, **Day 12**, **Missed day**, **Day 75** — for QA of empty/edge states.

## XP rules

+20 per task · +10 journal entry · +50 milestone · +120 day complete. Levels are 800 XP each; the level drives the avatar flair ring (90° of accent per level).
