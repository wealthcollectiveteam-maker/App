import Constants from 'expo-constants';
import { isRunningInExpoGo } from 'expo';
import { Platform } from 'react-native';

import {
  CUMULATIVE_SUM,
  DAY_INTERVAL,
  QUANTITY_UNITS,
  READ_TYPES,
  activityLabel,
  authArgs,
  categoryQueryArgs,
  durationSeconds,
  quantityQueryArgs,
  recentDaysRange,
  recentHoursRange,
  statisticsArgs,
  todayRange,
  workoutQueryArgs,
  type DateRange,
  type QuantityReadType,
  type ReadTypeIdentifier,
} from '@/lib/healthKitArgs';
import { dedupeWorkouts, sourceLabel } from '@/lib/healthMerge';
import type { SleepSample } from '@/lib/sleepNight';
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
  /** Which writer recorded it — "Apple Watch", "Oura". */
  source: string;
}

export interface BodyMassSample {
  kg: number;
  dateISO: string;
}

/** A total with the writers that contributed. Statistics queries merge them. */
export interface SummedReading {
  value: number;
  sources: string[];
}

/** One discrete sample — a resting heart rate, an HRV, a respiratory rate. */
export interface DiscreteSample {
  value: number;
  endMs: number;
  source: string;
}

/** The 7-day rows: oldest first, today last. null = no bucket value. */
export type DailyValues = (number | null)[];

/**
 * Read-only Apple Health access. HARD RULES:
 * - Read permissions only; write permission is never requested.
 * - Values are used to render prompts and pre-fill fields on-device only.
 *   They are never written to a backend or AsyncStorage, never logged, and
 *   never shown to other users.
 * - Health is a convenience layer: when unavailable, denied, or revoked,
 *   every method resolves to null/empty and the app behaves normally.
 * - Null means "not read" — and iOS does not say why. [] means "read, and
 *   there was nothing". The two are never interchangeable.
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
  /** Total steps today, sources merged, or null when unknown. */
  getTodaySteps(): Promise<SummedReading | null>;
  /** Active energy burned today (kcal), or null when unknown. */
  getTodayActiveEnergyKcal(): Promise<number | null>;
  /** Dietary water today, in mL, or null when unknown. */
  getTodayWaterMl(): Promise<SummedReading | null>;
  /** Mindful minutes today (sessions summed), or null when unknown. */
  getTodayMindfulMinutes(): Promise<SummedReading | null>;
  /**
   * Today's workouts, chronological, overlapping recordings collapsed to
   * one. `[]` means the query RAN and returned nothing; `null` means it
   * could not run.
   */
  getTodayWorkouts(): Promise<HealthWorkout[] | null>;
  /** Workouts over the last `days` calendar days, same rules. */
  getRecentWorkouts(days: number): Promise<HealthWorkout[] | null>;
  /** Most recent body-mass sample with its date, or null when unknown. */
  getLatestBodyMass(): Promise<BodyMassSample | null>;
  /** Raw sleep-analysis samples over the last `hours`. null = not read. */
  getRecentSleepSamples(hours: number): Promise<SleepSample[] | null>;
  /** Discrete samples of one type over the last `days`. null = not read. */
  getRecentSamples(
    identifier: QuantityReadType,
    days: number,
  ): Promise<DiscreteSample[] | null>;
  /** One value per calendar day for a cumulative type, oldest first. */
  getDailySums(identifier: QuantityReadType, days: number): Promise<DailyValues | null>;
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
  async getTodayWaterMl() {
    return null;
  }
  async getTodayMindfulMinutes() {
    return null;
  }
  async getTodayWorkouts(): Promise<HealthWorkout[] | null> {
    // null, not []. Nothing was queried, so nothing may be reported as
    // "queried and empty" — that is the whole distinction.
    return null;
  }
  async getRecentWorkouts(): Promise<HealthWorkout[] | null> {
    return null;
  }
  async getLatestBodyMass() {
    return null;
  }
  async getRecentSleepSamples() {
    return null;
  }
  async getRecentSamples() {
    return null;
  }
  async getDailySums() {
    return null;
  }
}

