# A4 addendum — the three things before the external link

Phase 17A part 2, D1–D3. These are additions to the A4 TestFlight path, not a
replacement for it. Everything here is either something only you can do in a
dashboard I cannot see, or arithmetic you asked to have worked out.

---

## D1 — the Supabase redirect URL is an ADD, not a REPLACE

**Nothing in this section removes or edits an existing entry. If you find
yourself replacing a value, stop.**

### Where to look

Supabase dashboard → project `dmlgdqufkrtrjgbofpkd` →
**Authentication → URL Configuration**.

Two separate fields live there, and only one of them changes.

### Site URL — DO NOT TOUCH

Leave whatever is there. It should be the web app's origin:

```
https://alymalji.github.io
```

Site URL is Supabase's fallback for any redirect that is **not** on the
allow-list. That fallback is exactly today's behaviour, and it is why the web
build works: an emailed link asks to come back to the web origin, the origin
may or may not be on the list, and Site URL catches it either way. Change this
and every web sign-in link goes somewhere else.

### Redirect URLs — this is the field you are adding to

When you open it you should find at least one entry already, for the web app.
**Whatever is written there stays.** Most likely one of:

```
https://alymalji.github.io
https://alymalji.github.io/
https://alymalji.github.io/**
```

Any of those is fine and none of them needs editing. If the field is empty, the
web build has been running on the Site URL fallback all along — in that case add
`https://alymalji.github.io/**` as well, and the web build keeps working
either way.

**Add these two new entries, on their own lines:**

```
rankedfitness://
rankedfitness://**
```

That is the complete change. The finished field should read as **the web entry
that was already there, plus those two.**

### Why two entries and not one

`AuthService.requestOtp` sets `emailRedirectTo: Linking.createURL('')`, which
resolves per platform:

| platform | what the app asks Supabase to redirect to |
| --- | --- |
| web build in a browser | `https://alymalji.github.io/` (the page's own origin) |
| native iOS build | `rankedfitness://` |

`rankedfitness://` is the exact string the native build sends — it is the one
written down in `authLink.ts` and the reason `createURL('')` is called with an
empty path rather than `'/'` (which would produce `rankedfitness:///`). The
wildcard form is there because Supabase's matcher is documented around
`scheme://**` patterns for mobile deep links, and an allow-list entry that
silently fails to match costs a sign-in with no error anywhere. Two lines is
cheap; a friend staring at a dead email link is not.

### What a missing entry actually costs

Supabase does not reject an unlisted redirect. It **quietly substitutes Site
URL** — so a native build with no `rankedfitness://` entry emails a link that
opens `https://alymalji.github.io` in Safari instead of opening the app. The
6-digit code path still works, so sign-in is not blocked; only the link is.
That is the failure to expect, and it is the one to check against
`device-gate.md` §3.3.

### After you change it

- [ ] The web entry that was there before is still there, unedited.
- [ ] `rankedfitness://` and `rankedfitness://**` are both present.
- [ ] Site URL is unchanged.
- [ ] Sign in on the WEB app with an emailed link. It still works.
      *(This is the regression the change could cause. Check it before the
      phone, not after.)*
- [ ] Sign in on the PHONE with an emailed link. It opens the app.

---

## D2 — the demo account needs a squadmate

### The recommendation, in one line

**Two demo accounts in one squad, with about ten days of plausible history on
both, created a week before submission and deleted the day the review clears.**

### Why one account is a rejection risk

The core feature of this app is a squad. A reviewer who signs in and sees a
squad of one has been shown the app with its main screen empty — no roster, no
feed, no leaderboard, nothing to ping. Guideline 2.1 rejections for
"incomplete functionality" are routinely written about exactly that: the
reviewer could not tell whether the social half was broken or simply had
nothing in it. Giving them a populated squad removes the ambiguity, and it
costs two rows.

### What the two accounts must be

Both are **real accounts under real RLS**. Nothing about them is special-cased
in the app, and no code path exists that treats a demo account differently.
That is the security property, and it is the reason this is safe: a demo
account is exactly as constrained as one of your friends' accounts, which is
what `rls_test.sql`, `squads_test.sql` and `preference_sync_test.sql` already
prove about every account.

| | account A | account B |
| --- | --- | --- |
| purpose | the one the reviewer signs into | the squadmate they see |
| challenge | 75-day, hard, started ~10 days before submission | same squad, same length, a day or two behind |
| squad | creates it | joins it with the invite code |
| history | ~10 days of completions, a few journal entries, meals, one weekly check-in | ~10 days, deliberately not identical — a missed day is fine and makes the leaderboard mean something |

Set the review notes to name account A only. Account B exists to be *seen*, not
signed into.

### What they can and cannot see — the properties to confirm

These are the same guarantees the suite already proves for every account. Run
them against the demo pair anyway, because "the policy is right" and "the
policy is right for these two rows" are different statements:

```sql
-- Run in the SQL editor. Replace the two uuids with the demo accounts'.
-- Every row must read OK.
with demo as (select
  '<A-uuid>'::uuid as a,
  '<B-uuid>'::uuid as b)
select 'A and B share exactly one squad' as item,
       case when (select count(distinct m1.squad_id)
                    from public.squad_members m1
                    join public.squad_members m2 on m2.squad_id = m1.squad_id
                   where m1.user_id = (select a from demo)
                     and m2.user_id = (select b from demo)) = 1
            then 'OK' else 'FINDING' end as verdict
union all
select 'A shares no squad with any REAL user',
       case when not exists (
         select 1 from public.squad_members m1
          join public.squad_members m2 on m2.squad_id = m1.squad_id
         where m1.user_id = (select a from demo)
           and m2.user_id not in ((select a from demo), (select b from demo))
       ) then 'OK' else 'FINDING' end
union all
select 'B shares no squad with any REAL user',
       case when not exists (
         select 1 from public.squad_members m1
          join public.squad_members m2 on m2.squad_id = m1.squad_id
         where m1.user_id = (select b from demo)
           and m2.user_id not in ((select a from demo), (select b from demo))
       ) then 'OK' else 'FINDING' end;
```

The first row is the feature working. **The second and third are the security
property**, and they are the only ones that matter: a squadmate can see a
name, an XP total, a day number, a flame and a task count — and nothing else,
ever, because that is all `get_squad_status()` returns and all the `profiles`
policy exposes. Metrics, nutrition, journal entries and workout logs are
owner-only under RLS on four separate tables, proved in `rls_test.sql`. So the
question "can the demo account read a real user's private data" reduces to "is
the demo account in a squad with a real user", which is what the SQL above
answers with a yes or a no.

Do not add either demo account to your own squad. That is the one action that
would turn a No into a Yes.

### Sign-in for the reviewer — the part I cannot verify for you

Auth is a 6-digit email OTP. A reviewer cannot receive your email, and this is
the most common rejection cause for an app shaped like this one.

The mechanism has to be settled in the dashboard, and I can see neither the
dashboard nor which option your project offers. Two candidates, in order of
preference:

1. **A fixed test OTP for the demo address.** Supabase supports a pre-defined
   email → code map so a given address always accepts the same 6 digits with no
   mail sent. `supabase/config.toml` in this repo documents the phone form
   (`[auth.sms.test_otp]`) and the hosted dashboard exposes the email
   equivalent under Authentication → Sign In / Providers → Email.
   **Confirm that section exists in your project before relying on it** — if it
   is not there, this option does not exist and option 2 is the fallback.
   Security cost: anyone who learns the address and the code can sign into the
   demo account. Since that account is in a squad with nobody real and holds no
   real data, the blast radius is the demo data itself. Delete both accounts
   after review and the cost goes to zero.

2. **A mailbox the reviewer can open.** Create the demo address on a provider
   with web access and put the credentials in the review notes alongside the
   app's. Security cost is larger and lasts as long as the mailbox does — it is
   a real inbox with a real password in a review note. Prefer option 1.

Whichever you use, put in the review notes: the demo email, how to get the
code, and one line saying the second account exists so the squad screens have
something in them.

### Deletion, and confirming it

Both accounts get deleted the day the review clears.

- The app's own **Settings → Delete account** runs `delete_account()`, which
  removes every row the user owns and cascades days, completions, custom tasks,
  overrides and workout logs. Use it, from the app, on both accounts. It is
  also the guideline 5.1.1(v) path, so exercising it on the demo accounts is a
  free check that it works.
- `delete_account()` deliberately does **not** delete the `auth.users` row —
  that needs the service role and is reaped separately (see `PRIVACY_NOTES.md`).
  Finish the job in the dashboard: Authentication → Users → delete both.

Confirm with:

```sql
select 'demo rows remaining' as item, count(*)::text as actual
from public.profiles where id in ('<A-uuid>', '<B-uuid>');
-- expect 0
```

- [ ] Both demo accounts created, in one squad, with history.
- [ ] The three-row SQL above returns OK on every row.
- [ ] Neither demo account is in a squad with a real user.
- [ ] Sign-in mechanism confirmed to work by signing in yourself, on a device
      that has never held that session.
- [ ] After review: both deleted from the app, then from Authentication → Users,
      and the confirming query returns 0.

---

## D3 — build expiry versus when the challenges actually finish

### The rule, stated exactly

- A TestFlight build stops working **90 days after it is uploaded**. A build
  uploaded on **2026-09-05** dies on about **2026-12-04**; you had it as
  2026-12-03, and the difference is which day you upload.
- A challenge's day N falls on `start_date + (N - 1)` — that is
  `challenge_day()` in `0001_init.sql`, and it is why the last day is
  `start_date + duration_days - 1`, not `+ duration_days`.
- The grace window keeps the last day completable until **noon the following
  day** in the challenge's own timezone, so the moment a challenge is truly
  finished with is `start_date + duration_days`, at midday.

### What follows, without needing the database

Every one of the 11 challenges is running **now** — that is what "live" means —
so every `start_date` is on or before **2026-09-04**. Take the worst case: a
75-day challenge that started today.

```
start 2026-09-04  +  75 days  →  last day 2026-11-17,  closed 2026-11-18 noon
build uploaded 2026-09-05     →  expires  2026-12-04
```

**The latest any currently-live challenge can possibly finish is 2026-11-17 —
about two and a half weeks before the build expires.** A 45-day challenge
started today finishes 2026-10-18; a 30-day one, 2026-10-03. Anything that
started earlier finishes earlier still.

So, to answer as asked: **all 11 finish before the build expires. None run past
it.** The day-60 reminder is not load-bearing for this cohort.

Two caveats, and they are the reason the query below is still worth running:

1. It assumes no challenge has a **future** `start_date`. `create_challenge`
   takes the start date as a parameter, so a row dated ahead is possible even
   if unlikely. A 75-day challenge starting after **2026-09-21** would finish
   after the build expires.
2. It assumes all 11 are 30/45/75-day rows, which `0008`'s constraint enforces.

### The query — run it and read the last column

```sql
-- Read-only. Writes nothing. Safe to run repeatedly.
-- Set the expiry date to 90 days after the day you actually upload.
with build as (select date '2026-12-04' as expires_on)
select
  c.id,
  c.duration_days,
  c.start_date,
  c.timezone,
  ((now() at time zone c.timezone)::date - c.start_date) + 1        as day_now,
  c.start_date + c.duration_days - 1                                as last_day,
  c.start_date + c.duration_days                                    as closed_after,
  (select expires_on from build)                                    as build_expires,
  (c.start_date + c.duration_days) - (select expires_on from build) as days_past_expiry,
  case
    when c.start_date + c.duration_days <= (select expires_on from build)
      then 'OK — finishes before the build dies'
    else 'FINDING — runs past expiry by '
         || ((c.start_date + c.duration_days)
             - (select expires_on from build))::text || ' days'
  end as verdict
from public.challenges c
order by c.start_date + c.duration_days desc;
```

The first row is the one that matters: it is the **last** challenge to finish.

- If every `verdict` says OK, there is nothing to schedule. Note the top row's
  `closed_after` date — that is the day the native build stops mattering to
  anyone mid-challenge.
- If any row says FINDING, the refresh date is **day 60 of the build's life**,
  i.e. `upload date + 60` — 2026-11-04 for a 2026-09-05 upload. Thirty days of
  slack to build, upload and have people update, which is the right amount for
  a group of eleven who will not all update the same week.

### Put the date somewhere it will be seen

Whatever the query returns, add one calendar entry:

```
2026-11-04  — Ranked Fitness: rebuild + upload a fresh TestFlight build
              (the current one expires ~2026-12-04)
```

Even with every challenge finishing first, an expired build is an app that
stops opening for anyone who has not deleted it, which is a support message you
would rather not receive.

### And the safety net, which is the real answer

If a build does expire mid-challenge, **nobody is locked out**. The web app
stays live at <https://alymalji.github.io/>, same account, same challenge, same
streak, same squad. This is written up in `device-gate.md` §4, and it is the
argument for keeping the web build running permanently rather than only through
the transition.
