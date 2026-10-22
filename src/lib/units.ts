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

/**
 * WHY THIS IS NOT parseFloat.
 *
 * parseFloat is a prefix parser: it reads as far as it understands and throws
 * the rest away without telling anyone. parseFloat('9.2.3') is 9.2.
 * parseFloat('92kg') is 92. parseFloat('92.') is 92. Every one of those is a
 * typo the user would want to know about, and every one of them was silently
 * accepted and stored as a weight they never typed.
 *
 * So the input is CLASSIFIED rather than coerced, and each way of being wrong
 * gets its own answer the UI can say out loud.
 */
export type WeightInputProblem =
  /** Letters, symbols, a lone separator — nothing numeric to read. */
  | 'not-a-number'
  /** '9.2.3'. Two decimal points is a typo, not a number. */
  | 'two-points'
  /** '1,234.5'. Comma AND point: which one is the decimal? Refuse to guess. */
  | 'mixed-separators'
  /** '92.' — a decimal point with nothing after it. */
  | 'trailing-point'
  /** '92.15'. Finer than the field accepts; rounding it silently is a lie. */
  | 'too-precise';

export type WeightInput =
  | { kind: 'blank' }
  /** The number as typed, in the DISPLAY unit. Never converted here. */
  | { kind: 'value'; value: number }
  | { kind: 'malformed'; problem: WeightInputProblem };

/** How many decimal places the field accepts, in whichever unit is showing. */
export const WEIGHT_DECIMALS = 1;

/**
 * LOCALE: a comma IS accepted as a decimal separator.
 *
 * Half the world's keyboards produce one, and a German user typing 92,1 means
 * 92.1 and nothing else. Refusing would be correct and useless. What is NOT
 * accepted is a string carrying both a comma and a point ('1,234.5'), because
 * there the comma might be a thousands separator and guessing wrong moves the
 * decimal point — the single worst thing this parser could do.
 */
export function parseWeightInput(input: string): WeightInput {
  const raw = input.trim();
  if (raw === '') return { kind: 'blank' };

  const hasComma = raw.includes(',');
  const hasPoint = raw.includes('.');
  if (hasComma && hasPoint) {
    return { kind: 'malformed', problem: 'mixed-separators' };
  }
  const text = hasComma ? raw.replace(/,/g, '.') : raw;

  if ((text.match(/\./g) ?? []).length > 1) {
    return { kind: 'malformed', problem: 'two-points' };
  }
  if (/^\d+\.$/.test(text)) {
    return { kind: 'malformed', problem: 'trailing-point' };
  }
  if (!/^\d+(\.\d+)?$/.test(text)) {
    return { kind: 'malformed', problem: 'not-a-number' };
  }
  const decimals = text.includes('.') ? text.split('.')[1].length : 0;
  if (decimals > WEIGHT_DECIMALS) {
    return { kind: 'malformed', problem: 'too-precise' };
  }

  const value = Number(text);
  // A whole number is a whole number: '92' is as valid as '92.0' and nobody
  // is made to type the '.0'.
  if (!Number.isFinite(value) || value <= 0) {
    return { kind: 'malformed', problem: 'not-a-number' };
  }
  return { kind: 'value', value };
}

/**
 * Parse a typed weight in the user's preferred unit → canonical kg.
 *
 * Returns null for blank AND for malformed, which is why every caller that
 * needs to tell the user WHICH goes through checkWeightEntry() instead. Kept
 * for the callers that only need the number.
 */
export function parseWeightToKg(
  input: string,
  pref: UnitPreference,
): number | null {
  const parsed = parseWeightInput(input);
  if (parsed.kind !== 'value') return null;
  return pref === 'imperial' ? lbToKg(parsed.value) : parsed.value;
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
  /** The field is empty. A mood-only check-in, which has always been allowed. */
  | { kind: 'empty' }
  /** Something was typed and it is not a weight. `problem` says which way. */
  | { kind: 'malformed'; problem: WeightInputProblem }
  | { kind: 'implausible'; kg: number }
  /** `kg` is what was typed; `meantKg` is the other unit's reading. */
  | { kind: 'ambiguous'; kg: number; meantKg: number; meantUnit: UnitPreference };

export function checkWeightEntry(
  input: string,
  pref: UnitPreference,
): WeightVerdict {
  const parsed = parseWeightInput(input);
  if (parsed.kind === 'blank') return { kind: 'empty' };
  if (parsed.kind === 'malformed') {
    return { kind: 'malformed', problem: parsed.problem };
  }
  // The number as typed, in the display unit — and the ONE conversion.
  const typed = parsed.value;
  const kg = pref === 'imperial' ? lbToKg(typed) : typed;
  if (kg < MIN_PLAUSIBLE_KG || kg > MAX_PLAUSIBLE_KG) {
    return { kind: 'implausible', kg };
  }
  // The same digits read as the other unit. Decimals go through here exactly
  // as whole numbers do — 203.4 typed into a kilograms field is as much a
  // pounds-shaped number as 203 is.
  const other: UnitPreference = pref === 'metric' ? 'imperial' : 'metric';
  const otherKg = other === 'imperial' ? lbToKg(typed) : typed;
  const ordinary = (v: number) => v >= ORDINARY_MIN_KG && v <= ORDINARY_MAX_KG;
  if (!ordinary(kg) && ordinary(otherKg)) {
    return { kind: 'ambiguous', kg, meantKg: otherKg, meantUnit: other };
  }
  return { kind: 'ok', kg };
}

/** What to tell the user, per way of being wrong. One place, so the UI cannot
 *  invent its own wording for a case it forgot about. */
export function weightProblemMessage(
  problem: WeightInputProblem,
  pref: UnitPreference,
): string {
  const unit = weightUnitLabel(pref);
  switch (problem) {
    case 'two-points':
      return 'That has two decimal points.';
    case 'mixed-separators':
      return 'Use one decimal separator — a comma or a point, not both.';
    case 'trailing-point':
      return `Finish the decimal — 82.0 ${unit}, not 82.`;
    case 'too-precise':
      return `One decimal place — 82.4 ${unit}.`;
    case 'not-a-number':
      return 'That is not a weight.';
  }
}
