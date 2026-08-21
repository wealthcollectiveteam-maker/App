import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { BottomSheet } from '@/components/BottomSheet';
import { Kicker, OutlineButton } from '@/components/ui';
import { useAppStore } from '@/store/useAppStore';
import { toast } from '@/store/useToastStore';
import { colors, font, radius } from '@/theme/tokens';

/**
 * QUICK ADD — the escape hatch. Name + calories (macros optional), no
 * search, no network. Guarantees meal logging is never a dead end: works
 * on a plane, takes eight seconds.
 */
export function QuickAddSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const logMeal = useAppStore((s) => s.logMeal);
  const attachNutrition = useAppStore((s) => s.attachNutrition);

  const [name, setName] = useState('');
  const [calories, setCalories] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');

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
    const trimmed = name.trim();
    if (!trimmed) {
      toast('Give it a name');
      return;
    }
    const meal = logMeal(trimmed);
    const kcal = num(calories);
    if (kcal > 0) {
      attachNutrition(meal.id, {
        calories: Math.round(kcal),
        protein: num(protein),
        carbs: num(carbs),
        fat: num(fat),
        quickAdd: true,
      });
    }
    toast(kcal > 0 ? `Logged — ${Math.round(kcal)} cal` : 'Logged');
    reset();
    onClose();
  };

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Kicker style={{ marginBottom: 10 }}>Quick add</Kicker>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="What did you eat?"
        placeholderTextColor={colors.neutral600}
        style={styles.input}
      />
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
      <Text style={styles.hint}>Only the name is required. No network needed.</Text>
      <OutlineButton label="Log it" onPress={add} style={{ marginTop: 12 }} />
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
