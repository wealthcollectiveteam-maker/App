/**
 * Proofs that the Health service speaks the INSTALLED library's dialect.
 *
 * Phase 38M. The service was written against a remembered shape of
 * @kingstinct/react-native-healthkit and never run on hardware. The installed
 * v14 is a Nitro module: arguments are converted to C++ structs field by
 * field (nitrogen/generated/shared/c++/*.hpp), so a misspelled key is not an
 * error — it is silently `undefined`, and a missing REQUIRED number is a
 * throw from `jsi::Value::asNumber()` that the service's catch turns into
 * "null, nothing to read".
 *
 * The three shapes that matter, each cited to the installed source:
 *
 *   1. AuthDataTypes is `{ toShare?, toRead? }`
 *      (src/specs/CoreModule.nitro.ts:19-22). Passing `{ read, share }`
 *      asks about NOTHING, and the Swift side answers an empty question with
 *      `.unnecessary` (ios/CoreModule.swift:154-158) — "you have been asked"
 *      on a phone that never was.
 *   2. Every query option struct has a REQUIRED `limit: number`
 *      (src/types/QueryOptions.ts GenericQueryOptions; 0 or negative = all).
 *   3. A date range goes in `filter.date.{startDate,endDate}`
 *      (src/types/QueryOptions.ts DateFilter), not on the filter itself.
 *
 * Two kinds of proof below. The first reads the library's own source and
 * asserts the shape — so an upgrade that changes the dialect fails here, in
 * words, instead of on a phone. The second asserts the app's builders emit
 * that shape, and that HealthService.ts routes every native call through
 * them, so there is exactly one place the dialect is spelled.
 *
 *   node --experimental-strip-types scripts/health-calls.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CUMULATIVE_SUM,
  CUMULATIVE_TYPES,
  DAY_INTERVAL,
  QUANTITY_UNITS,
  READ_TYPES,
  activityLabel,
  authArgs,
  categoryQueryArgs,
  durationSeconds,
  quantityQueryArgs,
  recentDaysRange,
  statisticsArgs,
  todayRange,
  workoutQueryArgs,
} from '../src/lib/healthKitArgs.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const lib = path.join(root, 'node_modules', '@kingstinct', 'react-native-healthkit');
const read = (...p) => readFileSync(path.join(...p), 'utf8');

let passes = 0;
function ok(label) {
  passes += 1;
  console.log(`PASS: ${label}`);
}

// ---- 1. what the installed library actually accepts ----------------------
{
  const core = read(lib, 'src', 'specs', 'CoreModule.nitro.ts');
  const authBlock = core.slice(core.indexOf('export interface AuthDataTypes'));
  const authBody = authBlock.slice(0, authBlock.indexOf('}'));
  assert.match(authBody, /toRead\?:/, 'AuthDataTypes.toRead');
  assert.match(authBody, /toShare\?:/, 'AuthDataTypes.toShare');
  assert.doesNotMatch(authBody, /\bread\?:|\bshare\?:/, 'no bare read/share keys');
  ok('installed library: authorization takes { toRead, toShare } (CoreModule.nitro.ts)');

  const swift = read(lib, 'ios', 'CoreModule.swift');
  assert.match(
    swift,
    /toShare\.isEmpty && toRead\.isEmpty[\s\S]{0,200}\.unnecessary/,
    'the empty question is answered "unnecessary"',
  );
  ok('installed library: an EMPTY auth question is answered unnecessary (CoreModule.swift)');

  const opts = read(lib, 'src', 'types', 'QueryOptions.ts');
  assert.match(opts, /interface GenericQueryOptions[\s\S]*?readonly limit: number/);
  assert.match(opts, /interface DateFilter[\s\S]*?startDate\?: Date[\s\S]*?endDate\?: Date/);
  assert.match(opts, /interface FilterForSamplesBase[\s\S]*?readonly date\?: DateFilter/);
  ok('installed library: limit is REQUIRED and dates live under filter.date (QueryOptions.ts)');

  const enumHpp = read(
    lib, 'nitrogen', 'generated', 'shared', 'c++', 'AuthorizationRequestStatus.hpp',
  );
  assert.match(enumHpp, /toJSI[\s\S]*?static_cast<int>\(arg\)[\s\S]*?JSIConverter<int>::toJSI/);
  ok('installed library: the auth status crosses the bridge as a JS number (AuthorizationRequestStatus.hpp)');

  const workouts = read(lib, 'src', 'types', 'Workouts.ts');
  assert.match(workouts, /readonly workoutActivityType: WorkoutActivityType/);
  assert.match(workouts, /readonly duration: Quantity/);
  const generated = read(lib, 'src', 'generated', 'healthkit.generated.ts');
  assert.match(generated, /export enum WorkoutActivityType \{\s*americanFootball = 1/);
  ok('installed library: a workout carries a NUMERIC activity enum and a Quantity duration (Workouts.ts)');
}

// ---- 1b. Phase 38N: the six new types exist in the installed library ------
{
  const generated = read(lib, 'src', 'generated', 'healthkit.generated.ts');
  for (const id of READ_TYPES) {
    if (id === 'HKWorkoutTypeIdentifier') continue;
    assert.ok(generated.includes(`'${id}'`), `${id} is a type the installed library knows`);
  }
  const constants = read(lib, 'src', 'types', 'Constants.ts');
  assert.match(constants, /WorkoutTypeIdentifier = 'HKWorkoutTypeIdentifier'/);
  ok('every one of the 11 read types is an identifier the installed library defines');

  // Sleep stages: the numeric enum sleepNight.ts decodes.
  assert.match(
    generated,
    /export enum CategoryValueSleepAnalysis \{\s*inBed = 0,\s*asleepUnspecified = 1,\s*asleep = 1,\s*awake = 2,\s*asleepCore = 3,\s*asleepDeep = 4,\s*asleepREM = 5,/,
  );
  ok('installed library: sleep analysis values are inBed 0 / asleep 1 / awake 2 / core 3 / deep 4 / REM 5');

  // Category samples take the same options as quantity samples: limit is
  // required (QueryOptionsWithSortOrder extends GenericQueryOptions).
  const cat = read(lib, 'src', 'specs', 'CategoryTypeModule.nitro.ts');
  assert.match(cat, /queryCategorySamples\(\s*identifier: CategoryTypeIdentifier,\s*options: QueryOptionsWithSortOrder,/);
  const catSample = read(lib, 'src', 'types', 'CategoryType.ts');
  assert.match(catSample, /interface CategorySample extends BaseSample[\s\S]*?readonly value: CategoryValueForIdentifier/);
  ok('installed library: category samples are queried with QueryOptionsWithSortOrder and carry a numeric value');

  // Statistics: options are OPTIONAL and carry only filter + unit — no limit.
  const qspec = read(lib, 'src', 'specs', 'QuantityTypeModule.nitro.ts');
  assert.match(qspec, /queryStatisticsForQuantity\(\s*identifier: QuantityTypeIdentifier,\s*statistics: readonly StatisticsOptions\[\],\s*options\?: StatisticsQueryOptionsWithStringUnit,/);
  assert.match(qspec, /queryStatisticsCollectionForQuantity\(\s*identifier: QuantityTypeIdentifier,\s*statistics: readonly StatisticsOptions\[\],\s*anchorDate: Date,\s*intervalComponents: IntervalComponents,\s*options\?: StatisticsQueryOptionsWithStringUnit,/);
  const qtypes = read(lib, 'src', 'types', 'QuantityType.ts');
  const statsOpts = qtypes.slice(qtypes.indexOf('export interface StatisticsQueryOptions<'));
  assert.match(statsOpts.slice(0, statsOpts.indexOf('}')), /filter\?: FilterForSamples\s*unit\?: TUnit/);
  assert.doesNotMatch(statsOpts.slice(0, statsOpts.indexOf('}')), /limit/);
  assert.match(qtypes, /type StatisticsOptions =[\s\S]*?'cumulativeSum'/);
  assert.match(qtypes, /interface QueryStatisticsResponse[\s\S]*?readonly sumQuantity\?: Quantity[\s\S]*?sources: SourceProxy\[\]/);
  assert.match(qtypes, /interface IntervalComponents[\s\S]*?readonly day\?: number/);
  ok('installed library: statistics take optional { filter, unit }, answer sumQuantity + sources, bucket by IntervalComponents');

  // Every sample carries who wrote it.
  const shared = read(lib, 'src', 'types', 'Shared.ts');
  assert.match(shared, /interface BaseObject[\s\S]*?readonly sourceRevision: SourceRevision/);
  const source = read(lib, 'src', 'specs', 'SourceProxy.nitro.ts');
  assert.match(source, /readonly name: string/);
  ok('installed library: every sample names its source (sourceRevision.source.name)');
}

// ---- 2. the app's builders emit that dialect ------------------------------
{
  const args = authArgs();
  assert.deepEqual(Object.keys(args), ['toRead']);
  assert.deepEqual(args.toRead, [...READ_TYPES]);
  assert.equal(READ_TYPES.length, 11, 'eleven read types, never a write type');
  assert.ok(READ_TYPES.every((t) => !/Share|Write/.test(t)));
  for (const t of Object.keys(QUANTITY_UNITS)) assert.ok(READ_TYPES.includes(t), `${t} has a unit and is read`);
  assert.equal(QUANTITY_UNITS.HKQuantityTypeIdentifierDietaryWater, 'mL');
  assert.equal(QUANTITY_UNITS.HKQuantityTypeIdentifierRestingHeartRate, 'count/min');
  assert.equal(QUANTITY_UNITS.HKQuantityTypeIdentifierRespiratoryRate, 'count/min');
  assert.equal(QUANTITY_UNITS.HKQuantityTypeIdentifierHeartRateVariabilitySDNN, 'ms');
  for (const t of CUMULATIVE_TYPES) assert.ok(t in QUANTITY_UNITS);
  assert.ok(!CUMULATIVE_TYPES.includes('HKQuantityTypeIdentifierRestingHeartRate'), 'a heart rate is not summed');
  assert.ok(!('toShare' in args), 'no share list is ever built - read-only');
  ok('authArgs asks about the five read types under toRead, and never builds a share list');
}

{
  const now = new Date(2026, 8, 27, 14, 30, 0);
  const range = todayRange(now);
  assert.equal(range.startDate.getTime(), new Date(2026, 8, 27, 0, 0, 0, 0).getTime());
  assert.equal(range.endDate.getTime(), now.getTime());
  ok('todayRange runs from local midnight to now');

  const q = quantityQueryArgs(range, 'kcal');
  assert.deepEqual(q, {
    filter: { date: { startDate: range.startDate, endDate: range.endDate } },
    unit: 'kcal',
    limit: 0,
    ascending: true,
  });
  assert.equal(typeof q.limit, 'number', 'limit must be a number - undefined throws in asNumber()');
  assert.ok(q.limit <= 0, 'a day of step samples is hundreds of rows; 0 means all of them');
  ok('quantityQueryArgs: filter.date range, unit, and limit 0 (all samples)');

  const w = workoutQueryArgs(range);
  assert.deepEqual(w, {
    filter: { date: { startDate: range.startDate, endDate: range.endDate } },
    limit: 0,
    ascending: true,
  });
  ok('workoutQueryArgs: filter.date range, limit 0, chronological');

  const c = categoryQueryArgs(range);
  assert.deepEqual(c, {
    filter: { date: { startDate: range.startDate, endDate: range.endDate } },
    limit: 0,
    ascending: true,
  });
  ok('categoryQueryArgs: the same required limit, for sleep and mindful sessions');

  const st = statisticsArgs(range, 'count');
  assert.deepEqual(st, { filter: { date: { startDate: range.startDate, endDate: range.endDate } }, unit: 'count' });
  assert.ok(!('limit' in st), 'statistics options have no limit field');
  assert.deepEqual([...CUMULATIVE_SUM], ['cumulativeSum']);
  assert.deepEqual(DAY_INTERVAL, { day: 1 });
  ok('statisticsArgs: filter.date + unit only; cumulativeSum in day buckets');

  const week = recentDaysRange(7, now);
  assert.equal(week.startDate.getTime(), new Date(2026, 8, 21, 0, 0, 0, 0).getTime(), 'today and the six before it');
  assert.equal(week.endDate.getTime(), now.getTime());
  ok('recentDaysRange(7) starts at local midnight six days ago');
}

{
  const table = { 20: 'functionalStrengthTraining', 50: 'traditionalStrengthTraining', 52: 'walking', 3000: 'other' };
  assert.equal(activityLabel(20, table), 'Functional Strength Training');
  assert.equal(activityLabel(52, table), 'Walking');
  assert.equal(activityLabel(3000, table), 'Workout', 'the enum "other" reads as plain Workout');
  assert.equal(activityLabel(9999, table), 'Workout', 'unknown enum value -> Workout, never "9999"');
  assert.equal(activityLabel('functionalStrengthTraining', table), 'Functional Strength Training');
  assert.equal(activityLabel(undefined, table), 'Workout');
  assert.equal(activityLabel(20, null), 'Workout', 'no enum table -> still a label, never a number');
  ok('activityLabel turns the numeric enum into words and never prints a number');

  assert.equal(durationSeconds({ unit: 's', quantity: 2820 }), 2820);
  assert.equal(durationSeconds({ unit: 'min', quantity: 47 }), 2820, 'a minutes quantity is converted');
  assert.equal(durationSeconds(2820), 2820, 'a bare number is seconds');
  assert.equal(durationSeconds(undefined), 0);
  assert.equal(durationSeconds({ quantity: Number.NaN }), 0);
  ok('durationSeconds reads a Quantity or a bare number and never yields NaN');
}

// ---- 3. HealthService.ts speaks through the builders ---------------------
{
  const svc = read(root, 'src', 'services', 'HealthService.ts');
  assert.match(svc, /from '@\/lib\/healthKitArgs'/, 'the service imports the builders');
  assert.match(svc, /getRequestStatusForAuthorization\(\s*authArgs\(\)\s*\)/);
  assert.match(svc, /requestAuthorization\(\s*authArgs\(\)\s*\)/);
  assert.doesNotMatch(svc, /\bread:\s*\[/, 'no { read: [...] } - the library ignores that key');
  assert.doesNotMatch(svc, /\bshare:\s*\[/, 'no { share: [...] } - same');
  ok('HealthService asks about authorization with authArgs(), nothing else');

  assert.match(svc, /queryQuantitySamples\([^)]*quantityQueryArgs\(/);
  assert.match(svc, /queryWorkoutSamples\(\s*workoutQueryArgs\(/);
  assert.match(svc, /queryCategorySamples\([^)]*categoryQueryArgs\(/, 'sleep and mindful go through categoryQueryArgs');
  assert.match(svc, /queryStatisticsForQuantity\([^)]*CUMULATIVE_SUM[^)]*statisticsArgs\(/, 'today’s sums use the statistics query');
  assert.match(svc, /queryStatisticsCollectionForQuantity\([\s\S]*?DAY_INTERVAL[\s\S]*?statisticsArgs\(/, 'the 7-day rows use day buckets');
  assert.doesNotMatch(svc, /\.reduce\([\s\S]{0,120}\.quantity/, 'no summing of raw samples — two sources would count twice');
  assert.doesNotMatch(
    svc,
    /filter:\s*\{\s*startDate/,
    'no filter.startDate - the library reads filter.date.startDate',
  );
  ok('HealthService queries with quantityQueryArgs()/workoutQueryArgs() - limit and filter.date included');

  assert.match(svc, /activityLabel\(/);
  assert.match(svc, /durationSeconds\(/);
  assert.match(svc, /dedupeWorkouts\(/, 'overlapping workouts from two writers collapse to one');
  assert.match(svc, /sourceLabel\(/, 'every reading names its source');
  ok('HealthService labels workouts, collapses overlapping ones, and names sources');
}

console.log(`\nAll ${passes} Health call-shape checks passed.`);
