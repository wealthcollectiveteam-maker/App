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
expect('junk reports empty', verdict('abc', 'metric'), 'empty');

// The guard never changes what a good entry stores.
expect('an accepted entry stores exactly what parseWeightToKg gives',
  checkWeightEntry('82.4', 'metric').kg, parseWeightToKg('82.4', 'metric'));

console.log(failures === 0 ? '\nAll unit round-trip checks passed.' : `\n${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
