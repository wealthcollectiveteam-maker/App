// Live verification of the FDC dataset + portion math (Phase 9 Part 4).
// Hits the real USDA API (DEMO_KEY fallback) and asserts the definition-of-
// done cases: FNDDS composite dishes surface, the two-component meal math
// lands near reality, and Branded per-serving numbers match the label.
// Run: npm run test:fdc
import {
  normalizeFoodDetail,
  normalizeSearchResults,
  ouncesToGrams,
  scaleNutrients,
} from '../src/lib/fdc.ts';

const API_KEY = process.env.EXPO_PUBLIC_FDC_API_KEY || 'DEMO_KEY';
const BASE = 'https://api.nal.usda.gov/fdc/v1';

let failures = 0;
function expect(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
}

async function search(query, dataTypes) {
  // POST with a JSON body: the GET endpoint's dataType list is rejected
  // with an nginx-level 400 for certain query strings regardless of
  // encoding, while POST is reliable.
  const res = await fetch(`${BASE}/foods/search?api_key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, pageSize: 20, dataType: dataTypes }),
  });
  if (!res.ok) throw new Error(`search failed ${res.status} for "${query}"`);
  return (await res.json()).foods ?? [];
}

async function detail(fdcId) {
  const res = await fetch(`${BASE}/food/${fdcId}?api_key=${API_KEY}`);
  if (!res.ok) throw new Error(`detail failed ${res.status}`);
  return res.json();
}

const ALL_TYPES = ['Survey (FNDDS)', 'Foundation', 'SR Legacy', 'Branded'];

// ---- DoD 1: "chicken and rice" surfaces an FNDDS composite in the top 5 ----
const candr = normalizeSearchResults(await search('chicken and rice', ALL_TYPES));
const top5 = candr.slice(0, 5);
const fnddsHit = top5.find((r) => r.dataType === 'Survey (FNDDS)');
expect(
  '"chicken and rice" → FNDDS composite in top 5',
  !!fnddsHit,
  fnddsHit ? `#${top5.indexOf(fnddsHit) + 1}: ${fnddsHit.description}` : `top5: ${top5.map((r) => r.dataType).join(', ')}`,
);
expect(
  'ranking puts Survey/Foundation/SR above Branded',
  top5.every((r) => r.dataType !== 'Branded') || top5.findIndex((r) => r.dataType === 'Branded') > top5.findIndex((r) => r.dataType !== 'Branded'),
);

// ---- DoD 2: chicken breast 6 oz + white rice 1 cup ≈ 485 kcal ±15% ----
const chickenResults = normalizeSearchResults(
  await search('chicken breast grilled', ALL_TYPES),
).filter((r) => r.dataType !== 'Branded');
const chicken = normalizeFoodDetail(await detail(chickenResults[0].fdcId));
const chickenGrams = ouncesToGrams(6);
const chickenScaled = scaleNutrients(chicken.per100g, chickenGrams);

const riceResults = normalizeSearchResults(
  await search('rice white cooked', ALL_TYPES),
).filter((r) => r.dataType !== 'Branded');
const rice = normalizeFoodDetail(await detail(riceResults[0].fdcId));
const cupPortion =
  rice.portions.find((p) => /cup/i.test(p.label)) ?? { label: '1 cup (est)', gramWeight: 158 };
const riceScaled = scaleNutrients(rice.per100g, cupPortion.gramWeight);

const totalKcal = chickenScaled.kcal + riceScaled.kcal;
console.log(
  `      computed: ${chicken.description} 6 oz = ${chickenScaled.kcal} kcal` +
    ` + ${rice.description} ${cupPortion.label} (${cupPortion.gramWeight} g) = ${riceScaled.kcal} kcal` +
    ` → TOTAL ${totalKcal} kcal`,
);
expect(
  'two-component meal within 15% of 485 kcal',
  Math.abs(totalKcal - 485) / 485 <= 0.15,
  `${totalKcal} kcal (target 485 ±15% → 412–558)`,
);
expect('rice offers a real cup portion from foodPortions', /cup/i.test(cupPortion.label), cupPortion.label);

// ---- DoD 3: a Branded item's serving matches its label ----
const brandedResults = normalizeSearchResults(
  await search('cheerios', ['Branded']),
);
const brandedRaw = await detail(brandedResults[0].fdcId);
const branded = normalizeFoodDetail(brandedRaw);
const serving = branded.portions[0];
const perServing = scaleNutrients(branded.per100g, serving.gramWeight);
const labelKcal = brandedRaw.labelNutrients?.calories?.value;
console.log(
  `      branded: ${branded.description} — serving ${serving.label} (${serving.gramWeight} g)` +
    ` → computed ${perServing.kcal} kcal, label says ${labelKcal ?? 'n/a'} kcal`,
);
expect(
  'branded serving kcal matches the package label (±1)',
  labelKcal != null && Math.abs(perServing.kcal - labelKcal) <= 1,
);

// ---- sanity: the catastrophic bug (label treated as per-100g) is absent ----
const per100Branded = scaleNutrients(branded.per100g, 100).kcal;
expect(
  'branded per-100g and per-serving differ when serving ≠ 100 g',
  serving.gramWeight === 100 || per100Branded !== perServing.kcal ||
    Math.abs(serving.gramWeight - 100) < 5,
);

console.log(failures === 0 ? '\nAll FDC math checks passed.' : `\n${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
