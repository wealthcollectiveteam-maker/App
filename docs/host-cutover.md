# Moving the site to rankedfitness.github.io — the cutover, in order

Written 2026-09-25 (Phase 38J). The app and the legal pages move from the
personal Pages host to the organisation's, `https://rankedfitness.github.io`.
The old address keeps working as a redirect. Do these six steps in this
order and no other; each one says what to check before the next.

The organisation name lives in exactly one place in the code:
`src/constants/legal.ts`, `PUBLIC_SITE_ORIGIN`. Everything else reads it.

Before you start, both folders must exist beside the app:

```
C:\dev\alymalji.github.io          the OLD site (becomes the redirect in step 4)
C:\dev\rankedfitness.github.io     the NEW site (empty clone of the org repo)
```

## 1. Supabase first — the sign-in email must come back to the new address

Nothing about the new host works until this is done, because the emailed
sign-in link is told where to return by the project's URL allow-list.

Open the Supabase dashboard → project `dmlgdqufkrtrjgbofpkd` →
**Authentication → URL Configuration**.

**Site URL** — change it to:

```
https://rankedfitness.github.io
```

**Redirect URLs** — ADD these two lines. Do not remove anything that is
there; the old entries stay until step 4 is done and verified.

```
https://rankedfitness.github.io
https://rankedfitness.github.io/**
```

The list should now contain the old `https://alymalji.github.io…` entries,
the two `rankedfitness://` entries, and the two new lines. Save.

Check before moving on: the page shows the new Site URL and both new
redirect lines after a reload.

Why this is first: the app sends `emailRedirectTo` from one place
(`src/services/backend/AuthService.ts:34`, `Linking.createURL('')`), which on
the web resolves to the page's own origin. A link asked to return to an
origin that is not on the list is sent to Site URL instead. If Site URL still
said the old host when the new site went live, every sign-in email from the
new site would land on the old one.

## 2. Build and deploy to the NEW repo

In PowerShell, in `C:\dev\App`:

```powershell
git pull
npm run predeploy
```

The first run says `dist/ is STALE` — that is expected. Then:

```powershell
npm run build:web
npm run predeploy
```

`predeploy` must end with `dist/ is safe to copy` and
`pages-check before — the destination is clean` naming
`C:\dev\rankedfitness.github.io`. If it names the old folder, stop: the
constant in `legal.ts` was not changed.

Copy in, exactly as before:

```powershell
Get-ChildItem C:\dev\rankedfitness.github.io -Force | Where-Object Name -ne '.git' | Remove-Item -Recurse -Force
robocopy dist C:\dev\rankedfitness.github.io /E
npm run postdeploy
```

`postdeploy` must end with `safe to commit`. Then commit and push the new
repo in GitHub Desktop (the `rankedfitness` account). In the organisation's
repo settings, **Pages** must be set to deploy from `main`, root.

Check before moving on: in a browser, open
`https://rankedfitness.github.io/version.json`. It must show the `buildId`
`postdeploy` printed. The first Pages deploy can take a few minutes.

## 3. Sign in on the new address on your phone

Open `https://rankedfitness.github.io` in Safari on your phone. You will be
asked to sign in — that is expected, see below. Enter your email, then the
code. You should land on Home with your day number, your streak and your
tasks exactly as they were.

Check before moving on: Home shows the right day and streak, and the You
tab shows your best flame. If it shows day 1 with nothing on it, stop and
send me a screenshot; do not go on to step 4.

Why you are signed out: the browser keeps a site's sign-in inside that
site's own storage, and a new address is a new site. Nothing on the server
changed. Everyone in the squad will sign in once, and then it sticks as
before.

## 4. Only now: turn the old address into a redirect

In PowerShell, in `C:\dev\App`:

```powershell
npm run build:redirect
npm run test:redirect-site
```

The test must end `passed, 0 failed`. Then replace the old site's contents
with the redirect:

```powershell
Get-ChildItem C:\dev\alymalji.github.io -Force | Where-Object Name -ne '.git' | Remove-Item -Recurse -Force
robocopy redirect-site C:\dev\alymalji.github.io /E
Get-ChildItem C:\dev\alymalji.github.io -Force
```

The listing must show exactly `.git`, `.nojekyll`, `404.html`, `index.html`.
Commit and push in GitHub Desktop (the personal account).

Check before moving on, after a few minutes: open
`https://alymalji.github.io/` — it should land on the new site. Then open
`https://alymalji.github.io/checkin?x=1` — it should land on
`https://rankedfitness.github.io/checkin?x=1`. Both, not just the first.

## 5. Re-add to Home Screen from the new address

On your phone, delete the old Ranked icon from the Home Screen. Open
`https://rankedfitness.github.io` in Safari, tap Share, tap **Add to Home
Screen**. Open it from the icon and sign in once more if asked.

Check: the icon opens full-screen on the new address (no Safari bar).

## 6. Tell the squad

One line, ready to send:

> Ranked moved to https://rankedfitness.github.io — open that, sign in once with your email, and add it to your Home Screen again. The old link still forwards there. Nothing about your challenge changed.

## If something goes wrong

- Step 2's `predeploy` refuses: read what it names. Nothing has been copied.
- Step 3 shows a fresh day 1: the sign-in went to a different account. Sign
  out (You → Sign out), and sign in with the email you always use.
- Step 4's redirect lands on the old page: Pages has not finished deploying,
  or the `.nojekyll` file is missing. Check the listing and wait five minutes.
- At any point you can stop before step 4. Until step 4 is pushed, the old
  address is untouched and still serves the app.
