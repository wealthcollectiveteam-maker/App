// Round-trip guard for lib/units.ts (Phase 9 Part 1).
// The critical property: convert ONCE on the way in at full precision, round
// only at the formatter — so what the user typed is byte-identical on read.
// Run: npm run test:units
import {
  checkWeightEntry,
  cmToFtIn,
  formatHeight,
  formatWeight,
  ftInToCm,
  kgToLb,
  formatWeightValue,
  lbToKg,
  parseWeightToKg,
} from '../src/lib/units.ts';

let failures = 0;
function expect(name, actual, expected) {
  const ok = actual === expected;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
  if (!ok) failures++;
}

// The spec's exact case: type 180.0 lb → store full precision → display 180.0 lb.
const kg180 = parseWeightToKg('180.0', 'imperial');
expect('180.0 lb stores full-precision kg (81.6466...)', Math.abs(kg180 - 81.6466266) < 1e-6, true);
expect('180.0 lb reads back byte-identical', formatWeight(kg180, 'imperial'), '180.0 lb');

// The definition-of-done case: 184.5 lb ⇄ 83.7 kg ⇄ 184.5 lb.
const kg1845 = parseWeightToKg('184.5', 'imperial');
expect('184.5 lb reads back byte-identical', formatWeight(kg1845, 'imperial'), '184.5 lb');
expect('same entry in metric reads 83.7 kg', formatWeight(kg1845, 'metric'), '83.7 kg');
expect('switching back is 184.5, not 184.4', formatWeight(kg1845, 'imperial'), '184.5 lb');

// Every 0.1-lb entry from 80.0 to 400.0 must round-trip byte-identically.
let allRoundTrip = true;
for (let tenths = 800; tenths <= 4000; tenths++) {
  const typed = (tenths / 10).toFixed(1);
  const kg = parseWeightToKg(typed, 'imperial');
  if (formatWeight(kg, 'imperial') !== `${typed} lb`) {
    allRoundTrip = false;
    console.log(`       broke at ${typed} lb`);
    break;
  }
}
expect('every 0.1-lb entry 80.0–400.0 round-trips', allRoundTrip, true);

// Metric entries are stored as typed.
expect('metric entry stores as typed', parseWeightToKg('83.7', 'metric'), 83.7);
expect('metric formats with unit', formatWeight(83.7, 'metric'), '83.7 kg');

// Height: ft+in pair, never decimal feet.
expect('175 cm displays as 5\'9"', formatHeight(175, 'imperial'), `5'9"`);
expect("5'9\" stores 175.26 cm", ftInToCm(5, 9), 175.26);
const back = cmToFtIn(ftInToCm(6, 0));
expect('6\'0" round-trips', `${back.ft}'${back.inches}"`, `6'0"`);
expect('conversion sanity: 100 kg = 220.5 lb', formatWeight(100, 'imperial'), '220.5 lb');
expect('lb→kg→lb is lossless to float precision', Math.abs(kgToLb(lbToKg(184.5)) - 184.5) < 1e-9, true);

// ---------------------------------------------------------------------------
// Plausibility guard (Phase 12 defect 1). The live failure: a user typed 203
// meaning pounds into a field reading kilograms, and it was stored as 203 kg.
// ---------------------------------------------------------------------------

const verdict = (input, pref) => checkWeightEntry(input, pref).kind;

// THE EXACT FAILURE. 203 kg is inside every sane adult range, so a range
// check alone lets it through — the guard has to notice that 203 lb is the
// ordinary reading and 203 kg is not.
const v203 = checkWeightEntry('203', 'metric');
expect('203 typed in kg is flagged ambiguous, not accepted', v203.kind, 'ambiguous');
expect('203 kg suggests 203 lb instead', v203.kind === 'ambiguous' && Math.abs(v203.meantKg - 92.079) < 0.01, true);
expect('  ...and names the unit it thinks was meant', v203.kind === 'ambiguous' && v203.meantUnit, 'imperial');

// The same number typed by someone whose preference IS pounds is ordinary.
expect('203 typed in lb is accepted', verdict('203', 'imperial'), 'ok');

