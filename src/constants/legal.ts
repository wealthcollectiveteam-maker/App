/**
 * Hosted legal URLs.
 *
 * Both documents are served from the GitHub Pages site that hosts the web
 * build. Their sources live in `public/` in this repo, so `expo export`
 * copies them into `dist/` on every build and `robocopy dist …` publishes
 * them alongside the app. They are never edited in the Pages repo directly
 * — that folder is overwritten by the next deploy.
 *
 * The Privacy Policy URL also goes in App Store Connect (App Privacy >
 * Privacy Policy URL) — Apple checks both, and they must agree.
 *
 * Each must stay a publicly reachable https:// page: no sign-in, no
 * geo-block, no redirect to an app store. Guideline 5.1.1(i) wants the
 * policy reachable from inside the app, which is what the Settings rows do
 * with expo-web-browser.
 *
 * These are baked into the binary, but the Settings rows that read them are
 * JavaScript — so if a URL changes later it ships over the air.
 */
export const PRIVACY_POLICY_URL = 'https://alymalji.github.io/privacy.html';

/** Terms of Service, hosted from `public/terms.html` in this repo. */
export const TERMS_OF_SERVICE_URL = 'https://alymalji.github.io/terms.html';

/**
 * True while a legal URL is still an unset placeholder.
 *
 * The Settings rows check this so a forgotten URL shows a toast during
 * testing rather than opening a dead page in front of an App Reviewer.
 * Both URLs above are set, so this no longer matches either of them — it is
 * kept as the guard for whatever legal URL is added next.
 */
export function isPlaceholderLegalUrl(url: string): boolean {
  return url.includes('REPLACE-ME');
}
