/**
 * Hosted legal URLs.
 *
 * ======================================================================
 *   SUPPLY THE REAL PRIVACY POLICY URL BELOW BEFORE THE PRODUCTION BUILD.
 *   The same URL also goes in App Store Connect (App Privacy > Privacy
 *   Policy URL) — Apple checks both, and they must agree.
 * ======================================================================
 *
 * It must be a publicly reachable https:// page: no sign-in, no
 * geo-block, no redirect to an app store. Guideline 5.1.1(i) wants the
 * policy reachable from inside the app, which is what the Settings row
 * does with expo-web-browser.
 *
 * This one is baked into the binary, but the Settings row that reads it
 * is JavaScript — so if the URL changes later it ships over the air.
 */
export const PRIVACY_POLICY_URL = 'https://example.com/REPLACE-ME/privacy';

/**
 * True while PRIVACY_POLICY_URL is still the placeholder above.
 *
 * The Settings row checks this so a forgotten URL shows a toast during
 * testing rather than opening a dead page in front of an App Reviewer.
 * Delete nothing when you set the URL — the check simply stops matching.
 */
export function isPlaceholderLegalUrl(url: string): boolean {
  return url.includes('REPLACE-ME');
}