// Ordinary entries in both units pass untouched.
expect('82 kg accepted', verdict('82', 'metric'), 'ok');
expect('180 lb accepted', verdict('180', 'imperial'), 'ok');
expect('149 kg accepted (ordinary band, no prompt)', verdict('149', 'metric'), 'ok');

// Outside any adult range, in either unit: refused outright.
expect('700 kg refused', verdict('700', 'metric'), 'implausible');
expect('700 lb refused', verdict('700', 'imperial'), 'implausible');
expect('12 kg refused', verdict('12', 'metric'), 'implausible');
expect('20 lb refused', verdict('20', 'imperial'), 'implausible');

// Boundaries stay on the right side of the line.
expect('30 kg is the low bound, accepted', verdict('30', 'metric'), 'ok');
// 300 kg is inside the hard range, so it is never REFUSED — but 300 lb is
// the ordinary reading of those digits, so it still asks. That is the point
// of having two checks rather than one range.
expect('300 kg is not refused outright', verdict('300', 'metric') !== 'implausible', true);
expect('300 kg still asks whether lb was meant', verdict('300', 'metric'), 'ambiguous');
expect('300 lb accepted as typed', verdict('300', 'imperial'), 'ok');
expect('29.9 kg refused', verdict('29.9', 'metric'), 'implausible');
expect('300.1 kg refused', verdict('300.1', 'metric'), 'implausible');

// The mirror-image mistake: kilograms typed into a pounds field.
const v70 = checkWeightEntry('70', 'imperial');
expect('70 typed in lb is flagged ambiguous', v70.kind, 'ambiguous');
expect('  ...and suggests 70 kg instead', v70.kind === 'ambiguous' && v70.meantKg, 70);

// Nothing typed is not an error, just nothing.
expect('empty input reports empty', verdict('', 'metric'), 'empty');
expect('  ...and so is whitespace', verdict('   ', 'metric'), 'empty');

// CHANGED IN PHASE 16, deliberately. Junk used to collapse into 'empty' and
// the card told them apart by re-checking `weight.trim() === ''`. That made
// every kind of wrong input the same kind of wrong, and it meant parseFloat's
// prefix parsing went unnoticed: '9.2.3' scored 'ok' at 9.2 kg.
expect('junk is malformed, not empty', verdict('abc', 'metric'), 'malformed');

// The guard never changes what a good entry stores.
expect('an accepted entry stores exactly what parseWeightToKg gives',
  checkWeightEntry('82.4', 'metric').kg, parseWeightToKg('82.4', 'metric'));

// ---------------------------------------------------------------------------
// PHASE 16 — DECIMALS.
//
// numeric(5,1) could not round-trip one decimal place in pounds: 0.1 lb is
// 0.045 kg, so a kg column with one decimal is coarser than the lb field
// showing it. 0012 widens the column to numeric(6,2); these are the client
// half of that proof, and weight_precision_test.sql is the database half.
// ---------------------------------------------------------------------------
const problem = (input, pref = 'metric') => {
  const v = checkWeightEntry(input, pref);
  return v.kind === 'malformed' ? v.problem : v.kind;
};

// --- accepted: one decimal place, in either unit, and whole numbers ---
expect('92.1 kg accepted', verdict('92.1', 'metric'), 'ok');
expect('203.4 lb accepted', verdict('203.4', 'imperial'), 'ok');
expect('a whole number needs no ".0"', verdict('92', 'metric'), 'ok');
expect('a trailing zero is fine too', verdict('92.0', 'metric'), 'ok');
expect('leading zero is fine', verdict('092.1', 'metric'), 'ok');
expect('surrounding spaces are trimmed', verdict('  92.1  ', 'metric'), 'ok');

// --- locale: a comma IS a decimal separator ---
expect('92,1 is accepted as 92.1', verdict('92,1', 'metric'), 'ok');
expect('  ...and parses to the same kg', parseWeightToKg('92,1', 'metric'), 92.1);
expect('  ...identically to the point form',
  parseWeightToKg('92,1', 'metric'), parseWeightToKg('92.1', 'metric'));
