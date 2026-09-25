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
 * PHASE 38I. The host below is the GitHub Pages site, whose name is a
 * personal handle. It works today and the web build depends on it, so it is
 * not swapped for a placeholder here — a dead privacy link in front of an
 * App Reviewer is worse than a handle. Instead scripts/identity-guard.test.mjs
 * FAILS while this line carries the handle, and fails on a REPLACE-ME
 * placeholder too, so a build that ships either is caught by the test run,
 * not by a reviewer. When the owner chooses the neutral host, this line is
 * the only one that changes.
 *
 * These are baked into the binary, but the Settings rows that read them are
 * JavaScript — so if a URL changes later it ships over the air.
 */
export const PUBLIC_SITE_ORIGIN = 'https://alymalji.github.io';

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
