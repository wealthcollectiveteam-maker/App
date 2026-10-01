# "Start tomorrow" at setup — estimate only (Phase 38D, D2)

Written 2026-09-22 against HEAD fccfc5f plus the D1 commit. No code, no
migration. File and line references are to the repo as it stands.

## 1. Is there a start date, or is day N computed from created_at?

There is a start date, and day N is computed from it, never from created_at.

- `challenges.start_date date` exists alongside `created_at`
  (0001_init.sql, the table; both columns are read by `my_active_challenge`,
  0007_missed_day_engine.sql:216-224, which orders by `start_date desc,
  created_at desc`).
- The current day, 0001_init.sql:250-256:

      create or replace function public.challenge_day(c public.challenges)
      returns integer
      language sql stable
      as $$
        select ((now() at time zone c.timezone)::date - c.start_date) + 1;
      $$;

- Every boundary derives from the same column: `day_closes_at(c, p_day)` is
  `start_date + p_day` at `grace_deadline_hour()` in the challenge's zone
  (0011_grace_window.sql:75-81), and `earliest_open_day`, `last_closed_day`
  and `day_is_open` are built on those two (0011:83-114).
- `create_challenge(p_base_tier, p_start_date, p_timezone, p_duration_days)`
  already takes the start date as a parameter (0008_challenge_length_and_
  setup_customs.sql:119-146). The client always passes today:
  `startDateFor(timezone)` at src/services/backend/session.ts:49-55, called
  from `createFirstChallenge` at session.ts:91-98.

So the schema needs nothing for the date itself. What is missing is a way to
choose it, and a defined state for the day before it.

## 2. Ways to add a chosen start date

None of these rewrites an existing row: every live challenge keeps
`start_date = the day it was created`, which is what it means today.

1. **Client passes tomorrow to the RPC that already exists.** Zero server
   change for the date. `startDateFor` grows a `startTomorrow` flag and adds
   one day in the device's calendar. Weakest option: the client already owns
   this date (a trust hole 0008 left open), and this would lean on it harder.
   A phone whose clock is wrong can already create a challenge on the wrong
   day; with a "tomorrow" control it can create one two days out.
2. **Server computes it.** Replace `p_start_date` with a
   `p_start_tomorrow boolean default false` and let `create_challenge` set
   `start_date := (now() at time zone v_tz)::date + case when p_start_tomorrow
   then 1 else 0 end`. This is the one that matches "server owns the clock"
   (CLAUDE.md) and closes the existing hole at the same time. Needs a
   migration because the signature changes — DROP then CREATE, the 0011
   lesson, so the old arity cannot survive beside the new one.
3. **A separate `starts_at timestamptz`** to allow an arbitrary start hour.
   Not worth it: the day boundary is a local date plus a fixed hour, and
   nothing in the engine wants a start instant.

Recommendation: 2.

## 3. The evaluator floor

0015_restart_day_one_judged.sql:147:

    v_day := greatest(c.last_evaluated_day + 1,
               case when c.restarted_from is null then 2 else 1 end);

with `create_challenge` writing `last_evaluated_day = 1` (0008:137) and
`restart_challenge` writing `0` (0015:78-81).

- **A challenge that starts tomorrow, with the floor as it is:** day 1 is
  still never judged. The floor keys on `restarted_from`, not on how much of
  day 1 the person had. The D1 line ("Day 1 is never counted as a miss")
  stays true for them, which is why D1 keys on `day === 1 && !restarted`
  and not on the calendar.
