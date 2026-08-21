/**
 * USDA FoodData Central: dataset-aware normalization and portion math.
 * Pure module (no react-native imports) so the scaling rules — where
 * calorie numbers silently go 10x wrong — are unit-testable in plain Node
 * against the real API.
 *
 * Scaling rules, per dataset:
 * - Foundation / SR Legacy / Survey (FNDDS): `foodNutrients` are PER 100 g.
 *   Scale by grams/100. Survey additionally ships `foodPortions` with real
 *   gram weights ("1 cup", "1 breast") — those drive the unit picker.
 * - Branded: `labelNutrients` are PER SERVING (servingSize + unit); the
 *   detail `foodNutrients` remain per 100 g. We normalize everything to
 *   per-100g, preferring labelNutrients÷servingSize when present because it
 *   matches the package label exactly.
 */

export type FdcDataType =
  | 'Survey (FNDDS)'
  | 'Foundation'
  | 'SR Legacy'
  | 'Branded';

export interface Per100g {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface FoodPortion {
  label: string;
  gramWeight: number;
}

export interface FoodSearchResult {
  fdcId: number;
  description: string;
  brand: string | null;
  dataType: FdcDataType;
  per100g: Per100g;
  /** FDC relevance score, used within a dataset tier. */
  score: number;
}

export interface FoodDetail {
  fdcId: number;
  description: string;
  dataType: FdcDataType;
  per100g: Per100g;
  /** Real portions first (FNDDS gram weights, branded serving), then fallbacks. */
  portions: FoodPortion[];
}

// Nutrient identifiers: energy 1008, protein 1003, fat 1004, carbs 1005 —
// with the legacy `nutrientNumber` strings the search endpoint reports.
const NUTRIENTS = {
  kcal: { numbers: ['208'], ids: [1008, 2047, 2048] },
  protein: { numbers: ['203'], ids: [1003] },
  fat: { numbers: ['204'], ids: [1004] },
  carbs: { numbers: ['205'], ids: [1005] },
} as const;

interface RawNutrient {
  nutrientNumber?: string;
  nutrientId?: number;
  value?: number;
  amount?: number;
  nutrient?: { number?: string; id?: number };
}

function pickNutrient(
  nutrients: RawNutrient[],
  spec: { numbers: readonly string[]; ids: readonly number[] },
): number {
  const hit = nutrients.find((n) => {
    const num = n.nutrientNumber ?? n.nutrient?.number;
    const id = n.nutrientId ?? n.nutrient?.id;
    return (
      (num != null && spec.numbers.includes(num)) ||
      (id != null && spec.ids.includes(id))
    );
  });
  return hit?.value ?? hit?.amount ?? 0;
}

export function per100gFromNutrients(nutrients: RawNutrient[]): Per100g {
  return {
    kcal: pickNutrient(nutrients, NUTRIENTS.kcal),
    protein: pickNutrient(nutrients, NUTRIENTS.protein),
    carbs: pickNutrient(nutrients, NUTRIENTS.carbs),
    fat: pickNutrient(nutrients, NUTRIENTS.fat),
  };
}

/** Dataset ranking: whole/composite foods above the Branded flood. */
const DATATYPE_TIER: Record<string, number> = {
  'Survey (FNDDS)': 0,
  Foundation: 1,
  'SR Legacy': 2,
  Branded: 3,
};

export interface RawSearchFood {
  fdcId: number;
  description: string;
  dataType?: string;
  brandOwner?: string;
  brandName?: string;
  score?: number;
  foodNutrients?: RawNutrient[];
}

/** Normalize + rank search results: dataset tier first, then FDC score. */
export function normalizeSearchResults(
  foods: RawSearchFood[],
): FoodSearchResult[] {
  return foods
    .filter((f) => f.dataType && DATATYPE_TIER[f.dataType] !== undefined)
    .map((f) => ({
      fdcId: f.fdcId,
      description: f.description,
      brand: f.brandOwner || f.brandName || null,
      dataType: f.dataType as FdcDataType,
      per100g: per100gFromNutrients(f.foodNutrients ?? []),
      score: f.score ?? 0,
    }))
    .filter((f) => f.per100g.kcal > 0)
    .sort((a, b) => {
      const tier = DATATYPE_TIER[a.dataType] - DATATYPE_TIER[b.dataType];
      return tier !== 0 ? tier : b.score - a.score;
    });
}

export interface RawFoodDetail {
  fdcId: number;
  description: string;
  dataType?: string;
  foodNutrients?: RawNutrient[];
  foodPortions?: {
    portionDescription?: string;
    modifier?: string;
    measureUnit?: { name?: string };
    amount?: number;
    gramWeight?: number;
  }[];
  servingSize?: number;
  servingSizeUnit?: string;
  householdServingFullText?: string;
  labelNutrients?: {
    calories?: { value?: number };
    protein?: { value?: number };
    carbohydrates?: { value?: number };
    fat?: { value?: number };
  };
}

const OZ_GRAMS = 28.3495;

/** Normalize a detail response: per-100g nutrients + a usable portion list. */
export function normalizeFoodDetail(raw: RawFoodDetail): FoodDetail {
  const dataType = (raw.dataType ?? 'Foundation') as FdcDataType;
  let per100g = per100gFromNutrients(raw.foodNutrients ?? []);

  const portions: FoodPortion[] = [];

  if (dataType === 'Branded') {
    const servingG =
      raw.servingSize != null && /^(g|ml|grm)$/i.test(raw.servingSizeUnit ?? '')
        ? raw.servingSize
        : null;
    // labelNutrients are PER SERVING. When both the label and a gram-based
    // serving size exist, derive per-100g from the label so a serving
    // matches the package exactly (the per-100g foodNutrients can round).
    if (servingG && raw.labelNutrients?.calories?.value != null) {
      const l = raw.labelNutrients;
      per100g = {
        kcal: ((l.calories?.value ?? 0) / servingG) * 100,
        protein: ((l.protein?.value ?? 0) / servingG) * 100,
        carbs: ((l.carbohydrates?.value ?? 0) / servingG) * 100,
        fat: ((l.fat?.value ?? 0) / servingG) * 100,
      };
    }
    if (servingG) {
      portions.push({
        label: raw.householdServingFullText?.trim() || `1 serving (${servingG} g)`,
        gramWeight: servingG,
      });
    }
  }

  // Survey/Foundation/SR real portions with gram weights.
  for (const p of raw.foodPortions ?? []) {
    if (!p.gramWeight || p.gramWeight <= 0) continue;
    const label =
      p.portionDescription?.trim() ||
      [p.amount, p.modifier ?? p.measureUnit?.name]
        .filter((x) => x != null && x !== '')
        .join(' ')
        .trim();
    if (!label || /quantity not specified/i.test(label)) continue;
    portions.push({ label, gramWeight: p.gramWeight });
  }

  // Always-available fallbacks — never a bare "1 serving" without grams.
  portions.push({ label: '100 g', gramWeight: 100 });
  portions.push({ label: '1 oz', gramWeight: OZ_GRAMS });

  return {
    fdcId: raw.fdcId,
    description: raw.description,
    dataType,
    per100g,
    portions: portions.slice(0, 12),
  };
}

/** The one scaling rule: everything is grams × per-100g. */
export function scaleNutrients(per100g: Per100g, grams: number): Per100g {
  const f = grams / 100;
  return {
    kcal: Math.round(per100g.kcal * f),
    protein: Math.round(per100g.protein * f * 10) / 10,
    carbs: Math.round(per100g.carbs * f * 10) / 10,
    fat: Math.round(per100g.fat * f * 10) / 10,
  };
}

export function ouncesToGrams(oz: number): number {
  return oz * OZ_GRAMS;
}
