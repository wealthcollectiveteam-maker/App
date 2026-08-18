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
import type { FoodSearchResult, Meal, MealNutrition } from '@/data/types';
import { DataService } from '@/services/DataService';
import { useAppStore } from '@/store/useAppStore';
import { toast } from '@/store/useToastStore';
import { colors, font, radius } from '@/theme/tokens';

/**
 * Optional nutrition enrichment for a logged meal. Search USDA, pick a
 * food, adjust the portion, attach. Neutral numbers only — no targets,
 * no judgment. Plain-text logging stays the primary path.
 */
export function NutritionSheet({
  meal,
  onClose,
}: {
  meal: Meal | null;
  onClose: () => void;
}) {
  const attachNutrition = useAppStore((s) => s.attachNutrition);
  const removeNutrition = useAppStore((s) => s.removeNutrition);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FoodSearchResult[]>([]);
  const [selected, setSelected] = useState<FoodSearchResult | null>(null);
  const [qty, setQty] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async (q: string) => {
    if (!q.trim()) return;
    setLoading(true);
    setError(null);
    setSelected(null);
    try {
      const found = await DataService.searchFoods(q);
      setResults(found);
      if (found.length === 0) setError('No matches. Try a simpler term.');
    } catch {
      setError('Lookup failed. Check your connection and retry.');
    } finally {
      setLoading(false);
    }
  };

  // Pre-fill the query from the meal text and search on open.
  useEffect(() => {
    if (meal) {
      setQuery(meal.text);
      setResults([]);
      setSelected(null);
      setError(null);
      search(meal.text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meal?.id]);

  const scale =
    selected && Number(qty) > 0 ? Number(qty) / selected.servingQty : 1;

  const attach = () => {
    if (!meal || !selected) return;
    const portion = Number(qty) > 0 ? Number(qty) : selected.servingQty;
    const factor = portion / selected.servingQty;
    const nutrition: MealNutrition = {
      fdcId: selected.fdcId,
      foodName: selected.description,
      servingQty: portion,
      servingUnit: selected.servingUnit,
      calories: Math.round(selected.calories * factor),
      protein: Math.round(selected.protein * factor * 10) / 10,
      carbs: Math.round(selected.carbs * factor * 10) / 10,
      fat: Math.round(selected.fat * factor * 10) / 10,
    };
    attachNutrition(meal.id, nutrition);
    toast(`${nutrition.calories} cal attached`);
    onClose();
  };

  return (
    <BottomSheet visible={!!meal} onClose={onClose}>
      <Kicker style={{ marginBottom: 10 }}>Nutrition — optional</Kicker>

      <View style={styles.searchRow}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search foods"
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

      {!selected && !loading && results.length > 0 && (
        <ScrollView style={{ maxHeight: 260 }}>
          {results.map((r) => (
            <Pressable
              key={r.fdcId}
              onPress={() => {
                setSelected(r);
                setQty(String(r.servingQty));
              }}
              style={styles.resultRow}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.resultName} numberOfLines={1}>
                  {r.description}
                </Text>
                <Text style={styles.resultMeta} numberOfLines={1}>
                  {r.brand ? `${r.brand} · ` : ''}
                  per {r.servingQty} {r.servingUnit}
                </Text>
              </View>
              <Text style={styles.resultCal}>{r.calories} cal</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {selected && (
        <View>
          <Text style={styles.resultName}>{selected.description}</Text>
          <View style={styles.portionRow}>
            <TextInput
              value={qty}
              onChangeText={setQty}
              keyboardType="numeric"
              style={[styles.input, { flex: 0, width: 90 }]}
            />
            <Text style={styles.unit}>{selected.servingUnit}</Text>
            <Text style={styles.preview}>
              {Math.round(selected.calories * scale)} cal ·{' '}
              {Math.round(selected.protein * scale)}P ·{' '}
              {Math.round(selected.carbs * scale)}C ·{' '}
              {Math.round(selected.fat * scale)}F
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
            <OutlineButton label="Attach" onPress={attach} style={{ flex: 1 }} />
            <OutlineButton
              label="Back"
              tone="neutral"
              onPress={() => setSelected(null)}
            />
          </View>
        </View>
      )}

      {meal?.nutrition && !selected && (
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
  searchRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
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
    paddingVertical: 6,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 48,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    paddingVertical: 6,
  },
  resultName: {
    fontFamily: font.medium,
    fontSize: 13.5,
    color: colors.text,
  },
  resultMeta: {
    fontFamily: font.regular,
    fontSize: 11.5,
    color: colors.neutral500,
    marginTop: 2,
  },
  resultCal: {
    fontFamily: font.medium,
    fontSize: 13,
    color: colors.accent300,
    fontVariant: ['tabular-nums'],
  },
  portionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
  },
  unit: {
    fontFamily: font.regular,
    fontSize: 13,
    color: colors.neutral400,
  },
  preview: {
    flex: 1,
    fontFamily: font.regular,
    fontSize: 12.5,
    color: colors.neutral300,
    textAlign: 'right',
  },
});
