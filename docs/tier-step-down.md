# The tier step-down — a proposal, no code (Phase 38F, F4)

Written 2026-09-24 against the repo at the 38F commits. Nothing here is
built. File and line references are to the repo as it stands.

## The fact this answers

Every challenge ever created is `base_tier = 'hard'`. Eleven people chose
the hardest option, none completed a full day, and the evaluator restarted
each of them into Hard again, without the app ever suggesting anything else.
The tier system has three rungs and has never worked as a ladder. Setup
deliberately has no default tier (`auth.tsx`, "Deliberately null, not
'hard'"), so this was eleven active choices.

## 3. What Medium actually differs by (answered first, because it decides the rest)

Read from `src/constants/tiers.ts` (TIERS) and the server's
`tier_standards` (0005_tier_task_defaults.sql:36-58) and `tier_rules`
(0007_missed_day_engine.sql:115-118). A person moving from Hard to Medium
is agreeing to:

| Task | Hard | Medium |
|---|---|---|
| Workout 1 | 45 min, indoors or out | 45 min, same |
| Workout 2 | 45 min, **outdoors, whatever the weather** | **30 min, "Move again — any form, a walk counts"** |
| Water | **1 gallon** (3.8 L) | **3 litres** |
| Read | 10 pages, non-fiction | 10 pages, any real book |
| Diet | No cheat meals, no alcohol | **One planned cheat meal a week** |
| Progress photo | Daily | **Gone** |
| A missed day | **Challenge restarts at day 1** | **Streak resets; the day count continues** |

Soft goes further: one workout, with a rest day a week; 3 L; 10 pages;
"eat well, alcohol only on social occasions"; a miss resets the streak.
`tier_rules` confirms the penalties: Hard `restarts_challenge true`, Medium
and Soft `false`; all three `resets_streak true`.

**Is the difference meaningful enough to rescue a failing day?** Yes, and
the production read says exactly why. Where the day dies, by tick count:
workout1 44, water 41, diet 40, read 40, **workout2 36, photo 34**. The two
tasks people most often fail to tick are the second workout and the photo.
Medium halves one of those and removes the other. It also turns "miss a task,
restart at day one" into "miss a task, the streak resets, the day count
continues" — which is the difference between the treadmill in 0016 and a
challenge a person can stay inside of. This is not a cosmetic step. If the
data had said the day died on workout1 or water, Medium would not help and
this section would say so.

The one thing Medium does not change is the number of tasks: still eleven
for someone who added five customs, and 32 of the 47 ticked days on
production were all-eleven days from one person. A step-down does nothing
for a person defeated by the count rather than by the two tasks above.

## 1. Where does the offer fire?

**Not at the dormancy point, and I argue against the instinct.**

The dormancy rule fires in `evaluate_challenge` at the end of the second
empty run (0016 §3). By then the person has not opened the app for three to
four days. An offer computed there has nobody to read it: the challenge
ends, and the next thing the person sees, if they come back at all, is the
setup screen, where they are choosing a tier anyway. Firing at the dormancy
point means "compute the offer, store it, and hope".

The moment that has a reader is **day 1 of the first restart**. That is the
morning after the first empty run, the person has just been told
"Challenge restarted" by the 38C banner, and the app knows three things it
did not know at setup: they chose Hard, they did not complete a day on it,
and they are still here — they opened the app to see the banner. The
condition is already computed on the server (`challenge_has_sealed_day` on
the parent, 0016 §2) and is trivially readable on the client: the store
holds `restarted` and `perfectDays === 0`, which is exactly what the restart
notice keys on in `streakStatus.ts`.

So: the offer is a second sentence and a control inside the 38C restart
notice, on Home, shown when `restarted && perfectDays === 0 && tier ===
'hard'`, and it uses the tier-change machinery that already exists
(`change_tier`, 0007:504-518; `requestTierChange` in the store), which
takes effect tomorrow like every edit.

The dormancy point gets one thing: when a dormant person returns, the setup
screen's returning-person line (F3) is followed by the same offer as a
preselection — Medium selected, changeable in a tap. That is the only place
a preselected tier is defensible: it is a recommendation to someone whose
own choice already failed twice, and it is still theirs to change.

## 2. Offer, or automatic?

**An offer.** One answer, and the project rule decides it: the app never
claims something the person did not choose. An automatic step-down would
put "MEDIUM" in the header badge and "changed tier to Medium — starts
tomorrow" in the squad feed (`requestTierChange` posts a feed item, store
line ~1541) on behalf of someone who chose Hard. The header would be
telling their squad something about them that they did not decide. It would
also break the setup screen's own promise that a tier is never defaulted.

