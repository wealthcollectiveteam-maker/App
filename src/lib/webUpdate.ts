import { Platform } from 'react-native';

import {
  BUILD_ID,
  UPDATE_PARAM,
  VERSION_MANIFEST_PATH,
} from '@/constants/build';

/**
 * Getting a new build onto an installed Home Screen web app.
 *
 * iOS does not treat a standalone PWA as a page it should re-fetch. It
 * suspends it and RESUMES it: reopening from the app switcher frequently
 * touches the network not at all, so a push to Pages can sit unseen
 * indefinitely and the user has no address bar, no reload button and no way
 * to know. That is the whole problem this file exists for.
 *
 * NO SERVICE WORKER, deliberately. It is the textbook answer and it is the
 * wrong trade here: a service worker that caches a broken build pins that
 * build on a friend's phone permanently, and the only recovery is talking a
 * non-technical person through clearing site data. Across five users the
 * downside dominates. Everything below is plain fetch and plain navigation,
 * so the worst failure is the status quo — a stale app with no banner.
 *
 * Web only. Native ships through EAS and the App Store, which have their own
 * update path; every function here returns inert on iOS.
 */
const IS_WEB = Platform.OS === 'web';

function canUseDom() {
  return IS_WEB && typeof window !== 'undefined';
}

/**
 * The build id the SERVER is currently offering, or null if it cannot be
 * established.
 *
 * Cache defeat is doubled on purpose, because this is the one request in the
 * app that must never be answered from a cache — a cached version.json
 * reports the running build as current for as long as it lives, which is
 * exactly the failure this whole mechanism exists to end:
 *
 *   - `cache: 'no-store'` tells the browser's HTTP cache not to read from or
 *     write to it for this request.
 *   - a unique query param makes the URL itself different every time, so any
 *     layer that ignores the first instruction — an intermediary, a CDN, a
 *     future service worker someone adds against this file's advice — has no
 *     prior entry to serve. GitHub Pages sends `Cache-Control: max-age=600`
 *     on static files, so without this the app could be up to ten minutes
 *     behind even when the browser behaves.
 *
 * Fails CLOSED and silently. A 404, a parse error, an offline phone and a
 * build that was never stamped all land here as null, which means no banner.
 * Announcing an update that does not exist would be the UI claiming something
 * that did not happen.
 */
export async function fetchServerBuildId(): Promise<string | null> {
  if (!canUseDom()) return null;
  try {
    const url = `${VERSION_MANIFEST_PATH}?t=${Date.now()}`;
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) return null;
    const data: unknown = await response.json();
    const buildId = (data as { buildId?: unknown } | null)?.buildId;
    return typeof buildId === 'string' && buildId.length > 0 ? buildId : null;
  } catch {
    return null;
  }
}

/** True when the server is offering a build that is not the one running. */
export function isDifferentBuild(serverBuildId: string | null) {
  return !!serverBuildId && serverBuildId !== BUILD_ID;
}

/**
 * Load the new build. ONLY ever called from the user's own tap.
 *
 * Never reload on the app's initiative. Someone may be mid-sentence in a
 * journal entry or partway through a timed task, and a silent reload that
 * eats their input is a worse outcome than running yesterday's bundle for
 * another day.
 *
 * `?v=<new id>` is what makes this a genuinely fresh document rather than the
 * resumed one: a different URL cannot be satisfied by a cached or restored
 * copy of the old one, so the HTML is re-fetched, and the HTML is what names
 * the `entry-<hash>.js` to load. `replace` rather than `assign` so Back does
 * not return to the stale document that was just abandoned.
 */
export function applyUpdate(serverBuildId: string) {
  if (!canUseDom()) return;
  const url = new URL(window.location.href);
  url.searchParams.set(UPDATE_PARAM, serverBuildId);
  window.location.replace(url.toString());
}

/**
 * Take `?v=` back out of the address once the new document is running.
 *
 * It has done its job by the time this executes, and leaving it there means
 * a shared link carries a build hash that will be wrong tomorrow.
 * `replaceState` rewrites the entry in place — no navigation, no history
 * entry, and the path is untouched so expo-router never notices.
 */
export function cleanUpdateParamFromUrl() {
  if (!canUseDom()) return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has(UPDATE_PARAM)) return;
  url.searchParams.delete(UPDATE_PARAM);
  const query = url.searchParams.toString();
  window.history.replaceState(
    window.history.state,
    '',
    `${url.pathname}${query ? `?${query}` : ''}${url.hash}`,
  );
}
