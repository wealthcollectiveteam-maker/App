/**
 * THE ONE PLACE THE HEALTHKIT LIBRARY'S DIALECT IS SPELLED.
 *
 * Free of react-native/expo imports so it can be proved in plain Node
 * (scripts/health-calls.test.mjs), for the same reason healthEnv.ts and
 * healthCardState.ts are.
 *
 * WHY IT EXISTS — Phase 38M. `@kingstinct/react-native-healthkit` v14 is a
 * Nitro module. Its arguments are converted to C++ structs field by field
 * (nitrogen/generated/shared/c++/*.hpp in the installed package), which has
 * two consequences no TypeScript `any` will warn about:
 *
 *   - A misspelled key is not an error. It is `undefined` on the native side.
 *     `requestAuthorization({ read, share })` asked iOS for NOTHING, so no
 *     sheet ever appeared; `getRequestStatusForAuthorization({ read, share })`
 *     asked about nothing, and ios/CoreModule.swift answers an empty question
 *     with `.unnecessary` — "you have already been asked" — on a phone that
 *     never was. The real keys are `toRead` / `toShare`
 *     (src/specs/CoreModule.nitro.ts, `AuthDataTypes`).
 *   - A REQUIRED number left out is a throw from `jsi::Value::asNumber()`.
 *     Every SAMPLE query option struct requires `limit`
 *     (src/types/QueryOptions.ts, `GenericQueryOptions`), so a query without
 *     one never ran, and the service's catch turned that into "null — nothing
 *     to read". Zero or a negative limit means "all samples". STATISTICS
 *     options (src/types/QuantityType.ts, `StatisticsQueryOptions`) have no
 *     limit at all — only `filter` and `unit`, both optional.
 *   - A date range belongs under `filter.date`, not on the filter
 *     (src/types/QueryOptions.ts, `DateFilter` inside `FilterForSamplesBase`).
 *
 * Every native call in HealthService.ts builds its arguments here, and the
 * test reads the library's own source to assert these shapes — so a future
 * upgrade that changes the dialect fails in words, not on a phone.
 *
 * PHASE 38N added six read types. Nothing here is a write, and the sleep,
 * mindful, water, resting-heart-rate, HRV and respiratory-rate identifiers
 * are each checked against src/generated/healthkit.generated.ts by the test.
 */

/**
 * Every type this app reads, in ONE place. requestAuthorization and
 * getRequestStatusForAuthorization must be asked about the same set, or the
 * status answer describes a different question than the request asked.
 * There is no share (write) list anywhere, and none is ever built from this.
 */
export const READ_TYPES = [
  // Phase 9 — the Today's Health card, the diet and workout prompts, the
  // weekly check-in pre-fill.
  'HKQuantityTypeIdentifierDietaryEnergyConsumed',
  'HKQuantityTypeIdentifierBodyMass',
  'HKQuantityTypeIdentifierStepCount',
  'HKQuantityTypeIdentifierActiveEnergyBurned',
  'HKWorkoutTypeIdentifier',
  // Phase 38N — last night, water and mindful tasks, recovery.
  'HKCategoryTypeIdentifierSleepAnalysis',
  'HKQuantityTypeIdentifierDietaryWater',
  'HKCategoryTypeIdentifierMindfulSession',
  'HKQuantityTypeIdentifierRestingHeartRate',
  'HKQuantityTypeIdentifierHeartRateVariabilitySDNN',
  'HKQuantityTypeIdentifierRespiratoryRate',
] as const;

export type ReadTypeIdentifier = (typeof READ_TYPES)[number];

export type QuantityReadType = Extract<ReadTypeIdentifier, `HKQuantityTypeIdentifier${string}`>;
export type CategoryReadType = Extract<ReadTypeIdentifier, `HKCategoryTypeIdentifier${string}`>;

/**
 * The unit each quantity is read in. HKUnit strings, passed as the query's
 * `unit` override so the answer never depends on the phone's preferred unit.
 */
export const QUANTITY_UNITS: Record<QuantityReadType, string> = {
  HKQuantityTypeIdentifierDietaryEnergyConsumed: 'kcal',
  HKQuantityTypeIdentifierBodyMass: 'kg',
  HKQuantityTypeIdentifierStepCount: 'count',
  HKQuantityTypeIdentifierActiveEnergyBurned: 'kcal',
  HKQuantityTypeIdentifierDietaryWater: 'mL',
  HKQuantityTypeIdentifierRestingHeartRate: 'count/min',
  HKQuantityTypeIdentifierHeartRateVariabilitySDNN: 'ms',
  HKQuantityTypeIdentifierRespiratoryRate: 'count/min',
};

/**
 * Cumulative quantities are SUMMED by HealthKit's statistics query, which
 * merges overlapping sources — a phone and a watch that both counted the
 * same steps count them once. Summing raw samples would count them twice.
 */
