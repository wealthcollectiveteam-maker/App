/**
 * THE ONE HOST every public URL of this app reads from.
 *
 * Both legal documents are served from the site that hosts the web build.
 * Their sources live in `public/` in this repo, so `expo export` copies them
 * into `dist/` on every build and `robocopy dist …` publishes them alongside
 * the app. They are never edited on the host directly — that folder is
 * overwritten by the next deploy.
 *
 * The Privacy Policy URL also goes in App Store Connect (App Privacy >
 * Privacy Policy URL) — Apple checks both, and they must agree. Each must
 * stay a publicly reachable https:// page: no sign-in, no geo-block, no
 * redirect to an app store. Guideline 5.1.1(i) wants the policy reachable
 * from inside the app, which is what the Settings rows do with
 * expo-web-browser.
 *
 * PHASE 38J. THE ONE PLACE THE ORGANISATION NAME LIVES. The site moved from
 * a personal GitHub Pages host to a free organisation's, and everything that
 * needs the host reads it from here: the app's legal rows, and — by reading
 * this file's text, not by importing it — scripts/pages-check.mjs (which
 * Pages folder beside the repo to deploy into), scripts/build-redirect-site.mjs
 * (where the old address forwards to) and scripts/identity-guard.test.mjs
 * (which fails if the personal handle ever comes back). Changing the
 * organisation is a one-line edit: this line.
 *
 * These are baked into the binary, but the Settings rows that read them are
 * JavaScript — so if a URL changes later it ships over the air.
 */
export const PUBLIC_SITE_ORIGIN = 'https://rankedfitness.github.io';

export const PRIVACY_POLICY_URL = `${PUBLIC_SITE_ORIGIN}/privacy.html`;

/** Terms of Service, hosted from `public/terms.html` in this repo. */
export const TERMS_OF_SERVICE_URL = `${PUBLIC_SITE_ORIGIN}/terms.html`;

/** The public contact address, the one the legal pages already carry. */
export const SUPPORT_EMAIL = 'rankedappfitness@gmail.com';

/**
 * True while a legal URL is still an unset placeholder.
 *
 * The Settings rows check this so a forgotten URL shows a toast during
 * testing rather than opening a dead page in front of an App Reviewer.
 */
export function isPlaceholderLegalUrl(url: string): boolean {
  return url.includes('REPLACE-ME') || url.includes('example.invalid');
}
