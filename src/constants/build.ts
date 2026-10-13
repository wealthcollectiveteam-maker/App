/**
 * WHICH BUILD THIS IS.
 *
 * `BUILD_ID` is a placeholder in source and stays one through Metro. After
 * `expo export` finishes, scripts/build-web.mjs rewrites the exact token below
 * inside the emitted bundle, replacing it with the hash Expo put in the bundle
 * FILENAME — and writes that same hash into dist/version.json. One value,
 * stamped into both places by one line of the build script, so the running app
 * and the file it checks against cannot disagree by accident. The build fails
 * if the token is not found, or if the two do not match afterwards.
 *
 * Why the filename hash and not a version number or a timestamp: it is a hash
 * of the bundle's own bytes, so it changes exactly when the code changes and
 * never when it does not. A timestamp would announce an update after every
 * rebuild of identical source; a hand-maintained version number would be
 * forgotten.
 *
 * The stamp happens AFTER the export, so the filename is a hash of the
 * unstamped bytes. That is deliberate and it is not circular: hashing the
 * stamped file would change the hash that was just stamped into it.
 *
 * DO NOT compare against this token anywhere. The rewrite replaces every
 * occurrence of it in the bundle, so a `BUILD_ID === '__RANKED_BUILD_ID__'`
 * check would become `hash === hash` and silently read as true. Ask
 * `versionJsonUnavailable` instead — a build that was never stamped is also a
 * build with no version.json to fetch, and the check fails closed.
 */
export const BUILD_ID = '__RANKED_BUILD_ID__';

/** Where the build writes the manifest the running app checks itself against. */
export const VERSION_MANIFEST_PATH = '/version.json';

/** The query key that forces a fresh document; stripped again once loaded. */
export const UPDATE_PARAM = 'v';
