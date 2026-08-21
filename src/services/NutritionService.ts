import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  normalizeFoodDetail,
  normalizeSearchResults,
  type FoodDetail,
  type FoodSearchResult,
  type RawFoodDetail,
  type RawSearchFood,
} from '@/lib/fdc';

/**
 * Nutrition lookup: USDA FoodData Central (free, no request caps,
 * commercial use permitted). Dataset-aware — Survey (FNDDS) is what makes
 * composite dishes like "chicken and rice" findable, and per-dataset
 * portion math lives in lib/fdc.ts. A different provider can replace this
 * behind the same interface without touching UI.
 */
export interface INutritionService {
  searchFoods(query: string): Promise<FoodSearchResult[]>;
  /** Full detail (per-100g + real portions), cached by fdcId. */
  getFoodDetail(fdcId: number): Promise<FoodDetail>;
  clearCache(): Promise<void>;
}

const API_KEY = process.env.EXPO_PUBLIC_FDC_API_KEY || 'DEMO_KEY';
const BASE = 'https://api.nal.usda.gov/fdc/v1';
const DETAIL_CACHE_PREFIX = 'ranked.fdc.detail.';
const QUERY_CACHE_PREFIX = 'ranked.fdc.query.';

// Survey (FNDDS) carries real composite dishes; ranking happens in lib/fdc.
const DATA_TYPES = ['Survey (FNDDS)', 'Foundation', 'SR Legacy', 'Branded'];

class UsdaNutritionService implements INutritionService {
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

    // POST with a JSON body: the GET endpoint's dataType list triggers
    // nginx-level 400s for certain query strings regardless of encoding.
    const res = await fetch(`${BASE}/foods/search?api_key=${encodeURIComponent(API_KEY)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: q, pageSize: 20, dataType: DATA_TYPES }),
    });
    if (!res.ok) throw new Error(`USDA lookup failed (${res.status})`);
    const json = (await res.json()) as { foods?: RawSearchFood[] };
    const results = normalizeSearchResults(json.foods ?? []).slice(0, 12);

    await AsyncStorage.setItem(
      QUERY_CACHE_PREFIX + q,
      JSON.stringify(results),
    ).catch(() => {});
    return results;
  }

  async getFoodDetail(fdcId: number): Promise<FoodDetail> {
    const cacheKey = DETAIL_CACHE_PREFIX + fdcId;
    const cached = await AsyncStorage.getItem(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached) as FoodDetail;
      } catch {
        // fall through to network
      }
    }
    const res = await fetch(
      `${BASE}/food/${fdcId}?api_key=${encodeURIComponent(API_KEY)}`,
    );
    if (!res.ok) throw new Error(`USDA detail failed (${res.status})`);
    const detail = normalizeFoodDetail((await res.json()) as RawFoodDetail);
    await AsyncStorage.setItem(cacheKey, JSON.stringify(detail)).catch(() => {});
    return detail;
  }

  async clearCache(): Promise<void> {
    const keys = await AsyncStorage.getAllKeys();
    const mine = keys.filter(
      (k) =>
        k.startsWith(DETAIL_CACHE_PREFIX) ||
        k.startsWith(QUERY_CACHE_PREFIX) ||
        // legacy phase-5 cache keys
        k.startsWith('ranked.nutrition.'),
    );
    if (mine.length) await AsyncStorage.multiRemove(mine);
  }
}

export const NutritionService: INutritionService = new UsdaNutritionService();
