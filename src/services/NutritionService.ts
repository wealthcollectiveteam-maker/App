import AsyncStorage from '@react-native-async-storage/async-storage';

import type { FoodSearchResult } from '@/data/types';

/**
 * Nutrition lookup contract. The shipped implementation uses USDA
 * FoodData Central (free, no request caps, commercial use permitted).
 * A paid provider (Nutritionix, Edamam) can replace it without touching UI.
 */
export interface INutritionService {
  searchFoods(query: string): Promise<FoodSearchResult[]>;
  clearCache(): Promise<void>;
}

const API_KEY = process.env.EXPO_PUBLIC_FDC_API_KEY || 'DEMO_KEY';
const SEARCH_URL = 'https://api.nal.usda.gov/fdc/v1/foods/search';
const CACHE_PREFIX = 'ranked.nutrition.food.';
const QUERY_CACHE_PREFIX = 'ranked.nutrition.query.';

// USDA nutrient numbers
const NUTRIENTS = {
  calories: ['1008', '2047', '2048'], // Energy (kcal, Atwater variants)
  protein: ['1003'],
  carbs: ['1005'],
  fat: ['1004'],
} as const;

interface FdcNutrient {
  nutrientNumber?: string;
  nutrientId?: number;
  value?: number;
  unitName?: string;
}

interface FdcFood {
  fdcId: number;
  description: string;
  brandOwner?: string;
  brandName?: string;
  servingSize?: number;
  servingSizeUnit?: string;
  foodNutrients?: FdcNutrient[];
}

function pickNutrient(nutrients: FdcNutrient[], numbers: readonly string[]): number {
  for (const num of numbers) {
    const hit = nutrients.find((n) => n.nutrientNumber === num);
    if (hit?.value != null) return hit.value;
  }
  return 0;
}

function normalize(food: FdcFood): FoodSearchResult {
  const nutrients = food.foodNutrients ?? [];
  // Search-endpoint nutrient values are per 100g. Branded foods also carry
  // a labeled serving size; surface it as the default portion when present.
  const per100 = {
    calories: pickNutrient(nutrients, NUTRIENTS.calories),
    protein: pickNutrient(nutrients, NUTRIENTS.protein),
    carbs: pickNutrient(nutrients, NUTRIENTS.carbs),
    fat: pickNutrient(nutrients, NUTRIENTS.fat),
  };
  const hasBrandedServing =
    food.servingSize != null &&
    food.servingSizeUnit != null &&
    /^(g|ml)$/i.test(food.servingSizeUnit);
  const qty = hasBrandedServing ? food.servingSize! : 100;
  const scale = qty / 100;

  return {
    fdcId: food.fdcId,
    description: food.description,
    brand: food.brandOwner || food.brandName || null,
    servingQty: qty,
    servingUnit: hasBrandedServing ? food.servingSizeUnit!.toLowerCase() : 'g',
    calories: Math.round(per100.calories * scale),
    protein: Math.round(per100.protein * scale * 10) / 10,
    carbs: Math.round(per100.carbs * scale * 10) / 10,
    fat: Math.round(per100.fat * scale * 10) / 10,
  };
}

class UsdaNutritionService implements INutritionService {
  /**
   * Search USDA. Results are cached per normalized query and each food is
   * cached by fdcId, so repeat lookups cost no network call.
   */
  async searchFoods(query: string): Promise<FoodSearchResult[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const cached = await AsyncStorage.getItem(QUERY_CACHE_PREFIX + q);
    if (cached) {
      try {
        return JSON.parse(cached) as FoodSearchResult[];
      } catch {
        // fall through to network
      }
    }

    const url =
      `${SEARCH_URL}?api_key=${encodeURIComponent(API_KEY)}` +
      `&query=${encodeURIComponent(q)}` +
      '&pageSize=10&dataType=Foundation,SR%20Legacy,Branded';
    const res = await fetch(url);
    if (!res.ok) throw new Error(`USDA lookup failed (${res.status})`);
    const json = (await res.json()) as { foods?: FdcFood[] };
    const results = (json.foods ?? []).map(normalize).filter((r) => r.calories > 0);

    await AsyncStorage.setItem(
      QUERY_CACHE_PREFIX + q,
      JSON.stringify(results),
    ).catch(() => {});
    await Promise.all(
      results.map((r) =>
        AsyncStorage.setItem(CACHE_PREFIX + r.fdcId, JSON.stringify(r)).catch(
          () => {},
        ),
      ),
    );
    return results;
  }

  async clearCache(): Promise<void> {
    const keys = await AsyncStorage.getAllKeys();
    const mine = keys.filter(
      (k) => k.startsWith(CACHE_PREFIX) || k.startsWith(QUERY_CACHE_PREFIX),
    );
    if (mine.length) await AsyncStorage.multiRemove(mine);
  }
}

export const NutritionService: INutritionService = new UsdaNutritionService();
