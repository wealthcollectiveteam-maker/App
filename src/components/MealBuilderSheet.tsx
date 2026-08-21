import { XIcon as X } from 'phosphor-react-native';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { BottomSheet } from '@/components/BottomSheet';
import { Kicker, OutlineButton } from '@/components/ui';
import type { Meal, MealComponent, MealNutrition } from '@/data/types';
import {
  ouncesToGrams,
  scaleNutrients,
  type FoodDetail,
  type FoodPortion,
  type FoodSearchResult,
} from '@/lib/fdc';
import { DataService } from '@/services/DataService';
import { useAppStore } from '@/store/useAppStore';
import { toast } from '@/store/useToastStore';
import { colors, font, radius } from '@/theme/tokens';

const MAX_COMPONENTS = 8;

function totalsOf(components: MealComponent[]): MealNutrition {
  const t = components.reduce(
    (acc, c) => ({
      calories: acc.calories + c.kcal,
      protein: acc.protein + c.protein,
      carbs: acc.carbs + c.carbs,
      fat: acc.fat + c.fat,
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
  return {
    calories: Math.round(t.calories),
    protein: Math.round(t.protein * 10) / 10,
    carbs: Math.round(t.carbs * 10) / 10,
    fat: Math.round(t.fat * 10) / 10,
    components,
  };
}

/**
 * Multi-component meal builder: a meal is a name plus up to 8 foods, each
 * with a real portion (the food's own gram-weighted portions first, grams
 * and ounces as fallbacks — never a bare "serving"). Totals sum live.
 * Nutrition stays optional everywhere; plain-text logging is untouched.
 */
export function MealBuilderSheet({
  meal,
  onClose,
}: {
  meal: Meal | null;
  onClose: () => void;
}) {
  const attachNutrition = useAppStore((s) => s.attachNutrition);
  const removeNutrition = useAppStore((s) => s.removeNutrition);
  const saveMealTemplate = useAppStore((s) => s.saveMealTemplate);

  const [components, setComponents] = useState<MealComponent[]>([]);
  // add-component flow state
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FoodSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<FoodDetail | null>(null);
  const [portion, setPortion] = useState<FoodPortion | null>(null);
  const [qty, setQty] = useState('1');

  // Reset when opened for a different meal.
  const [seenId, setSeenId] = useState<string | null>(null);
  if ((meal?.id ?? null) !== seenId) {
    setSeenId(meal?.id ?? null);
    setComponents(meal?.nutrition?.components ?? []);
    setAdding(!meal?.nutrition);
    setQuery(meal?.text ?? '');
    setResults([]);
    setDetail(null);
    setError(null);
  }

  const search = async (q: string) => {
    if (!q.trim()) return;
    setLoading(true);
    setError(null);
    setDetail(null);
    try {
      const found = await DataService.searchFoods(q);
      setResults(found);
      if (found.length === 0) setError('No matches. Try a simpler term.');
    } catch {
      setError('Lookup failed. Check your connection — or use Quick Add.');
    } finally {
      setLoading(false);
    }
  };

  // Auto-search the meal text when the builder opens empty.
  useEffect(() => {
    if (meal && adding && results.length === 0 && !loading && query.trim()) {
      search(query);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seenId]);

  const pick = async (r: FoodSearchResult) => {
    setLoading(true);
    setError(null);
    try {
      const d = await DataService.getFoodDetail(r.fdcId);
      setDetail(d);
      setPortion(d.portions[0] ?? { label: '100 g', gramWeight: 100 });
      setQty('1');
    } catch {
      setError('Could not load that food.');
    } finally {
      setLoading(false);
    }
  };

  const addComponent = () => {
    if (!detail || !portion) return;
    const n = parseFloat(qty.replace(',', '.'));
    const quantity = Number.isFinite(n) && n > 0 ? n : 1;
    const grams =
      portion.label === '1 oz'
        ? ouncesToGrams(quantity)
        : portion.gramWeight * quantity;
    const scaled = scaleNutrients(detail.per100g, grams);
    const component: MealComponent = {
      fdcId: detail.fdcId,
      description: detail.description,
      quantity,
      unit: portion.label,
      gramWeight: Math.round(grams),
      kcal: scaled.kcal,
      protein: scaled.protein,
      carbs: scaled.carbs,
      fat: scaled.fat,
    };
    setComponents((prev) => [...prev, component].slice(0, MAX_COMPONENTS));
    setAdding(false);
    setDetail(null);
    setResults([]);
    setQuery('');
  };

  const totals = totalsOf(components);

  const attach = () => {
    if (!meal || components.length === 0) return;
    attachNutrition(meal.id, totals);
    toast(`${totals.calories} cal attached`);
    onClose();
  };

  const saveTemplate = () => {
    if (!meal || components.length === 0) return;
    attachNutrition(meal.id, totals);
    saveMealTemplate(meal.text, totals);
    toast('Saved — one tap next time');
    onClose();
  };

  return (
    <BottomSheet visible={!!meal} onClose={onClose}>
      <Kicker style={{ marginBottom: 10 }}>
        {meal?.text ?? ''} — nutrition (optional)
      </Kicker>

      {components.length > 0 && (
        <View style={styles.componentList}>
          {components.map((c, i) => (
            <View key={`${c.fdcId}-${i}`} style={styles.componentRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.componentName} numberOfLines={1}>
                  {c.description}
                </Text>
                <Text style={styles.componentMeta}>
                  {c.quantity} × {c.unit} · {c.gramWeight} g
                </Text>
              </View>
              <Text style={styles.componentCal}>{c.kcal} cal</Text>
              <Pressable
                onPress={() =>
                  setComponents((prev) => prev.filter((_, idx) => idx !== i))
                }
                hitSlop={8}
              >
                <X size={13} color={colors.neutral500} />
              </Pressable>
            </View>
          ))}
          <Text style={styles.totals}>
            {totals.calories} cal · {Math.round(totals.protein)}P ·{' '}
            {Math.round(totals.carbs)}C · {Math.round(totals.fat)}F
          </Text>
        </View>
      )}

      {!adding && components.length < MAX_COMPONENTS && (
        <OutlineButton
          label="+ add component"
          small
          tone="neutral"
          onPress={() => {
            setAdding(true);
            setResults([]);
            setQuery('');
          }}
          style={{ alignSelf: 'flex-start', marginBottom: 10 }}
        />
      )}

      {adding && !detail && (
        <>
          <View style={styles.searchRow}>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search foods — e.g. chicken breast"
              placeholderTextColor={colors.neutral600}
              style={styles.input}
              onSubmitEditing={() => search(query)}
            />
            <OutlineButton
              label="Search"
              small
              onPress={() => search(query)}
              style={{ minHeight: 42 }}
            />
          </View>
          {loading && (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={colors.accent400} />
              <Text style={styles.dim}>Searching USDA…</Text>
            </View>
          )}
          {error && !loading && <Text style={styles.dim}>{error}</Text>}
          {!loading && results.length > 0 && (
            <ScrollView style={{ maxHeight: 230 }}>
              {results.map((r) => (
                <Pressable
                  key={r.fdcId}
                  onPress={() => pick(r)}
                  style={styles.resultRow}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.componentName} numberOfLines={1}>
                      {r.description}
                    </Text>
                    <Text style={styles.componentMeta} numberOfLines={1}>
                      {r.brand ? `${r.brand} · ` : ''}
                      {r.dataType} · {Math.round(r.per100g.kcal)} cal / 100 g
                    </Text>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          )}
        </>
      )}

      {adding && detail && portion && (
        <View>
          <Text style={styles.componentName}>{detail.description}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }}>
            <View style={styles.portionRow}>
              {detail.portions.map((p) => {
                const active = p.label === portion.label;
                return (
                  <Pressable
                    key={p.label}
                    onPress={() => setPortion(p)}
                    style={[
                      styles.portionChip,
                      active && {
                        borderColor: colors.accent500,
                        backgroundColor: colors.accentTint,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.portionText,
                        active && { color: colors.accent200 },
                      ]}
                    >
                      {p.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
          <View style={styles.qtyRow}>
            <Text style={styles.dim}>Quantity</Text>
            <TextInput
              value={qty}
              onChangeText={setQty}
              keyboardType="numeric"
              style={[styles.input, { flex: 0, width: 70, textAlign: 'center' }]}
            />
            <Text style={styles.preview}>
              {(() => {
                const n = parseFloat(qty.replace(',', '.')) || 1;
                const grams =
                  portion.label === '1 oz'
                    ? ouncesToGrams(n)
                    : portion.gramWeight * n;
                return `${scaleNutrients(detail.per100g, grams).kcal} cal`;
              })()}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <OutlineButton label="Add" onPress={addComponent} style={{ flex: 1 }} />
            <OutlineButton
              label="Back"
              tone="neutral"
              onPress={() => setDetail(null)}
            />
          </View>
        </View>
      )}

      {components.length > 0 && (
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
          <OutlineButton label="Attach" onPress={attach} style={{ flex: 1 }} />
          <OutlineButton label="Save meal" tone="neutral" onPress={saveTemplate} />
        </View>
      )}

      {meal?.nutrition && (
        <OutlineButton
          label="Remove nutrition"
          tone="neutral"
          small
          onPress={() => {
            removeNutrition(meal.id);
            toast('Nutrition removed');
            onClose();
          }}
          style={{ marginTop: 12, alignSelf: 'flex-start' }}
        />
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  componentList: {
    marginBottom: 10,
    gap: 8,
  },
  componentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  componentName: {
    fontFamily: font.medium,
    fontSize: 13.5,
    color: colors.text,
  },
  componentMeta: {
    fontFamily: font.regular,
    fontSize: 11,
    color: colors.neutral500,
    marginTop: 1,
  },
  componentCal: {
    fontFamily: font.medium,
    fontSize: 12.5,
    color: colors.accent300,
    fontVariant: ['tabular-nums'],
  },
  totals: {
    fontFamily: font.medium,
    fontSize: 13,
    color: colors.text,
    marginTop: 4,
    fontVariant: ['tabular-nums'],
  },
  searchRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  input: {
    flex: 1,
    fontFamily: font.regular,
    fontSize: 13.5,
    color: colors.text,
    minHeight: 42,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
  },
  dim: {
    fontFamily: font.regular,
    fontSize: 12.5,
    color: colors.neutral500,
    paddingVertical: 4,
  },
  resultRow: {
    minHeight: 46,
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    paddingVertical: 6,
  },
  portionRow: {
    flexDirection: 'row',
    gap: 6,
  },
  portionChip: {
    borderWidth: 1,
    borderColor: colors.neutral700,
    borderRadius: radius.pill,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  portionText: {
    fontFamily: font.regular,
    fontSize: 12,
    color: colors.neutral300,
  },
  qtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
  },
  preview: {
    flex: 1,
    fontFamily: font.medium,
    fontSize: 13,
    color: colors.accent300,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
});