// ...but a string carrying BOTH is refused rather than guessed at. Reading
// '1,234.5' as 1234.5 or as 1.2345 are both defensible and both wrong.
expect('a comma AND a point is refused', problem('1,234.5'), 'mixed-separators');

// --- rejected, each with its own reason ---
expect('two decimal points', problem('9.2.3'), 'two-points');
expect('two commas, same thing', problem('9,2,3'), 'two-points');
expect('a trailing separator', problem('92.'), 'trailing-point');
expect('a trailing comma', problem('92,'), 'trailing-point');
expect('a lone separator', problem('.'), 'not-a-number');
expect('an empty decimal', problem('.5'), 'not-a-number');
expect('digits with a unit stuck on', problem('92kg'), 'not-a-number');
expect('a negative', problem('-92.1'), 'not-a-number');
expect('two decimal places is too fine for the field', problem('92.15'), 'too-precise');

// THE PREFIX-PARSER BUG, named. parseFloat('9.2.3') is 9.2 and parseFloat
// ('92kg') is 92: both were silently accepted and stored as a weight the user
// never typed. Neither is a number now.
expect('9.2.3 does not silently become 9.2', parseWeightToKg('9.2.3', 'metric'), null);
expect('92kg does not silently become 92', parseWeightToKg('92kg', 'metric'), null);

// --- B3: the guard applies to decimals exactly as to whole numbers ---
const v2034 = checkWeightEntry('203.4', 'metric');
expect('203.4 typed in kg still asks whether pounds were meant', v2034.kind, 'ambiguous');
expect('  ...and suggests the pounds reading',
  v2034.kind === 'ambiguous' && Math.abs(v2034.meantKg - 92.2606) < 0.001, true);
expect('  ...naming imperial',
  v2034.kind === 'ambiguous' && v2034.meantUnit, 'imperial');
expect('70.5 typed in lb still asks whether kg were meant',
  verdict('70.5', 'imperial'), 'ambiguous');
expect('29.9 kg is still refused outright', verdict('29.9', 'metric'), 'implausible');
expect('300.1 kg is still refused outright', verdict('300.1', 'metric'), 'implausible');
expect('a decimal in the ordinary band is just accepted',
  verdict('92.4', 'metric'), 'ok');

// --- B1: the round trip, at the precision 0012 gives the column ---
// store() is what numeric(6,2) does to a value on the way in.
const store2 = (kg) => Number(kg.toFixed(2));
const store1 = (kg) => Number(kg.toFixed(1));
const readBackLb = (kg) => formatWeight(kg, 'imperial');
const readBackKg = (kg) => formatWeight(kg, 'metric');

let moved1 = 0;
for (const lb of ['203.4', '187.7', '154.3', '165.1', '199.5', '178.6']) {
  const kg = parseWeightToKg(lb, 'imperial');
  if (readBackLb(store1(kg)) !== `${lb} lb`) moved1++;
  expect(`${lb} lb round-trips through numeric(6,2)`,
    readBackLb(store2(kg)), `${lb} lb`);
}
// The old column is shown failing, so the widening is not taken on trust.
expect('numeric(5,1) moved at least one of those values', moved1 > 0, true);

for (const kg of ['92.1', '70.3', '85.7', '100.9', '61.5', '113.4']) {
  const stored = store2(parseWeightToKg(kg, 'metric'));
  expect(`${kg} kg round-trips through numeric(6,2)`,
    readBackKg(stored), `${kg} kg`);
}

// --- B4: one decimal place, always, including the whole numbers ---
expect('a stored 92 shows as 92.0 kg', formatWeight(92, 'metric'), '92.0 kg');
expect('a stored 92 shows one decimal in lb too',
  formatWeight(92, 'imperial').endsWith('.9 lb') ||
  /\.\d lb$/.test(formatWeight(92, 'imperial')), true);
expect('and the prefill value carries the decimal',
  formatWeightValue(92, 'metric'), '92.0');

console.log(failures === 0 ? '\nAll unit round-trip checks passed.' : `\n${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
