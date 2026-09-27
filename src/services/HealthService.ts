import Constants from 'expo-constants';
import { isRunningInExpoGo } from 'expo';
import { Platform } from 'react-native';

import {
  READ_TYPES,
  activityLabel,
  authArgs,
  durationSeconds,
  quantityQueryArgs,
  todayRange,
  workoutQueryArgs,
  type ReadTypeIdentifier,
} from '@/lib/healthKitArgs';
import {
  canAttemptHealthKit,
  parseAuthRequestStatus,
  type HealthAuthRequestStatus,
  type HealthRuntimeEnv,
} from '@/services/healthEnv';

// Re-exported so callers keep importing the Health vocabulary from the
// Health service. The definition lives in healthEnv.ts because that module
// has no react-native imports and can therefore be proved in plain Node.
export type { HealthAuthRequestStatus };

/**
 * Live runtime signals for the HealthKit gate (see healthEnv.ts).
 *
 * `isRunningInExpoGo()` is the discriminator: it is Expo Go's own native
 * module, present in exactly one binary. `Constants.expoGoConfig` is NOT
 * read here any more — a development build served by Metro carries an
 * `extra.expoGo` block in its manifest too, and reading it as "Expo Go"
 * is what made Health unavailable on the owner's real iPhone (Phase 38M).
 */
function runtimeEnv(): HealthRuntimeEnv {
  let runningInExpoGo = false;
  try {
    runningInExpoGo = isRunningInExpoGo();
  } catch {
    runningInExpoGo = false;
  }
  return {
    platformOS: Platform.OS,
    appOwnership: (Constants.appOwnership as string | null) ?? null,
    runningInExpoGo,
  };
}

export interface HealthWorkout {
  /** Human-readable activity type ("Functional Strength Training"). */
  type: string;
  minutes: number;
  startISO: string;
}

export interface BodyMassSample {
  kg: number;
  dateISO: string;
}

/**
 * Read-only Apple Health access. HARD RULES:
 * - Read permissions only; write permission is never requested.
 * - Values are used to render prompts and pre-fill fields on-device only.
 *   They are never written to a backend or AsyncStorage, never logged, and
 *   never shown to other users.
 * - Health is a convenience layer: when unavailable, denied, or revoked,
 *   every method resolves to null/empty and the app behaves normally.
 */
export interface IHealthService {
  /** True when a HealthKit source can be queried on this device. */
  isAvailable(): boolean;
  /**
   * Present the read-permission sheet. Resolves TRUE when the request
   * COMPLETED — not when it was granted. HealthKit never reports read
   * grants (see HealthAuthRequestStatus), so no caller may treat this as
   * "we now have data".
   */
  requestReadPermissions(): Promise<boolean>;
  /** Has this device ever been asked? See HealthAuthRequestStatus. */
  getAuthRequestStatus(): Promise<HealthAuthRequestStatus>;
  /** Total dietary energy (kcal) logged today, or null when unknown. */
  getTodayDietaryEnergyKcal(): Promise<number | null>;
  /** Total steps today, or null when unknown. */
  getTodaySteps(): Promise<number | null>;
  /** Active energy burned today (kcal), or null when unknown. */
  getTodayActiveEnergyKcal(): Promise<number | null>;
  /**
   * Today's workouts, chronological. `[]` means the query RAN and returned
   * nothing; `null` means it could not run. The two must stay distinct — an
   * empty array standing in for a failed read is how "No workouts recorded
   * today" gets printed over an absence of permission.
   */
  getTodayWorkouts(): Promise<HealthWorkout[] | null>;
  /** Most recent body-mass sample with its date, or null when unknown. */
  getLatestBodyMass(): Promise<BodyMassSample | null>;
}

/** Used on web/Android/Expo Go and whenever HealthKit cannot load. */
class NullHealthService implements IHealthService {
  isAvailable() {
    return false;
  }
  async requestReadPermissions() {
    return false;
  }
  async getAuthRequestStatus(): Promise<HealthAuthRequestStatus> {
    return 'unavailable';
  }
  async getTodayDietaryEnergyKcal() {
    return null;
  }
  async getTodaySteps() {
    return null;
  }
  async getTodayActiveEnergyKcal() {
    return null;
  }
  async getTodayWorkouts(): Promise<HealthWorkout[] | null> {
    // null, not []. Nothing was queried, so nothing may be reported as
    // "queried and empty" — that is the whole distinction.
    return null;
  }
  async getLatestBodyMass() {
    return null;
  }
}

