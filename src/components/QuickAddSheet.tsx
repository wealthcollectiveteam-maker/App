import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { BottomSheet } from '@/components/BottomSheet';
import type { Meal } from '@/data/types';
import { Kicker, OutlineButton } from '@/components/ui';
import { useAppStore } from '@/store/useAppStore';
import { toast } from '@/store/useToastStore';
import { colors, font, radius } from '@/theme/tokens';

/**
 * MANUAL NUTRITION — now the only way, and it always was the good one.
 *
 * This replaced a USDA FoodData Central lookup that searched a federal
 * database of branded and survey foods. It could not find "chicken and
 * rice", which is what people actually type, and it put a network round
 * trip and an API key between the user and a number they already knew.
 * Name plus four optional figures needs neither.
 *
 * Two modes, one sheet:
 *   meal = null  — log a NEW meal, with nutrition if any was typed
 *   meal = <row> — attach nutrition to a meal that is already logged
 */
export function QuickAddSheet({
  visible,
  onClose,
  meal = null,
}: {
  visible: boolean;
  onClose: () => void;
  /** When set, the sheet edits THIS meal's nutrition instead of logging one. */
  meal?: Meal | null;
}) {
  const logMeal = useAppStore((s) => s.logMeal);
  const attachNutrition = useAppStore((s) => s.attachNutrition);

  const [name, setName] = useState('');
  const [calories, setCalories] = useState('');
  // Attaching to an existing meal: its name is fixed, and any figures it
  // already carries are what the fields start from.
  const attaching = meal != null;
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');

  // Re-seed whenever the sheet is pointed at a different meal.
  useEffect(() => {
    if (!meal) return;
    const n = meal.nutrition;
    setCalories(n?.calories ? String(n.calories) : '');
    setProtein(n?.protein ? String(n.protein) : '');
    setCarbs(n?.carbs ? String(n.carbs) : '');
    setFat(n?.fat ? String(n.fat) : '');
  }, [meal]);

  const reset = () => {
    setName('');
    setCalories('');
    setProtein('');
    setCarbs('');
    setFat('');
  };

  const num = (s: string) => {
    const n = parseFloat(s.replace(',', '.'));
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };

  const add = () => {
    const kcal = num(calories);
    const nutrition = {
      calories: Math.round(kcal),
      protein: num(protein),
      carbs: num(carbs),
      fat: num(fat),
      quickAdd: true,
    };

    if (attaching) {
      if (kcal <= 0) {
        toast('Enter the calories, or close without saving');
        return;
      }
      attachNutrition(meal.id, nutrition);
      toast(`Saved — ${Math.round(kcal)} cal`);
      reset();
      onClose();
      return;
    }

    const trimmed = name.trim();
    if (!trimmed) {
      toast('Give it a name');
      return;
    }
    const logged = logMeal(trimmed);
    if (kcal > 0) attachNutrition(logged.id, nutrition);
    toast(kcal > 0 ? `Logged — ${Math.round(kcal)} cal` : 'Logged');
    reset();
    onClose();
  };

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Kicker style={{ marginBottom: 10 }}>
        {attaching ? meal.text : 'Quick add'}
      </Kicker>
      {!attaching && (
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="What did you eat?"
          placeholderTextColor={colors.neutral600}
          style={styles.input}
        />
      )}
      <View style={styles.row}>
        <TextInput
          value={calories}
          onChangeText={setCalories}
          keyboardType="numeric"
          placeholder="Calories"
          placeholderTextColor={colors.neutral600}
          style={[styles.input, styles.small]}
        />
        <TextInput
          value={protein}
          onChangeText={setProtein}
          keyboardType="numeric"
          placeholder="P (g)"
          placeholderTextColor={colors.neutral600}
          style={[styles.input, styles.small]}
        />
        <TextInput
          value={carbs}
          onChangeText={setCarbs}
          keyboardType="numeric"
          placeholder="C (g)"
          placeholderTextColor={colors.neutral600}
          style={[styles.input, styles.small]}
        />
        <TextInput
          value={fat}
          onChangeText={setFat}
          keyboardType="numeric"
          placeholder="F (g)"
          placeholderTextColor={colors.neutral600}
          style={[styles.input, styles.small]}
        />
      </View>
      <Text style={styles.hint}>
        {attaching
          ? 'Macros are optional. Nothing is looked up — these are your numbers.'
          : 'Only the name is required. No network needed.'}
      </Text>
      <OutlineButton
        label={attaching ? 'Save nutrition' : 'Log it'}
        onPress={add}
        style={{ marginTop: 12 }}
      />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  input: {
    fontFamily: font.regular,
    fontSize: 13.5,
    color: colors.text,
    minHeight: 42,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    gap: 6,
  },
  small: {
    flex: 1,
    paddingHorizontal: 8,
  },
  hint: {
    fontFamily: font.regular,
    fontSize: 11.5,
    color: colors.neutral600,
    marginTop: 2,
  },
});
