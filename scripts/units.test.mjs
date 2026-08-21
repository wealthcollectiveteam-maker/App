// Round-trip guard for lib/units.ts (Phase 9 Part 1).
// The critical property: convert ONCE on the way in at full precision, round
// only at the formatter — so what the user typed is byte-identical on read.
// Run: npm run test:units
import {
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

console.log(failures === 0 ? '\nAll unit round-trip checks passed.' : `\n${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