/**
 * Dev-menu simulation so the Health-driven UI (card, suggestions, prefill,
 * last night, recovery, 7 days) is QA-able in Expo Go and on web where
 * HealthKit does not exist. Fake numbers, plainly labelled in the dev sheet.
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
  async getTodaySteps(): Promise<SummedReading> {
    return { value: 7412, sources: ['Apple Watch', 'iPhone'] };
  }
  async getTodayActiveEnergyKcal() {
    return 534;
  }
  async getTodayWaterMl(): Promise<SummedReading> {
    return { value: 2750, sources: ['iPhone'] };
  }
  async getTodayMindfulMinutes(): Promise<SummedReading> {
    return { value: 12, sources: ['Apple Watch'] };
  }
  async getTodayWorkouts(): Promise<HealthWorkout[]> {
    const start = new Date();
    start.setHours(18, 12, 0, 0);
    return [
      {
        type: 'Functional Strength Training',
        minutes: 47,
        startISO: start.toISOString(),
        source: 'Apple Watch',
      },
    ];
  }
  async getRecentWorkouts(days: number): Promise<HealthWorkout[]> {
    const out: HealthWorkout[] = [];
    for (let i = 0; i < days; i += 1) {
      if (i % 2 === 1) continue;
      const start = new Date();
      start.setDate(start.getDate() - i);
      start.setHours(18, 12, 0, 0);
      out.push({ type: 'Functional Strength Training', minutes: 47, startISO: start.toISOString(), source: 'Apple Watch' });
    }
    return out.reverse();
  }
  async getLatestBodyMass(): Promise<BodyMassSample> {
    return { kg: 82.5, dateISO: new Date().toISOString() };
  }
  async getRecentSleepSamples(hours: number): Promise<SleepSample[]> {
    // One night per day, 22:40 → 06:10, from both a ring and a watch — so
    // the union rule is exercised on web too.
    const out: SleepSample[] = [];
    const nights = Math.ceil(hours / 24);
    for (let i = 0; i < nights; i += 1) {
      const wake = new Date();
      wake.setDate(wake.getDate() - i);
      wake.setHours(6, 10, 0, 0);
      const bed = new Date(wake.getTime() - (7 * 60 + 30) * 60_000);
      out.push({ startMs: bed.getTime(), endMs: wake.getTime(), value: 1, source: 'Oura' });
      out.push({ startMs: bed.getTime() + 5 * 60_000, endMs: bed.getTime() + 3 * 3_600_000, value: 3, source: 'Apple Watch' });
      out.push({ startMs: bed.getTime() + 3 * 3_600_000, endMs: bed.getTime() + 4.5 * 3_600_000, value: 4, source: 'Apple Watch' });
      out.push({ startMs: bed.getTime() + 4.5 * 3_600_000, endMs: wake.getTime() - 5 * 60_000, value: 5, source: 'Apple Watch' });
    }
    return out;
  }
  async getRecentSamples(identifier: QuantityReadType, days: number): Promise<DiscreteSample[]> {
    const base =
      identifier === 'HKQuantityTypeIdentifierRestingHeartRate'
        ? 54
        : identifier === 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN'
          ? 48
          : 14.5;
    const out: DiscreteSample[] = [];
    for (let i = 0; i < days; i += 1) {
      const at = new Date();
      at.setDate(at.getDate() - i);
      at.setHours(4, 30, 0, 0);
      out.push({ value: base + ((i * 7) % 5) - 2, endMs: at.getTime(), source: 'Apple Watch' });
    }
    return out;
  }
  async getDailySums(identifier: QuantityReadType, days: number): Promise<DailyValues> {
    const base =
      identifier === 'HKQuantityTypeIdentifierStepCount'
        ? 7000
        : identifier === 'HKQuantityTypeIdentifierDietaryWater'
          ? 2500
          : 500;
    return Array.from({ length: days }, (_, i) => base + ((i * 1234) % 2000));
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

/** The writer's name off a sample or a statistics response. */
function sampleSource(raw: unknown): string {
  const rev = (raw as { sourceRevision?: { source?: { name?: unknown } } })?.sourceRevision;
  return sourceLabel(rev?.source?.name);
}

function statisticsSources(raw: unknown): string[] {
  const list = (raw as { sources?: unknown })?.sources;
  if (!Array.isArray(list)) return [];
  const names = new Set<string>();
  for (const s of list) names.add(sourceLabel((s as { name?: unknown })?.name));
  return [...names].sort();
}

