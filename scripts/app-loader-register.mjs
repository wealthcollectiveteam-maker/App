/**
 * Runs the app's REAL modules under plain Node (Phase 38R).
 *
 *   node --import ./scripts/app-loader-register.mjs scripts/<test>.mjs
 *
 * Until 38R every Node proof drove a pure helper with a relative import,
 * because the store, the services and api.ts sit behind the `@/` alias and
 * behind react-native, Expo and Supabase modules Node cannot load. That is
 * exactly how the tenth "passed for the wrong reason" happened: the suite
 * proved what the OFFER said and never ran the store action the button
 * calls. These hooks map the alias onto src/, hand back small stubs for the
 * platform modules, and replace the Supabase client with one that RECORDS
 * every RPC it is asked for — so a test can call the real store action and
 * read the RPC name that would have gone over the wire.
 *
 * The app's own code is not stubbed. Only the edges are.
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

// The app reads these at module scope. A dev build, talking to a "live"
// backend (the recording client below says it is configured).
globalThis.__DEV__ = true;
delete process.env.EXPO_PUBLIC_USE_MOCK;

register('./app-loader-hooks.mjs', pathToFileURL(import.meta.filename));