export const CUMULATIVE_TYPES: readonly QuantityReadType[] = [
  'HKQuantityTypeIdentifierDietaryEnergyConsumed',
  'HKQuantityTypeIdentifierStepCount',
  'HKQuantityTypeIdentifierActiveEnergyBurned',
  'HKQuantityTypeIdentifierDietaryWater',
];

/** Arguments for requestAuthorization AND getRequestStatusForAuthorization. */
export function authArgs(): { toRead: ReadTypeIdentifier[] } {
  // READ ONLY. No `toShare` key at all — not even an empty list — so the
  // shape of the request itself says no write permission is ever asked for.
  return { toRead: [...READ_TYPES] };
}

export interface DateRange {
  startDate: Date;
  endDate: Date;
}

/** Local midnight to `now`. "Today" as the phone's clock sees it. */
export function todayRange(now: Date = new Date()): DateRange {
  const startDate = new Date(now);
  startDate.setHours(0, 0, 0, 0);
  return { startDate, endDate: now };
}

/**
 * The last `days` calendar days including today, local midnight to now.
 * `days` = 7 is today and the six before it.
 */
export function recentDaysRange(days: number, now: Date = new Date()): DateRange {
  const startDate = new Date(now);
  startDate.setHours(0, 0, 0, 0);
  startDate.setDate(startDate.getDate() - (days - 1));
  return { startDate, endDate: now };
}

/** `hours` back from now to now. For "the samples that could be last night". */
export function recentHoursRange(hours: number, now: Date = new Date()): DateRange {
  return { startDate: new Date(now.getTime() - hours * 3_600_000), endDate: now };
}

/** Options for queryQuantitySamples(identifier, options). */
export function quantityQueryArgs(range: DateRange, unit: string) {
  return {
    filter: { date: { startDate: range.startDate, endDate: range.endDate } },
    unit,
    // 0 = every sample in the range. A day of step counts is hundreds of
    // rows and the library's own default is the LAST 20 — a sum over that
    // would be a fraction of the day presented as the whole of it.
    limit: 0,
    ascending: true,
  };
}

/** Options for queryCategorySamples(identifier, options) — sleep, mindful. */
export function categoryQueryArgs(range: DateRange) {
  return {
    filter: { date: { startDate: range.startDate, endDate: range.endDate } },
    limit: 0,
    ascending: true,
  };
}

/** Options for queryWorkoutSamples(options). */
export function workoutQueryArgs(range: DateRange) {
  return {
    filter: { date: { startDate: range.startDate, endDate: range.endDate } },
    limit: 0,
    // Chronological, so "the first workout that qualifies" means the
    // earliest one and a suggestion reads in the order the day happened.
    ascending: true,
  };
}

/**
 * Options for queryStatisticsForQuantity / queryStatisticsCollectionForQuantity.
 * No limit here — StatisticsQueryOptions does not have one.
 */
export function statisticsArgs(range: DateRange, unit: string) {
  return {
    filter: { date: { startDate: range.startDate, endDate: range.endDate } },
    unit,
  };
}

/** The statistics asked for on a cumulative type. */
export const CUMULATIVE_SUM = ['cumulativeSum'] as const;

/** One bucket per calendar day, for the 7-day rows. */
export const DAY_INTERVAL = { day: 1 } as const;

/**
 * A workout's activity type arrives as the NUMERIC `WorkoutActivityType`
 * enum (src/types/Workouts.ts → src/generated/healthkit.generated.ts,
 * `functionalStrengthTraining = 20`, `other = 3000`). The library exports the
 * enum object, which as a TypeScript numeric enum carries the reverse
 * mapping (`table[20] === 'functionalStrengthTraining'`); that is passed in
 * so this stays pure. Anything unrecognised — and `other` — reads as
 * "Workout". A number is never printed.
 */
export function activityLabel(
  raw: unknown,
  enumTable: Record<number | string, unknown> | null | undefined,
): string {
  let name: string | null = null;
  if (typeof raw === 'string' && raw.length > 0 && !/^\d+$/.test(raw)) {
    name = raw;
  } else if (typeof raw === 'number' && enumTable) {
    const looked = enumTable[raw];
    if (typeof looked === 'string') name = looked;
  }
  if (!name || name === 'other') return 'Workout';
  const spaced = name
    .replace(/^HKWorkoutActivityType/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * A workout's duration is a `Quantity` — `{ unit, quantity }`, in seconds as
 * the Swift side builds it (ios/WorkoutProxy.swift, `HKUnit.second()`). A
 * bare number is tolerated as seconds. Never NaN.
 */
export function durationSeconds(raw: unknown): number {
  let seconds = 0;
  if (typeof raw === 'number') {
    seconds = raw;
  } else if (raw && typeof raw === 'object') {
    const q = (raw as { quantity?: unknown; unit?: unknown }).quantity;
    const unit = (raw as { unit?: unknown }).unit;
    if (typeof q === 'number') {
      seconds = unit === 'min' ? q * 60 : unit === 'hr' ? q * 3600 : q;
    }
  }
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}
