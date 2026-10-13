/**
 * Module hooks for scripts/app-loader-register.mjs. See that file.
 *
 *   resolve: `@/x` -> src/x(.ts|.tsx|/index.ts); extension-less relative
 *            imports inside src/ are probed the same way; the platform
 *            modules below resolve to in-memory stubs.
 *   load:    serves those stubs; everything else is Node's own TypeScript
 *            type stripping.
 */
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const noop = () => {};
const STUBS = {
  'react-native': `
    export const Platform = { OS: 'web', select: (o) => (o.web ?? o.default) };
    export const StyleSheet = { create: (s) => s, hairlineWidth: 1, flatten: (s) => s };
    export const AppState = { currentState: 'active', addEventListener: () => ({ remove() {} }) };
    export const Dimensions = { get: () => ({ width: 390, height: 844, scale: 2, fontScale: 1 }) };
    export const Linking = { addEventListener: () => ({ remove() {} }), getInitialURL: async () => null, openURL: async () => {} };
    export const Alert = { alert() {} };
    export const NativeModules = {};
    export const PixelRatio = { get: () => 2, getFontScale: () => 1 };
    export const useColorScheme = () => 'dark';
    export default {};
  `,
  '@react-native-async-storage/async-storage': `
    const store = new Map();
    const AsyncStorage = {
      getItem: async (k) => store.get(k) ?? null,
      setItem: async (k, v) => { store.set(k, v); },
      removeItem: async (k) => { store.delete(k); },
      multiGet: async (ks) => ks.map((k) => [k, store.get(k) ?? null]),
      multiSet: async (kv) => { for (const [k, v] of kv) store.set(k, v); },
      multiRemove: async (ks) => { for (const k of ks) store.delete(k); },
      getAllKeys: async () => [...store.keys()],
      clear: async () => { store.clear(); },
    };
    export default AsyncStorage;
  `,
  'expo-localization': `
    export const getLocales = () => [{ languageTag: 'en-US', regionCode: 'US', measurementSystem: 'metric' }];
    export const getCalendars = () => [{ timeZone: 'UTC' }];
  `,
  'expo-linking': `
    export const createURL = (p) => 'rankedfitness://' + p;
    export const getInitialURL = async () => null;
    export const addEventListener = () => ({ remove() {} });
    export const parse = (u) => ({ path: u, queryParams: {} });
    export const openURL = async () => {};
  `,
  'expo-constants': `
    export default { expoConfig: { extra: {}, version: '0.0.0' }, executionEnvironment: 'bare', appOwnership: null };
  `,
  expo: `
    export const registerRootComponent = () => {};
  `,
  'expo-notifications': `
    export const getPermissionsAsync = async () => ({ status: 'undetermined' });
    export const scheduleNotificationAsync = async () => 'id';
    export const cancelAllScheduledNotificationsAsync = async () => {};
  `,
  '@/services/HealthService': `
    export const getHealthService = () => ({ isAvailable: async () => false });
    export const isHealthSimulated = () => false;
    export const setHealthSimulation = () => {};
    export const getHealthAuthDiagnostic = () => null;
  `,
  // THE RECORDING CLIENT. Every RPC name and its arguments land in
  // globalThis.__rpcCalls; every table read answers empty. The app's own
  // api.ts, service and store run unchanged on top of it.
  '@/services/backend/supabaseClient': `
    globalThis.__rpcCalls = globalThis.__rpcCalls ?? [];
    function answer(data) {
      const result = { data, error: null, count: 0 };
      const chain = new Proxy(function () {}, {
        get(_t, key) {
          if (key === 'then') return (res, rej) => Promise.resolve(result).then(res, rej);
          if (key === 'catch') return (rej) => Promise.resolve(result).catch(rej);
          if (key === 'finally') return (fn) => Promise.resolve(result).finally(fn);
          return () => chain;
        },
        apply() { return chain; },
      });
      return chain;
    }
    const client = {
      rpc(name, args) {
        globalThis.__rpcCalls.push({ name, args });
        return answer('33333333-3333-4333-8333-333333333333');
      },
      from() { return answer([]); },
      channel() { const c = { on: () => c, subscribe: () => c, unsubscribe: () => {} }; return c; },
      removeChannel() {},
      auth: {
        getSession: async () => ({ data: { session: null }, error: null }),
        getUser: async () => ({ data: { user: null }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        signOut: async () => ({ error: null }),
      },
    };
    export function getSupabase() { return client; }
    export function isBackendConfigured() { return true; }
  `,
};
void noop;

function probe(base) {
  for (const c of [base, `${base}.ts`, `${base}.tsx`, `${base}.mjs`, `${base}.js`, path.join(base, 'index.ts')]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

export async function resolve(specifier, context, next) {
  if (Object.hasOwn(STUBS, specifier)) {
    return { url: `stub:${specifier}`, shortCircuit: true };
  }
  let target = null;
  if (specifier.startsWith('@/')) {
    target = path.join(root, 'src', specifier.slice(2));
  } else if (
    (specifier.startsWith('./') || specifier.startsWith('../')) &&
    context.parentURL?.startsWith('file:')
  ) {
    target = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
  }
  if (target) {
    // A relative import of a stubbed module (`./supabaseClient` from api.ts)
    // must land on the stub too, or the real client slips in by the back door.
    const alias = `@/${path.relative(path.join(root, 'src'), target).split(path.sep).join('/')}`;
    if (Object.hasOwn(STUBS, alias)) {
      return { url: `stub:${alias}`, shortCircuit: true };
    }
    const found = probe(target);
    if (found) return { url: pathToFileURL(found).href, shortCircuit: true };
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url.startsWith('stub:')) {
    return { format: 'module', source: STUBS[url.slice(5)], shortCircuit: true };
  }
  return next(url, context);
}
