import Constants from 'expo-constants';
import { Platform } from 'react-native';

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

/** Live runtime signals for the HealthKit gate (see healthEnv.ts). */
function runtimeEnv(): HealthRuntimeEnv {
  return {
    platformOS: Platform.OS,
    appOwnership: (Constants.appOwnership as string | null) ?? null,
    hasExpoGoConfig: Constants.expoGoConfig != null,
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
 * `getRequestStatusForAuthorization` is a Nitro native call. The JS enum is
 * numeric at runtime (unknown 0, shouldRequest 1, unnecessary 2), but nothing
 * short of a device proves the native side marshals it as a number. If it
 * arrives as anything else the app falls to 'unknown', the card reads
 * "Not connected" for ever even after access is granted, and that symptom is
 * indistinguishable from a denied permission — an hour spent on the wrong
 * theory. So the raw value and its typeof are recorded here on the first call
 * of each launch and surfaced in the dev sheet.
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
    if (typeof value === 'object' && value !== null) return JSON.stringify(value);
    return String(value);
  } catch {
    return '(unstringifiable)';
  }
}

/**
 * The five read types, in ONE place. requestAuthorization and
 * getRequestStatusForAuthorization must be asked about the same set, or the
 * status answer describes a different question than the request asked.
 * The share (write) list is empty everywhere and is never built from this.
 */
const READ_TYPES = [
  'HKQuantityTypeIdentifierDietaryEnergyConsumed',
  'HKQuantityTypeIdentifierBodyMass',
  'HKQuantityTypeIdentifierStepCount',
  'HKQuantityTypeIdentifierActiveEnergyBurned',
  'HKWorkoutTypeIdentifier',
] as const;

/** Best-effort humanization of HealthKit workout activity types. */
function humanizeActivityType(raw: unknown): string {
  if (typeof raw === 'string' && raw.length > 0) {
    // e.g. "functionalStrengthTraining" -> "Functional Strength Training"
    const spaced = raw
      .replace(/^HKWorkoutActivityType/, '')
      .replace(/([a-z])([A-Z])/g, '$1 $2');
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
  }
  return 'Workout';
}

/**
 * Real HealthKit reads via @kingstinct/react-native-healthkit. The module
 * is lazy-required behind a POSITIVE environment gate (see healthEnv.ts) —
 * a throw inside a module factory becomes a fatal error in Metro, so the
 * require must never be evaluated where the native side can't exist.
 * Every method degrades to null/empty on any failure.
 */
class HealthKitService implements IHealthService {
  private mod: any | null = null;
  private loadFailed = false;

  private getModule(): any | null {
    if (this.loadFailed || !canAttemptHealthKit(runtimeEnv())) return null;
    if (!this.mod) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        this.mod = require('@kingstinct/react-native-healthkit');
      } catch {
        this.loadFailed = true;
        return null;
      }
    }
    return this.mod;
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
      // READ ONLY — the share (write) list is empty by design.
      await mod.requestAuthorization({ read: [...READ_TYPES], share: [] });
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
   * Any failure resolves 'unknown', which callers read as 'not-requested'.
   */
  async getAuthRequestStatus(): Promise<HealthAuthRequestStatus> {
    const mod = this.getModule();
    if (!mod) return 'unavailable';
    try {
      const status = await mod.getRequestStatusForAuthorization({
        read: [...READ_TYPES],
        share: [],
      });
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

  private startOfToday(): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private async sumQuantityToday(
    identifier: string,
    unit: string,
  ): Promise<number | null> {
    const mod = this.getModule();
    if (!mod) return null;
    try {
      const samples = await mod.queryQuantitySamples(identifier, {
        filter: { startDate: this.startOfToday(), endDate: new Date() },
        unit,
      });
      // No samples is not zero — it is "nothing to read", which the caller
      // renders as a dash. A total of 0 ACROSS REAL SAMPLES is a
      // measurement and is returned as 0.
      if (!samples?.length) return null;
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
    return this.sumQuantityToday(
      'HKQuantityTypeIdentifierDietaryEnergyConsumed',
      'kcal',
    );
  }

  getTodaySteps(): Promise<number | null> {
    return this.sumQuantityToday('HKQuantityTypeIdentifierStepCount', 'count');
  }

  getTodayActiveEnergyKcal(): Promise<number | null> {
    return this.sumQuantityToday(
      'HKQuantityTypeIdentifierActiveEnergyBurned',
      'kcal',
    );
  }

  async getTodayWorkouts(): Promise<HealthWorkout[] | null> {
    const mod = this.getModule();
    if (!mod) return null;
    try {
      const workouts = await mod.queryWorkoutSamples({
        filter: { startDate: this.startOfToday(), endDate: new Date() },
      });
      // The query ran. An empty result is a result.
      if (!workouts?.length) return [];
      return workouts
        .map(
          (w: {
            duration?: { quantity?: number } | number;
            workoutActivityType?: unknown;
            startDate?: string | Date;
          }) => {
            const seconds =
              typeof w.duration === 'number'
                ? w.duration
                : (w.duration?.quantity ?? 0);
            return {
              type: humanizeActivityType(w.workoutActivityType),
              minutes: Math.round(seconds / 60),
              startISO: w.startDate
                ? new Date(w.startDate).toISOString()
                : new Date().toISOString(),
            };
          },
        )
        .filter((w: HealthWorkout) => w.minutes > 0)
        .sort((a: HealthWorkout, b: HealthWorkout) =>
          a.startISO.localeCompare(b.startISO),
        );
    } catch {
      // The query did NOT run. Never [].
      return null;
    }
  }

  async getLatestBodyMass(): Promise<BodyMassSample | null> {
    const mod = this.getModule();
    if (!mod) return null;
    try {
      const sample = await mod.getMostRecentQuantitySample(
        'HKQuantityTypeIdentifierBodyMass',
        'kg',
      );
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
