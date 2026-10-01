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
 *
 * NEVER CONNECTED IS NOT TURNED OFF (Phase 38M). Two inputs, not one:
 *   `asked`    — iOS has shown this phone the permission sheet for our read
 *                types (HKAuthorizationRequestStatus.unnecessary). iOS never
 *                un-asks, so this is a one-way fact about the phone.
 *   `switchOn` — the Settings switch, `healthPrefs.healthEnabled`.
 * Not asked → the Connect prompt, whatever the switch says (a stored `true`
 * from an older build is not a connection). Asked and switched off → NOTHING.
 * The person turned it off on purpose; offering to connect again on every
 * visit to Track is a nag, and the switch is still in Settings for them.
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
  /** Available, and this phone has never been shown the permission sheet. */
  | { kind: 'connect' }
  /** Asked, and the Settings switch is off: a deliberate off, so nothing. */
  | { kind: 'off' }
  /** Asked, switched on, and Apple Health handed back nothing whatsoever. */
  | { kind: 'nothing-returned' }
  /** Asked, switched on, and something came back. Dashes fill in the rest. */
  | { kind: 'readings'; showAccessFootnote: boolean };

export function healthCardState(input: {
  available: boolean;
  /** iOS has shown the sheet for our read types — see healthAsked. */
  asked: boolean;
  /** The Settings switch — healthPrefs.healthEnabled. */
  switchOn: boolean;
  readings: HealthCardReadings;
}): HealthCardState {
  if (!input.available) return { kind: 'hidden' };
  if (!input.asked) return { kind: 'connect' };
  if (!input.switchOn) return { kind: 'off' };

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