/**
 * Dev-menu simulation so the Health-driven UI (card, suggestions, prefill)
 * is QA-able in Expo Go and on web where HealthKit does not exist.
 */
class SimulatedHealthService implements IHealthService {
  isAvailable() {
    return true;
  }
  async requestReadPermissions() {
    return true;
  }
  async getAuthRequestStatus(): Promise<HealthAuthRequestStatus> {
    authDiagnostic = { raw: '2 (simulated)', typeOf: 'number', parsedAs: 'requested' };
    return 'requested';
  }
  async getTodayDietaryEnergyKcal() {
    return 1430;
  }
  async getTodaySteps() {
    return 7412;
  }
  async getTodayActiveEnergyKcal() {
    return 534;
  }
  async getTodayWorkouts(): Promise<HealthWorkout[]> {
    const start = new Date();
    start.setHours(18, 12, 0, 0);
    return [
      {
        type: 'Functional Strength Training',
        minutes: 47,
        startISO: start.toISOString(),
      },
    ];
  }
  async getLatestBodyMass(): Promise<BodyMassSample> {
    return { kg: 82.5, dateISO: new Date().toISOString() };
  }
}

/**
 * WHAT THE OS ACTUALLY HANDED BACK, kept for one reason: so a failure can be
 * READ rather than deduced.
 *
 * `getRequestStatusForAuthorization` is a Nitro native call. Read from the
 * installed library (Phase 38M): the Swift side resolves a Nitro enum and the
 * generated converter hands JS a NUMBER — 0 unknown, 1 shouldRequest,
 * 2 unnecessary (nitrogen/generated/shared/c++/AuthorizationRequestStatus.hpp).
 * Anything Swift cannot map is thrown, not returned. The raw value, its
 * typeof and the parse are recorded here on every call and shown in the
 * Health diagnostics card (Settings → Developer) next to the state the app
 * mapped it to, so a surprise is seen, never silently absorbed.
 *
 * PRIVACY: this is an OS AUTHORIZATION ENUM — 0, 1 or 2 — and never a health
 * value. It says whether a permission sheet has been shown on this device. It
 * carries no step count, no weight, no workout, nothing derived from one, and
 * it must stay that way: nothing from a HealthKit SAMPLE may ever be put in
 * this string. The rule that health values are never logged is intact.
 */
export interface HealthAuthDiagnostic {
  raw: string;
  typeOf: string;
  parsedAs: HealthAuthRequestStatus;
}

let authDiagnostic: HealthAuthDiagnostic | null = null;
let authDiagnosticLogged = false;

/** The last raw auth-status answer, for the dev sheet. Null until asked. */
export function getHealthAuthDiagnostic(): HealthAuthDiagnostic | null {
  return authDiagnostic;
}

/** Describe a value without assuming it can be stringified safely. */
function describeRaw(value: unknown): string {
  try {
    if (value instanceof Error) return value.message || String(value);
    if (typeof value === 'object' && value !== null) return JSON.stringify(value);
    return String(value);
  } catch {
    return '(unstringifiable)';
  }
}

/** The unit each quantity type is read in. Body mass is read separately. */
const QUANTITY_UNITS: Partial<Record<ReadTypeIdentifier, string>> = {
  HKQuantityTypeIdentifierDietaryEnergyConsumed: 'kcal',
  HKQuantityTypeIdentifierStepCount: 'count',
  HKQuantityTypeIdentifierActiveEnergyBurned: 'kcal',
  HKQuantityTypeIdentifierBodyMass: 'kg',
};

/**
 * Real HealthKit reads via @kingstinct/react-native-healthkit. The module
 * is lazy-required behind a POSITIVE environment gate (see healthEnv.ts) —
 * a throw inside a module factory becomes a fatal error in Metro, so the
 * require must never be evaluated where the native side can't exist.
 * Every method degrades to null/empty on any failure.
 *
 * Every argument handed to the library is built in lib/healthKitArgs.ts,
 * the one place its dialect is spelled and proved against its source.
 */