function toMs(raw: unknown): number | null {
  if (raw instanceof Date) return raw.getTime();
  if (typeof raw === 'string' || typeof raw === 'number') {
    const ms = new Date(raw).getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

/**
 * Real HealthKit reads via @kingstinct/react-native-healthkit. The module
 * is lazy-required behind a POSITIVE environment gate (see healthEnv.ts) —
 * a throw inside a module factory becomes a fatal error in Metro, so the
 * require must never be evaluated where the native side can't exist.
 * Every method degrades to null/empty on any failure.
 *
 * Every argument handed to the library is built in lib/healthKitArgs.ts,
 * the one place its dialect is spelled and proved against its source.
 *
 * CUMULATIVE TYPES (steps, energy, water) are read with HealthKit's
 * STATISTICS query, not by summing samples: the statistics query merges
 * overlapping sources, so a phone and a watch that both counted a walk
 * count it once. Summing raw samples counted it twice. Workouts are
 * collapsed by lib/healthMerge.ts for the same reason.
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

  private need(): any {
    const mod = this.getModule();
    if (!mod) throw new Error('module not loaded');
    return mod;
  }

  // ---- raw reads: each THROWS on failure; the public methods catch ------

  /** Raw samples for one quantity type over a range. */
  private async quantitySamples(identifier: QuantityReadType, range: DateRange): Promise<unknown[]> {
    const samples = await this.need().queryQuantitySamples(
      identifier,
      quantityQueryArgs(range, QUANTITY_UNITS[identifier]),
    );
    return Array.isArray(samples) ? samples : [];
  }

  /** Raw category samples (sleep, mindful) over a range. */
  private async categorySamples(identifier: ReadTypeIdentifier, range: DateRange): Promise<unknown[]> {
    const samples = await this.need().queryCategorySamples(identifier, categoryQueryArgs(range));
    return Array.isArray(samples) ? samples : [];
  }

  /**
   * HealthKit's own sum over a range, sources merged. Null when there were
   * no samples — a sum over nothing is not zero, it is "nothing to read".
   */
  private async sumOver(identifier: QuantityReadType, range: DateRange): Promise<SummedReading | null> {
    const res = await this.need().queryStatisticsForQuantity(
      identifier,
      [...CUMULATIVE_SUM],
      statisticsArgs(range, QUANTITY_UNITS[identifier]),
    );
    const q = (res as { sumQuantity?: { quantity?: unknown } })?.sumQuantity?.quantity;
    if (typeof q !== 'number' || !Number.isFinite(q)) return null;
    return { value: q, sources: statisticsSources(res) };
  }

  private async workoutsOver(range: DateRange): Promise<unknown[]> {
    const workouts = await this.need().queryWorkoutSamples(workoutQueryArgs(range));
    return Array.isArray(workouts) ? workouts : [];
  }

  private async latestBodyMassSample(): Promise<
    { quantity?: number; endDate?: string | Date } | undefined
  > {
    // The library's own helper: limit 1, newest first (Helpers.swift sorts
    // by start date descending when `ascending` is not set).
    return this.need().getMostRecentQuantitySample('HKQuantityTypeIdentifierBodyMass', 'kg');
  }

  // ---- the public surface -------------------------------------------------

  private async sumToday(identifier: QuantityReadType): Promise<SummedReading | null> {
    try {
      return await this.sumOver(identifier, todayRange());
    } catch {
      return null;
    }
  }

  async getTodayDietaryEnergyKcal(): Promise<number | null> {
    const s = await this.sumToday('HKQuantityTypeIdentifierDietaryEnergyConsumed');
    return s ? Math.round(s.value) : null;
  }

  async getTodaySteps(): Promise<SummedReading | null> {
    const s = await this.sumToday('HKQuantityTypeIdentifierStepCount');
    return s ? { ...s, value: Math.round(s.value) } : null;
  }

  async getTodayActiveEnergyKcal(): Promise<number | null> {
    const s = await this.sumToday('HKQuantityTypeIdentifierActiveEnergyBurned');
    return s ? Math.round(s.value) : null;
  }

  async getTodayWaterMl(): Promise<SummedReading | null> {
    const s = await this.sumToday('HKQuantityTypeIdentifierDietaryWater');
    return s ? { ...s, value: Math.round(s.value) } : null;
  }

  async getTodayMindfulMinutes(): Promise<SummedReading | null> {
    try {
      const samples = await this.categorySamples('HKCategoryTypeIdentifierMindfulSession', todayRange());
      if (!samples.length) return null;
      let ms = 0;
      const sources = new Set<string>();
      for (const s of samples) {
        const start = toMs((s as { startDate?: unknown }).startDate);
        const end = toMs((s as { endDate?: unknown }).endDate);
        if (start != null && end != null && end > start) ms += end - start;
        sources.add(sampleSource(s));
      }
      return { value: Math.round(ms / 60_000), sources: [...sources].sort() };
    } catch {
      return null;
    }
  }

  private mapWorkouts(raw: unknown[]): HealthWorkout[] {
    // The library exports the numeric enum with its reverse mapping; that
    // is how 20 becomes "Functional Strength Training" and never "20".
    const enumTable = (this.mod?.WorkoutActivityType ?? null) as Record<number, unknown> | null;
    const intervals = raw
      .map((r) => {
        const w = r as { duration?: unknown; workoutActivityType?: unknown; startDate?: unknown };
        const seconds = durationSeconds(w.duration);
        const startMs = toMs(w.startDate) ?? Date.now();
        return {
          startMs,
          endMs: startMs + seconds * 1000,
          source: sampleSource(r),
          type: activityLabel(w.workoutActivityType, enumTable),
        };
      })
      .filter((w) => w.endMs > w.startMs);
    // One activity, many writers: overlapping recordings collapse to the
    // longer one (lib/healthMerge.ts).
    return dedupeWorkouts(intervals)
      .map((w) => ({
        type: w.type,
        minutes: Math.round((w.endMs - w.startMs) / 60_000),
        startISO: new Date(w.startMs).toISOString(),
        source: w.source,
      }))
      .filter((w) => w.minutes > 0);
  }

  async getTodayWorkouts(): Promise<HealthWorkout[] | null> {
    try {
      // The query ran. An empty result is a result.
      return this.mapWorkouts(await this.workoutsOver(todayRange()));
    } catch {
      // The query did NOT run. Never [].
      return null;
    }
  }

  async getRecentWorkouts(days: number): Promise<HealthWorkout[] | null> {
    try {
      return this.mapWorkouts(await this.workoutsOver(recentDaysRange(days)));
    } catch {
      return null;
    }
  }

  async getLatestBodyMass(): Promise<BodyMassSample | null> {
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

  async getRecentSleepSamples(hours: number): Promise<SleepSample[] | null> {
    try {
      const raw = await this.categorySamples('HKCategoryTypeIdentifierSleepAnalysis', recentHoursRange(hours));
      const out: SleepSample[] = [];
      for (const s of raw) {
        const r = s as { startDate?: unknown; endDate?: unknown; value?: unknown };
        const startMs = toMs(r.startDate);
        const endMs = toMs(r.endDate);
        if (startMs == null || endMs == null || typeof r.value !== 'number') continue;
        out.push({ startMs, endMs, value: r.value, source: sampleSource(s) });
      }
      return out;
    } catch {
      return null;
    }
  }

  async getRecentSamples(identifier: QuantityReadType, days: number): Promise<DiscreteSample[] | null> {
    try {
      const raw = await this.quantitySamples(identifier, recentDaysRange(days));
      const out: DiscreteSample[] = [];
      for (const s of raw) {
        const r = s as { quantity?: unknown; endDate?: unknown };
        const endMs = toMs(r.endDate);
        if (typeof r.quantity !== 'number' || endMs == null) continue;
        out.push({ value: r.quantity, endMs, source: sampleSource(s) });
      }
      return out;
    } catch {
      return null;
    }
  }

  async getDailySums(identifier: QuantityReadType, days: number): Promise<DailyValues | null> {
    try {
      const range = recentDaysRange(days);
      const buckets = await this.need().queryStatisticsCollectionForQuantity(
        identifier,
        [...CUMULATIVE_SUM],
        range.startDate,
        { ...DAY_INTERVAL },
        statisticsArgs(range, QUANTITY_UNITS[identifier]),
      );
      const out: DailyValues = Array.from({ length: days }, () => null);
      if (!Array.isArray(buckets)) return out;
      for (const b of buckets) {
        const r = b as { startDate?: unknown; sumQuantity?: { quantity?: unknown } };
        const startMs = toMs(r.startDate);
        const q = r.sumQuantity?.quantity;
        if (startMs == null || typeof q !== 'number') continue;
        // Which of the `days` local calendar days this bucket begins on.
        const idx = Math.round((startMs - range.startDate.getTime()) / 86_400_000);
        if (idx >= 0 && idx < days) out[idx] = q;
      }
      return out;
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
          count = (await this.workoutsOver(todayRange())).length;
        } else if (id === 'HKQuantityTypeIdentifierBodyMass') {
          count = (await this.latestBodyMassSample()) ? 1 : 0;
        } else if (id === 'HKCategoryTypeIdentifierSleepAnalysis') {
          count = (await this.categorySamples(id, recentHoursRange(36))).length;
        } else if (id === 'HKCategoryTypeIdentifierMindfulSession') {
          count = (await this.categorySamples(id, todayRange())).length;
        } else if (
          id === 'HKQuantityTypeIdentifierRestingHeartRate' ||
          id === 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN' ||
          id === 'HKQuantityTypeIdentifierRespiratoryRate'
        ) {
          count = (await this.quantitySamples(id, recentDaysRange(7))).length;
        } else {
          count = (await this.quantitySamples(id, todayRange())).length;
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
