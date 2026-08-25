/**
 * The ONLY module allowed to convert units. kg and cm are canonical storage
 * units everywhere — the database, AsyncStorage, and every API speak metric.
 * Pounds and feet/inches exist purely at the display/input boundary:
 * convert once on the way in (full precision), format on the way out.
 * No inline `* 2.20462` anywhere else in the codebase.
 *
 * Kept free of react-native imports so it is unit-testable in plain Node.
 */

export type UnitPreference = 'metric' | 'imperial';

/** Exact international avoirdupois pound. */
const KG_PER_LB = 0.45359237;
const CM_PER_IN = 2.54;

export function kgToLb(kg: number): number {
  return kg / KG_PER_LB;
}

export function lbToKg(lb: number): number {
  return lb * KG_PER_LB;
}

export function cmToFtIn(cm: number): { ft: number; inches: number } {
  const totalInches = cm / CM_PER_IN;
  let ft = Math.floor(totalInches / 12);
  let inches = Math.round(totalInches - ft * 12);
  if (inches === 12) {
    ft += 1;
    inches = 0;
  }
  return { ft, inches };
}

export function ftInToCm(ft: number, inches: number): number {
  return (ft * 12 + inches) * CM_PER_IN;
}

/** One decimal place, no trailing-zero stripping ("184.5", "180.0"). */
function fixed1(n: number): string {
  return n.toFixed(1);
}

/**
 * Display formatting happens HERE and only here — storage always holds the
 * full-precision kg value, so 180.0 lb round-trips to "180.0 lb", not 179.9.
 */
export function formatWeight(kg: number, pref: UnitPreference): string {
  return pref === 'imperial' ? `${fixed1(kgToLb(kg))} lb` : `${fixed1(kg)} kg`;
}

export function formatHeight(cm: number, pref: UnitPreference): string {
  if (pref === 'imperial') {
    const { ft, inches } = cmToFtIn(cm);
    return `${ft}'${inches}"`;
  }
  return `${Math.round(cm)} cm`;
}

/** Parse a typed weight in the user's preferred unit → canonical kg. */
export function parseWeightToKg(
  input: string,
  pref: UnitPreference,
): number | null {
  const value = parseFloat(input.replace(',', '.'));
  if (!Number.isFinite(value) || value <= 0) return null;
  return pref === 'imperial' ? lbToKg(value) : value;
}

export const weightUnitLabel = (pref: UnitPreference) =>
  pref === 'imperial' ? 'lb' : 'kg';

/** Numeric part only, for pre-filling input fields ("184.5"). */
export function formatWeightValue(kg: number, pref: UnitPreference): string {
  return fixed1(pref === 'imperial' ? kgToLb(kg) : kg);
}

/**
 * PLAUSIBILITY GUARD for a typed weight.
 *
 * A user typed 203 meaning pounds while the field was reading kilograms. It
 * was accepted in silence and stored as 203 kg — 447 lb — and their metrics
 * history has been wrong ever since. A range check alone would NOT have
 * caught it: 203 kg is inside any sane adult range. What gives it away is
 * that the OTHER reading of the same number is ordinary and this one is not.
 *
 * So there are two checks, and they catch different things:
 *
 *   'implausible' — no adult weighs this, in either unit. Refuse.
 *   'ambiguous'   — this reading is extreme AND the other unit's reading is
 *                   ordinary. Almost certainly the wrong unit. Ask.
 *
 * Pure, and unit-tested in scripts/units.test.mjs.
 */

/** Nobody is outside this, in any unit. 66 lb – 660 lb. */
export const MIN_PLAUSIBLE_KG = 30;
export const MAX_PLAUSIBLE_KG = 300;

/**
 * The band where a kg reading stops being ordinary. Above 150 kg (331 lb)
 * fewer than one adult in a thousand qualifies, while 150 *pounds* is the
 * single most ordinary weight there is — so a number in that band is far
 * likelier to be pounds typed into a kilograms field.
 */
const ORDINARY_MAX_KG = 150;
const ORDINARY_MIN_KG = 40;

export type WeightVerdict =
  | { kind: 'ok'; kg: number }
  | { kind: 'empty' }
  | { kind: 'implausible'; kg: number }
  /** `kg` is what was typed; `meantKg` is the other unit's reading. */
  | { kind: 'ambiguous'; kg: number; meantKg: number; meantUnit: UnitPreference };

export function checkWeightEntry(
  input: string,
  pref: UnitPreference,
): WeightVerdict {
  const kg = parseWeightToKg(input, pref);
  if (kg == null) return { kind: 'empty' };
  if (kg < MIN_PLAUSIBLE_KG || kg > MAX_PLAUSIBLE_KG) {
    return { kind: 'implausible', kg };
  }
  // The same digits read as the other unit.
  const typed = parseFloat(input.replace(',', '.'));
  const other: UnitPreference = pref === 'metric' ? 'imperial' : 'metric';
  const otherKg = other === 'imperial' ? lbToKg(typed) : typed;
  const ordinary = (v: number) => v >= ORDINARY_MIN_KG && v <= ORDINARY_MAX_KG;
  if (!ordinary(kg) && ordinary(otherKg)) {
    return { kind: 'ambiguous', kg, meantKg: otherKg, meantUnit: other };
  }
  return { kind: 'ok', kg };
}
