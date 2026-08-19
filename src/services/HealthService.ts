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

/**
 * Read-only Apple Health access. HARD RULES:
 * - Read permissions only; write permission is never requested.
 * - Values are used to render prompts and pre-fill fields on-device only.
 *   They are never written to a backend, included in sync payloads, or
 *   logged anywhere.
 * - Health is a convenience layer: when unavailable, denied, or revoked,
 *   every method resolves to null and the app behaves normally.
 */
export interface IHealthService {
  /** True when a HealthKit source can be queried on this device. */
  isAvailable(): boolean;
  requestReadPermissions(): Promise<boolean>;
  /** Total dietary energy (kcal) logged today, or null when unknown. */
  getTodayDietaryEnergyKcal(): Promise<number | null>;
  /** Most recent body mass in kg, or null when unknown. */
  getLatestBodyMassKg(): Promise<number | null>;
  /** Longest workout today in minutes, or null when unknown. */
  getTodayLongestWorkoutMinutes(): Promise<number | null>;
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
  async getLatestBodyMassKg() {
    return null;
  }
  async getTodayLongestWorkoutMinutes() {
    return null;
  }
}

/**
 * Dev-menu simulation so the Health-driven UI (prompts, prefill) is
 * QA-able in Expo Go and on web where HealthKit does not exist.
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
  async getLatestBodyMassKg() {
    return 82.5;
  }
  async getTodayLongestWorkoutMinutes() {
    return 47;
  }
}

/**
 * Real HealthKit reads via @kingstinct/react-native-healthkit. The module
 * is lazy-required so bundles without the native module (web, Expo Go)
 * never touch it. Every method degrades to null on any failure.
 */
class HealthKitService implements IHealthService {
  private mod: any | null = null;
  private loadFailed = false;

  private getModule(): any | null {
    // POSITIVE gate first: the require must never be evaluated in Expo Go.
    // @kingstinct/react-native-healthkit creates NitroModules hybrid objects
    // at module top level, and a throw inside a module factory is converted
    // to a FATAL error by Metro's guardedLoadModule — a try/catch here
    // cannot contain it. The catch below is only a backstop for exotic
    // environments the gate misjudges.
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

  async getTodayDietaryEnergyKcal(): Promise<number | null> {
    const mod = this.getModule();
    if (!mod) return null;
    try {
      const samples = await mod.queryQuantitySamples(
        'HKQuantityTypeIdentifierDietaryEnergyConsumed',
        { filter: { startDate: this.startOfToday(), endDate: new Date() }, unit: 'kcal' },
      );
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

  async getLatestBodyMassKg(): Promise<number | null> {
    const mod = this.getModule();
    if (!mod) return null;
    try {
      const sample = await mod.getMostRecentQuantitySample(
        'HKQuantityTypeIdentifierBodyMass',
        'kg',
      );
      return sample?.quantity != null
        ? Math.round(sample.quantity * 10) / 10
        : null;
    } catch {
      return null;
    }
  }

  async getTodayLongestWorkoutMinutes(): Promise<number | null> {
    const mod = this.getModule();
    if (!mod) return null;
    try {
      const workouts = await mod.queryWorkoutSamples({
        filter: { startDate: this.startOfToday(), endDate: new Date() },
      });
      if (!workouts?.length) return null;
      const longest = Math.max(
        ...workouts.map(
          (w: { duration?: { quantity?: number } | number }) =>
            typeof w.duration === 'number'
              ? w.duration
              : (w.duration?.quantity ?? 0),
        ),
      );
      return longest > 0 ? Math.round(longest / 60) : null;
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
