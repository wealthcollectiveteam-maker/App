/**
 * WHAT THE TODAY'S HEALTH CARD IS ALLOWED TO SAY.
 *
 * Kept free of react-native/expo imports for the same reason healthEnv.ts and
 * prefsStorage.ts are: this rule is worth a proof rather than a code read, and
 * a proof needs to run in plain Node.
 *
 * THE RULE. The card may render a number only if the app actually read it.
 *
 *   A null reading is NOT a zero. It means "we did not read this", and Apple
 *   will not say why. HealthKit reports no authorization status for READ
 *   types — a denied type returns no samples, byte for byte identical to a
 *   type with no data — and that is deliberate, because "this app was denied
 *   heart rate" is itself a health disclosure. There is no API that resolves
 *   it. So the card names the ambiguity instead of guessing at it, and points
 *   at iOS Settings, which is the only place the answer exists.
 *
 *   The same shape reaches the workout list. `[]` means the query RAN and
 *   came back empty. `null` means it could not run. Collapsing the two is how
 *   "No workouts recorded today" gets printed over an absence of permission —
 *   the f39b09b failure, falsy-value-treated-as-data.
 *
 * A MEASURED ZERO IS DIFFERENT and stays visible. Zero active kcal read from
 * real samples is information about the day. Zero standing in for "we were
 * never allowed to look" is a claim, and it is the one this file exists to
 * make impossible.
 */

/** Only the fields the card renders. Every one nullable, all the way down. */
export interface HealthCardReadings {
  dietaryKcal: number | null;
  steps: number | null;
  activeEnergyKcal: number | null;
  /** `[]` = queried, empty. `null` = not queried. Never interchangeable. */
  workouts: unknown[] | null;
  bodyMass: { kg: number } | null;
}

export type HealthCardState =
  /** No HealthKit source here at all — web, Android, Expo Go, simulator. */
  | { kind: 'hidden' }
  /** Available, but this device has not been asked, or the user said no. */
  | { kind: 'connect' }
  /** Asked, and Apple Health handed back nothing whatsoever. */
  | { kind: 'nothing-returned' }
  /** Asked, and something came back. Dashes fill in for what did not. */
  | { kind: 'readings'; showAccessFootnote: boolean };

export function healthCardState(input: {
  available: boolean;
  /** available AND asked AND the switch is on — see selectHealthConnected. */
  connected: boolean;
  readings: HealthCardReadings;
}): HealthCardState {
  if (!input.available) return { kind: 'hidden' };
  if (!input.connected) return { kind: 'connect' };

  const { steps, activeEnergyKcal, bodyMass, dietaryKcal, workouts } =
    input.readings;

  // Did Apple Health hand us ANYTHING? `workouts: []` counts — the query ran
  // and answered. `workouts: null` does not. dietaryKcal counts even though
  // the card has no row for it: it is a successful read, and claiming
  // "returned nothing" over it would be false.
  const readAnything =
    steps != null ||
    activeEnergyKcal != null ||
    bodyMass != null ||
    dietaryKcal != null ||
    workouts != null;

  if (!readAnything) return { kind: 'nothing-returned' };

  // The footnote appears whenever a dash is on screen, because a dash is the
  // ambiguity in miniature and the user deserves the same sentence about it.
  return {
    kind: 'readings',
    showAccessFootnote:
      steps == null ||
      activeEnergyKcal == null ||
      bodyMass == null ||
      workouts == null,
  };
}
