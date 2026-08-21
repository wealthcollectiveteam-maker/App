import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { canAttemptHealthKit, type HealthRuntimeEnv } from '@/services/healthEnv';

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
  requestReadPermissions(): Promise<boolean>;
  /** Total dietary energy (kcal) logged today, or null when unknown. */
  getTodayDietaryEnergyKcal(): Promise<number | null>;
  /** Total steps today, or null when unknown. */
  getTodaySteps(): Promise<number | null>;
  /** Active energy burned today (kcal), or null when unknown. */
  getTodayActiveEnergyKcal(): Promise<number | null>;
  /** Today's workouts, chronological. Empty when none or unknown. */
  getTodayWorkouts(): Promise<HealthWorkout[]>;
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
  async getTodayDietaryEnergyKcal() {
    return null;
  }
  async getTodaySteps() {
    return null;
  }
  async getTodayActiveEnergyKcal() {
    return null;
  }
  async getTodayWorkouts() {
    return [];
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
      await mod.requestAuthorization({
        read: [
          'HKQuantityTypeIdentifierDietaryEnergyConsumed',
          'HKQuantityTypeIdentifierBodyMass',
          'HKQuantityTypeIdentifierStepCount',
          'HKQuantityTypeIdentifierActiveEnergyBurned',
          'HKWorkoutTypeIdentifier',
        ],
        share: [],
      });
      return true;
    } catch {
      return false;
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
      if (!samples?.length) return null;
      const total = samples.reduce(
        (sum: number, s: { quantity?: number }) => sum + (s.quantity ?? 0),
        0,
      );
      return total > 0 ? Math.round(total) : null;
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

  async getTodayWorkouts(): Promise<HealthWorkout[]> {
    const mod = this.getModule();
    if (!mod) return [];
    try {
      const workouts = await mod.queryWorkoutSamples({
        filter: { startDate: this.startOfToday(), endDate: new Date() },
      });
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
      return [];
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