class HealthKitService implements IHealthService {
  private mod: any | null = null;
  private loadFailed = false;
  private loadError: string | null = null;

  getModule(): any | null {
    if (this.loadFailed || !canAttemptHealthKit(runtimeEnv())) return null;
    if (!this.mod) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        this.mod = require('@kingstinct/react-native-healthkit');
      } catch (error) {
        this.loadFailed = true;
        this.loadError = describeRaw(error);
        return null;
      }
    }
    return this.mod;
  }

  /** For the diagnostics card only. */
  loadState(): { status: 'loaded' | 'load-failed' | 'not-attempted'; message?: string } {
    if (this.mod) return { status: 'loaded' };
    if (this.loadFailed) return { status: 'load-failed', message: this.loadError ?? undefined };
    return { status: 'not-attempted' };
  }

  isAvailable(): boolean {
    const mod = this.getModule();
    try {
      return !!mod?.isHealthDataAvailable?.();
    } catch {
      return false;
    }
  }

  async requestReadPermissions(): Promise<boolean> {
    const mod = this.getModule();
    if (!mod) return false;
    try {
      // READ ONLY — authArgs() builds no share list at all.
      await mod.requestAuthorization(authArgs());
      // TRUE means the request completed, NOT that anything was granted.
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Has the sheet ever been shown for our read types on this device?
   *
   * `HKAuthorizationRequestStatus` is the only authorization question Apple
   * will answer for read types: `shouldRequest` when at least one type is
   * still undetermined, `unnecessary` once every one has been asked about.
   * Neither value says whether access was GRANTED, and there is no API that
   * does — a read-denied type simply returns no samples, exactly like a type
   * with no data. That is deliberate on Apple's part and it is why the card
   * has to name the ambiguity instead of resolving it.
   *
   * THE QUESTION MUST NAME THE TYPES. Asked about an empty list, the Swift
   * side answers `unnecessary` — "already asked" — regardless of the truth
   * (ios/CoreModule.swift). The old `{ read, share }` keys were exactly that
   * empty question; authArgs() spells the keys the library reads.
   *
   * Any failure resolves 'unknown', which callers read as 'not-requested'.
   */
  async getAuthRequestStatus(): Promise<HealthAuthRequestStatus> {
    const mod = this.getModule();
    if (!mod) return 'unavailable';
    try {
      const status = await mod.getRequestStatusForAuthorization(authArgs());
      const parsed = parseAuthRequestStatus(status);
      authDiagnostic = {
        raw: describeRaw(status),
        typeOf: typeof status,
        parsedAs: parsed,
      };
      // ONCE per launch, not per refresh: this fires on every screen focus.
      // Unconditional rather than __DEV__-guarded, because the build that
      // needs diagnosing is a TestFlight build where __DEV__ is false — and
      // a log line is not a surface anybody but the tester will ever look at.
      // Same channel services/index.ts already warns on in production.
      // An authorization enum, never a health value: see HealthAuthDiagnostic.
      if (!authDiagnosticLogged) {
        authDiagnosticLogged = true;
        console.warn(
          `[health:auth-status] raw=${authDiagnostic.raw} ` +
            `typeof=${authDiagnostic.typeOf} parsedAs=${parsed}`,
        );
      }
      return parsed;
    } catch (error) {
      authDiagnostic = {
        raw: `threw: ${describeRaw(error)}`,
        typeOf: 'error',
        parsedAs: 'unknown',
      };
      if (!authDiagnosticLogged) {
        authDiagnosticLogged = true;
        console.warn(`[health:auth-status] ${authDiagnostic.raw}`);
      }
      return 'unknown';
    }
  }

  /** Raw samples for one quantity type, today. Throws on failure. */
  private async quantitySamplesToday(
    identifier: ReadTypeIdentifier,
  ): Promise<{ quantity?: number }[]> {
    const mod = this.getModule();
    if (!mod) throw new Error('module not loaded');
    const samples = await mod.queryQuantitySamples(
      identifier,
      quantityQueryArgs(todayRange(), QUANTITY_UNITS[identifier] ?? 'count'),
    );
    return Array.isArray(samples) ? samples : [];
  }

  private async sumQuantityToday(
    identifier: ReadTypeIdentifier,
  ): Promise<number | null> {
    try {
      const samples = await this.quantitySamplesToday(identifier);
      // No samples is not zero — it is "nothing to read", which the caller
      // renders as a dash. A total of 0 ACROSS REAL SAMPLES is a
      // measurement and is returned as 0.
      if (!samples.length) return null;
      const total = samples.reduce(
        (sum: number, s: { quantity?: number }) => sum + (s.quantity ?? 0),
        0,
      );
      return Math.round(total);
    } catch {
      return null;
    }
  }

  getTodayDietaryEnergyKcal(): Promise<number | null> {
    return this.sumQuantityToday('HKQuantityTypeIdentifierDietaryEnergyConsumed');
  }

  getTodaySteps(): Promise<number | null> {
    return this.sumQuantityToday('HKQuantityTypeIdentifierStepCount');
  }

  getTodayActiveEnergyKcal(): Promise<number | null> {
    return this.sumQuantityToday('HKQuantityTypeIdentifierActiveEnergyBurned');
  }

  /** Raw workout proxies for today. Throws on failure. */
  private async workoutsToday(): Promise<unknown[]> {
    const mod = this.getModule();
    if (!mod) throw new Error('module not loaded');
    const workouts = await mod.queryWorkoutSamples(workoutQueryArgs(todayRange()));
    return Array.isArray(workouts) ? workouts : [];
  }

  async getTodayWorkouts(): Promise<HealthWorkout[] | null> {
    const mod = this.getModule();
    if (!mod) return null;
    try {
      const workouts = await this.workoutsToday();
      // The query ran. An empty result is a result.
      if (!workouts.length) return [];
      // The library exports the numeric enum with its reverse mapping; that
      // is how 20 becomes "Functional Strength Training" and never "20".
      const enumTable = (mod.WorkoutActivityType ?? null) as Record<number, unknown> | null;
      return workouts
        .map((raw: unknown) => {
          const w = raw as {
            duration?: unknown;
            workoutActivityType?: unknown;
            startDate?: string | Date;
          };
          return {
            type: activityLabel(w.workoutActivityType, enumTable),
            minutes: Math.round(durationSeconds(w.duration) / 60),
            startISO: w.startDate
              ? new Date(w.startDate).toISOString()
              : new Date().toISOString(),
          };
        })
        .filter((w: HealthWorkout) => w.minutes > 0)
        .sort((a: HealthWorkout, b: HealthWorkout) =>
          a.startISO.localeCompare(b.startISO),
        );
    } catch {
      // The query did NOT run. Never [].
      return null;
    }
  }

  /** The most recent body-mass sample, raw. Throws on failure. */
  private async latestBodyMassSample(): Promise<
    { quantity?: number; endDate?: string | Date } | undefined
  > {
    const mod = this.getModule();
    if (!mod) throw new Error('module not loaded');
    // The library's own helper: limit 1, newest first (Helpers.swift sorts
    // by start date descending when `ascending` is not set).
    return mod.getMostRecentQuantitySample('HKQuantityTypeIdentifierBodyMass', 'kg');
  }

  async getLatestBodyMass(): Promise<BodyMassSample | null> {
    const mod = this.getModule();
    if (!mod) return null;
    try {
      const sample = await this.latestBodyMassSample();
      if (sample?.quantity == null) return null;
      return {
        kg: Math.round(sample.quantity * 10) / 10,
        dateISO: sample.endDate
          ? new Date(sample.endDate).toISOString()
          : new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }

  /**
   * FOR THE DIAGNOSTICS CARD. Runs each read exactly as the card and the
   * prompts would, and reports whether it ran and HOW MANY samples came
   * back. A COUNT, never a value — no kcal, no kg, no step total, no
   * workout name leaves this method. See runHealthDiagnostics.
   */
  async probeReads(): Promise<HealthReadProbe[]> {
    const out: HealthReadProbe[] = [];
    for (const id of READ_TYPES) {
      try {
        let count: number;
        if (id === 'HKWorkoutTypeIdentifier') {
          count = (await this.workoutsToday()).length;
        } else if (id === 'HKQuantityTypeIdentifierBodyMass') {
          count = (await this.latestBodyMassSample()) ? 1 : 0;
        } else {
          count = (await this.quantitySamplesToday(id)).length;
        }
        out.push({ id, status: count > 0 ? 'ok' : 'empty', count });
      } catch (error) {
        out.push({ id, status: 'error', count: null, message: describeRaw(error) });
      }
    }
    return out;
  }
}

/** One row of the diagnostics card: did the query run, and how many rows. */
export interface HealthReadProbe {
  id: ReadTypeIdentifier;
  /** 'empty' = ran, zero rows. iOS does not say whether that is no data or no access. */
  status: 'ok' | 'empty' | 'error' | 'skipped';
  /** Sample COUNT. Never a value. */
  count: number | null;
  message?: string;
}

/** Everything the Health diagnostics card shows. Counts, types, statuses. */
export interface HealthDiagnosticsReport {
  ranAtISO: string;
  env: HealthRuntimeEnv & { gateOpen: boolean };
  simulated: boolean;
  module: { status: 'loaded' | 'load-failed' | 'not-attempted' | 'simulated'; message?: string };
  /** What isHealthDataAvailable() returned; null when it could not be called. */
  available: boolean | null;
  availableError?: string;
  /** A FRESH getRequestStatusForAuthorization answer: raw, typeof, mapped. */
  auth: HealthAuthDiagnostic | null;
  reads: HealthReadProbe[];
}

/**
 * The live answer to "what did this phone do?", for Settings → Developer.
 * Nothing here is logged, persisted or sent: it is returned to the card,
 * held in component state, and gone when the screen is. Counts only.
 */
export async function runHealthDiagnostics(): Promise<HealthDiagnosticsReport> {
  const env = runtimeEnv();
  const gateOpen = canAttemptHealthKit(env);
  const base = { ranAtISO: new Date().toISOString(), env: { ...env, gateOpen } };

  if (simulated) {
    await simulatedService.getAuthRequestStatus();
    return {
      ...base,
      simulated: true,
      module: { status: 'simulated' },
      available: true,
      auth: authDiagnostic,
      reads: READ_TYPES.map((id) => ({ id, status: 'ok', count: 1 })),
    };
  }

  if (!gateOpen) {
    return {
      ...base,
      simulated: false,
      module: { status: 'not-attempted' },
      available: null,
      auth: null,
      reads: READ_TYPES.map((id) => ({ id, status: 'skipped', count: null })),
    };
  }

  const mod = healthKit.getModule();
  const module = healthKit.loadState();
  if (!mod) {
    return {
      ...base,
      simulated: false,
      module,
      available: null,
      auth: null,
      reads: READ_TYPES.map((id) => ({ id, status: 'skipped', count: null })),
    };
  }

  let available: boolean | null = null;
  let availableError: string | undefined;
  try {
    available = !!mod.isHealthDataAvailable?.();
  } catch (error) {
    availableError = describeRaw(error);
  }

  await healthKit.getAuthRequestStatus();
  const auth = authDiagnostic;

  const reads = available
    ? await healthKit.probeReads()
    : READ_TYPES.map((id): HealthReadProbe => ({ id, status: 'skipped', count: null }));

  return { ...base, simulated: false, module, available, availableError, auth, reads };
}

let simulated = false;

/** Dev-menu hook: swap in simulated Health data for QA. */
export function setHealthSimulation(enabled: boolean): void {
  simulated = enabled;
}

export function isHealthSimulated(): boolean {
  return simulated;
}

const healthKit = new HealthKitService();
const nullService = new NullHealthService();
const simulatedService = new SimulatedHealthService();

export function getHealthService(): IHealthService {
  if (simulated) return simulatedService;
  // The gate inside getModule() guarantees the healthkit require is never
  // evaluated in Expo Go / non-iOS; this outer check skips it entirely.
  if (!canAttemptHealthKit(runtimeEnv())) return nullService;
  try {
    if (healthKit.isAvailable()) return healthKit;
  } catch {
    // Any surprise from the health layer degrades to "no health data".
  }
  return nullService;
}