- **Is that what we want?** The exemption exists because a same-day signup
  gets a partial day 1. A tomorrow start gets a whole one — midnight to the
  next noon — so the reason for the exemption is gone. Judging it would be
  fair. The cost is a third case in the floor, and I would not encode it as a
  second CASE branch. Replace the CASE with a column:

      alter table public.challenges
        add column first_judged_day integer not null default 2;
      -- create_challenge: 2 for a same-day start, 1 for a tomorrow start
      -- restart_challenge: 1 (what 0015's CASE returns today)
      v_day := greatest(c.last_evaluated_day + 1, c.first_judged_day);

  The default of 2 makes every existing row behave exactly as now, and the
  existing restarted rows (all nine hold `last_evaluated_day` 1, per 0015's
  proof) are unaffected because the greatest() already takes the +1 branch.
- **The upper bound is safe on the day before the start.** `challenge_day`
  is 0 that day; `earliest_open_day` floors at 1 (0011:96-97) so
  `last_closed_day` is 0, `v_last` is 0, and the loop body never runs.
  Nothing is judged, nothing is frozen. That part needs no change.
- **restarted_from still behaves.** `restart_challenge` inserts its own row
  with `start_date = today` and would write `first_judged_day = 1`; the
  0015 tests (restart's untouched day 1 judged missed; completed-but-unsealed
  day 1 sealed and paid) keep passing unchanged.
- **D1 must follow.** If `first_judged_day` exists, `dayOneLine()` in
  src/lib/streakStatus.ts must take it (line shown only when it is 2), or the
  line lies to the tomorrow-start user whose day 1 is judged. That is a
  one-field change to a pure function with a test already in place.

## 4. restart_challenge

The premise "a restart made at 11pm has the same problem as a signup made at
11pm" does not hold, because of when restarts are made:

- A miss is judged only after its day closes, at noon local
  (`last_closed_day`, 0011:100-107; `v_last` at 0015:141).
- The evaluator runs hourly at :05 via pg_cron (0007:1372-1377).
- So a Hard restart is made between 12:05 and 13:05 local on the day after
  the miss, and `restart_challenge` sets `start_date = today`
  (0015:58, 0015:66-70). Its day 1 runs from that moment until noon the day
  after — never less than about 23 hours, plus the whole grace morning.

A 23:52 signup gets 12 hours 8 minutes. A restart gets roughly twice that
at worst. The two are not the same problem, and 0015's decision to judge a
restart's day 1 was made on exactly that basis.

**Opinion: no.** Do not offer "start tomorrow" on a restart. It would put a
dead day between the judgement and the new day 1 — the person opens the app
after a miss and has nothing to do until tomorrow, which is worse than a
full day 1. If the evaluator's schedule ever moves to once a day at night,
revisit; the argument depends on the hourly run.

One thing to keep from this section: whatever the floor mechanism becomes,
`restart_challenge` must write it explicitly (`first_judged_day = 1`), not
inherit a default.

## 5. Grace window and day snapshots

Grace window: no change in principle. Every boundary is `start_date +
p_day` (0011:75-81), so a start date one day later moves every boundary one
day later, including day 1's close at noon on day 2. The only novel state is
the day BEFORE the start, when `challenge_day` is 0, and there:

- `get_day_window()` (0011:333-395) loops `for v_d in v_earliest .. v_today`
  = `1 .. 0`, iterates zero times, and returns **no rows**.
- `get_or_freeze_today()` (0011:166-176) calls `get_or_freeze_day(0)`, which
  refuses with `day 0 is closed (open: 1 to 0)` (0011:143-146).

Both are correct refusals and both are undefined states for the client. See
section 8.

Snapshots: `forbid_snapshot_mutation()` (0007:299-320) stays exactly as it
is and nothing here touches it. A tomorrow start creates no row on the day
before — `get_or_freeze_day` refuses day 0 and the evaluator loop does not
run — so there is no day-0 snapshot to be immutable about. Day 1's snapshot
is frozen the first time day 1 is opened, or back-filled by the evaluator,
from the config in force then. Setup custom tasks carry `active_from_day 1`
(session.ts:100-114; `add_setup_custom_task`) and are in it. If anything,
a tomorrow start removes the ordering trap session.ts:100-107 warns about,
because nothing CAN freeze day 1 at setup.

Watch `sim_jump_to_day` (0008:606-633): it rewrites `start_date` backwards
for the dev sheet. Unaffected, but any test fixture that assumes
`start_date = created_at::date` stops being a safe assumption.

## 6. Migration needed?

Yes, if section 2's option 2 or section 3's column is chosen. Both in one
file, sketch only, not applied:

    -- 0016_start_tomorrow.sql (sketch)

    alter table public.challenges
      add column if not exists first_judged_day integer not null default 2
      check (first_judged_day in (1, 2));

    drop function if exists public.create_challenge(text, date, text, integer);
    create or replace function public.create_challenge(
      p_base_tier text, p_timezone text default 'UTC',
      p_duration_days integer default 75, p_start_tomorrow boolean default false)
    returns uuid ... as $$
      -- v_tz validated as today (0008:129-131)
      v_start := (now() at time zone v_tz)::date
               + case when p_start_tomorrow then 1 else 0 end;
      insert into public.challenges
        (owner, base_tier, start_date, timezone, last_evaluated_day,
         duration_days, first_judged_day)
      values (auth.uid(), p_base_tier, v_start, v_tz, 1, p_duration_days,
              case when p_start_tomorrow then 1 else 2 end);
      ...
    $$;

    -- restart_challenge: add first_judged_day => 1 to the insert (0015:66-80)
    -- evaluate_challenge: v_day := greatest(c.last_evaluated_day + 1,
    --                                       c.first_judged_day);
    -- get_or_freeze_today: raise 'challenge starts tomorrow' when
    --   challenge_day(c) < 1, instead of the generic 'day 0 is closed'
    -- get_day_window: unchanged (zero rows is a fine answer once the client
    --   has a way to know why) — OR a new my_challenge_status() returning
    --   (start_date, challenge_day, duration_days) for the pre-start screen.
    -- grants: revoke all on the new signature, then grant execute to
    --   authenticated only — the 0002 allow-list pattern, and the old
    --   signature's grant must not survive.

Plus the self-check block every migration since 0014 carries.

## 7. Tests, in the order I would write them

1. **SQL, missed_day_test.sql, fail first:** a challenge created with
   `p_start_tomorrow` has `challenge_day` 0 today; `get_day_window()`
   returns zero rows; `get_or_freeze_today()` raises the NAMED error.
   Against the current function it raises `day 0 is closed`, which is the
   failing-first proof and also the bug in section 8.
2. **SQL:** run `evaluate_challenge` on that pre-start day: 0 judged, no
   `challenge_days` row for day 0 or day 1, `last_evaluated_day` unchanged.
3. **SQL:** advance the clock (the suite's `set_now` fixture) to day 1
   untouched, then to day 2 after noon: day 1 is judged missed when
   `first_judged_day = 1`. Fail first against the current floor, which
   skips it.
4. **SQL:** same-day start still gets `first_judged_day 2` and day 1 still
   never judged — the existing "fresh challenge's day 1 must still never be
   judged" proof, re-run.
5. **SQL:** 0015's four restart proofs, unchanged, still pass with
   `restart_challenge` writing `first_judged_day 1` explicitly.
6. **RLS suite:** the new `create_challenge` signature is executable by
   `authenticated` and not by `anon`; the old signature is gone. This is the
   0008 lesson and the one the local stub cannot prove — must run against
   the real project.
7. **Client, pure:** `checkAccount()`'s classification of
   `challenge starts tomorrow` is `ready`, not `needs-challenge` and not a
   throw. A small extraction of the regex at session.ts:70-72 into a
   testable function, day-boundary.test.mjs style.
8. **Client, pure:** `dayOneLine()` takes `firstJudgedDay` and returns null
   when it is 1 — extend streak-status.test.mjs, fail first.
9. **Client, reachability:** the setup screen's "start tomorrow" control is
   reachable in the default state (checkin-card.test.mjs style: the decision
   as a pure function, then a source-attachment check on auth.tsx).
10. **Render check:** the pre-start Home state paints something with a
    non-zero box — the class of bug render-check.mjs exists for.

## 8. The one thing most likely to go wrong

**The day before the start, the app has no idea what it is looking at.**

Today `checkAccount()` (session.ts:65-73) calls `get_or_freeze_today()` and
swallows exactly one error, `no challenge for user`, as "needs a challenge".
On a pre-start day that call raises `day 0 is closed (open: 1 to 0)`
instead. Two ways to lose:

- As written, that message does not match `/no challenge/`, so
  `checkAccount` throws and sign-in fails for every tomorrow-start user on
  their first evening. They chose "start tomorrow" and got locked out.
- If someone "fixes" that by widening the match, `needs-challenge` sends
  `createFirstChallenge` back through `create_challenge`, which hits the
  `challenges_one_active_owner` unique index (0007:193-194) and fails with a
  duplicate-key error the user can do nothing about — the exact failure the
  comment at session.ts:87-90 was written to prevent.

And downstream, `SupabaseDataService.hydrate` reads `get_day_window()`,
finds no `is_today` row, sets `challengeId = null`, `day = 1`, never calls
`getChallengeConfig`, and paints a day 1 with an empty task list and a Hard
tier badge (SupabaseDataService.ts:414-445). That screen is a lie.

**How a test catches it:** test 1 above pins the server's answer to a named
error, and test 7 pins the client's classification of that exact string.
Together they mean the pre-start day is a state the app recognises, not one
it falls through. The render check (test 10) is what proves the recognised
state actually puts something on screen.

## 9. Rough size

Server, one migration: `create_challenge` (signature), `restart_challenge`
(one column), `evaluate_challenge` (one line), `get_or_freeze_today` (one
message), possibly `my_challenge_status()`; plus grants and self-check.
Tests: missed_day_test.sql, grace_window_test.sql, rls_test.sql.

Client: session.ts (`createFirstChallenge`, `startDateFor` removed,
`checkAccount`), api.ts (`createChallenge`, a status read), types.ts and
SupabaseDataService.ts (a `preStart` state), useSessionStore.ts, auth.tsx
(the control), index.tsx and checkin.tsx (the pre-start screen),
streakStatus.ts + streak-status.test.mjs (`firstJudgedDay`), mock.ts.

About 14 files. **Two phases**, not one: server plus its SQL proofs first,
applied to the real project by hand as always; client second, against a
database that already answers the new question. Doing both in one phase
means a client that cannot be tested against anything real until the
migration lands, and this project has shipped that shape before.