The offer is one tap, and the tap is theirs. Copy, same rules as 38D:

> Hard did not produce a completed day. Medium drops the photo, makes the
> second workout a 30-minute walk, and a missed day resets the streak
> instead of the challenge. Switch from tomorrow.

with a control labelled "Switch to Medium" and nothing else. No preselected
"yes". If they do nothing, nothing changes.

## 4. What survives a tier change

Read from `change_tier` (0007:504-518): it inserts one `tier_history` row
with `from_day = today + 1` and touches nothing else on the challenge.

- **best_flame** survives: not read, not written.
- **The streak (flame)** survives: not touched. A step-down is not a miss.
- **The day count** survives: same challenge, same `start_date`.
- **Day snapshots** are untouched; tomorrow's snapshot is composed from
  tomorrow's effective tier (`effective_tier(c.id, day)` reads
  `tier_history`), which is how "edits start tomorrow" already works.
- **The squad sees it.** The header badge reads the effective tier
  (`selectTierLabel`), `get_squad_status` returns `tier_label`
  (0011:547-552), and the client posts a 'change' feed item when the person
  requests it. That is fine for an offer they accepted and the reason it
  must not be automatic.
- **Custom tasks and target overrides** carry across a tier change as they
  do today; a lowered target already relabels the challenge CUSTOM.

One thing to check before building: a Hard restart that then steps down to
Medium keeps `first_judged_day = 1` and `restarted_from` set, so its day 1
is still judged — under Medium rules, which reset the streak rather than
restart. That is correct and needs no change; it just needs saying in the
copy that the current day is still under Hard rules until tomorrow, which
"Switch from tomorrow" does.

## 5. What stops the spiral

Four rules, all cheap:

1. **One step, once, per challenge.** The offer proposes the next rung
   down, never two, and is not shown again on the same challenge once
   dismissed or taken. Remembered on the device like the restart-notice
   dismissal (`restartNoticeDismissedFor`), keyed on challenge id.
2. **Never below Soft, and Soft is never offered a step.** There is no
   fourth rung, and the app must not invent one.
3. **Only on an empty run.** The condition is `perfectDays === 0` on a
   restart. A person who completed twenty days and missed one is not
   offered anything: they had a challenge that worked and lost a day of it.
   The step-down is for people the tier defeated, not for people who
   slipped.
4. **The label already tells the truth.** A lowered target relabels the
   challenge CUSTOM today; a tier change relabels it MEDIUM in the header
   and in the squad roster. Nobody can step down quietly. That is the
   strongest guard there is: the challenge always says what it is.

The thing that would make the challenge mean nothing is not a person on
Soft; it is a person on Hard who never completes a day and is restarted
into Hard forever. That is the state production is in now.

## 6. Size

Client only; `change_tier` already exists and already takes effect
tomorrow.

- `streakStatus.ts`: one more decision, `stepDownOffer({ tier, restarted,
  sealedDays, dismissed })`, with its copy, tested in
  `streak-status.test.mjs` fail-first like the rest.
- Home `StatusBanner`: the offer inside the restart notice, one control,
  wired to `requestTierChange('medium')`; a dismissal in the store.
- Setup (`auth.tsx`): when `setupContext.lastEndedReason === 'dormant'` and
  the dormant challenge was Hard, preselect Medium — one read already in
  place (F3), plus `base_tier` on it.
- No migration. No RLS change. No new RPC.

About five files. **One phase**, and a short one — shorter than F1 was. The
only reason to make it two would be to ship the Home offer first and watch
whether anyone takes it before touching setup's preselection, and I would do
it in that order inside the one phase.

## What would change this proposal

If the next production read shows the day dying on workout1 or water rather
than workout2 and photo, Medium is not the rescue and the honest offer is
Soft, or a shorter length (`set_challenge_duration` exists too). The offer
should be written so that the rung it proposes is a parameter, not a
constant.
