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
