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
 *     Every query option struct requires `limit`
 *     (src/types/QueryOptions.ts, `GenericQueryOptions`), so a query without
 *     one never ran, and the service's catch turned that into "null — nothing
 *     to read". Zero or a negative limit means "all samples".
 *   - A date range belongs under `filter.date`, not on the filter
 *     (src/types/QueryOptions.ts, `DateFilter` inside `FilterForSamplesBase`).
 *
 * Every native call in HealthService.ts builds its arguments here, and the
 * test reads the library's own source to assert these shapes — so a future
 * upgrade that changes the dialect fails in words, not on a phone.
 */

/**
 * The five read types, in ONE place. requestAuthorization and
 * getRequestStatusForAuthorization must be asked about the same set, or the
 * status answer describes a different question than the request asked.
 * There is no share (write) list anywhere, and none is ever built from this.
 */
export const READ_TYPES = [
  'HKQuantityTypeIdentifierDietaryEnergyConsumed',
  'HKQuantityTypeIdentifierBodyMass',
  'HKQuantityTypeIdentifierStepCount',
  'HKQuantityTypeIdentifierActiveEnergyBurned',
  'HKWorkoutTypeIdentifier',
] as const;

export type ReadTypeIdentifier = (typeof READ_TYPES)[number];

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

/** Options for queryQuantitySamples(identifier, options). */
export function quantityQueryArgs(range: DateRange, unit: string) {
  return {
    filter: { date: { startDate: range.startDate, endDate: range.endDate } },
    unit,
    // 0 = every sample in the range. A day of step counts is hundreds of
    // rows and the library's own default is the LAST 20 — a sum over that
    // would be a fraction of the day presented as the whole of it.
    limit: 0,
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
