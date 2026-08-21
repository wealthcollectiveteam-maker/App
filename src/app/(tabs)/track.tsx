import * as Clipboard from 'expo-clipboard';
import { useFocusEffect } from 'expo-router';
import {
  CheckCircleIcon as CheckCircle,
  CircleIcon as Circle,
  ForkKnifeIcon as ForkKnife,
} from 'phosphor-react-native';
import React, { useCallback, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { NutritionSheet } from '@/components/NutritionSheet';
import { ScreenState } from '@/components/ScreenState';
import { TodaysHealthCard } from '@/components/TodaysHealthCard';
import {
  Card,
  Kicker,
  OutlineButton,
  SegmentedControl,
} from '@/components/ui';
import { WeeklyCheckinCard } from '@/components/WeeklyCheckinCard';
import type { Meal } from '@/data/types';
import {
  formatClock,
  relativeTime,
  selectRecentMeals,
  useAppStore,
} from '@/store/useAppStore';
import { toast } from '@/store/useToastStore';
import { colors, font, radius, space } from '@/theme/tokens';

function JournalTab() {
  const day = useAppStore((s) => s.day);
  const journal = useAppStore((s) => s.journal);
  const saveJournal = useAppStore((s) => s.saveJournal);
  const [draft, setDraft] = useState('');

  return (
    <View style={{ gap: 12 }}>
      <Card>
        <Kicker>Day {day} — Today{'\u2019'}s entry</Kicker>
        <TextInput
          multiline
          numberOfLines={3}
          value={draft}
          onChangeText={setDraft}
          placeholder="How did today go?"
          placeholderTextColor={colors.neutral600}
          style={styles.textarea}
        />
        <OutlineButton
          label="Save entry"
          onPress={() => {
            const text = draft.trim();
            if (!text) return;
            saveJournal(text);
            setDraft('');
            toast('+10 XP — entry saved');
          }}
          style={{ marginTop: 12 }}
        />
      </Card>

      {journal.length === 0 ? (
        <Text style={styles.empty}>
          No entries yet. Day {day} is a good place to start.
        </Text>
      ) : (
        journal.map((e) => (
          <Card key={e.id}>
            <View style={styles.entryHeader}>
              <Kicker color={colors.accent300}>Day {e.day}</Kicker>
              <Text style={styles.timeMeta}>{relativeTime(e.timestamp)}</Text>
            </View>
            <Text style={styles.entryBody}>{e.text}</Text>
          </Card>
        ))
      )}
    </View>
  );
}

function MealsTab() {
  const meals = useAppStore((s) => s.meals);
  const logMeal = useAppStore((s) => s.logMeal);
  const day = useAppStore((s) => s.day);
  const recent = selectRecentMeals(meals);
  const [draft, setDraft] = useState('');
  const [nutritionMeal, setNutritionMeal] = useState<Meal | null>(null);

  const log = (text: string) => {
    const t = text.trim();
    if (!t) return;
    const meal = logMeal(t);
    toast(
      meal.nutrition
        ? `Logged — ${meal.nutrition.calories} cal carried over`
        : `Logged — ${formatClock()}`,
    );
  };

  const withNutrition = meals.filter((m) => m.nutrition);
  const totals = withNutrition.reduce(
    (acc, m) => ({
      calories: acc.calories + m.nutrition!.calories,
      protein: acc.protein + m.nutrition!.protein,
      carbs: acc.carbs + m.nutrition!.carbs,
      fat: acc.fat + m.nutrition!.fat,
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );

  const copyToday = async () => {
    const lines = [...meals]
      .reverse()
      .map(
        (m) =>
          `${formatClock(m.timestamp)} — ${m.text}` +
          (m.nutrition
            ? ` (${m.nutrition.calories} cal · ${Math.round(m.nutrition.protein)}P · ${Math.round(m.nutrition.carbs)}C · ${Math.round(m.nutrition.fat)}F)`
            : ''),
      );
    const text = `Day ${day} — meals\n${lines.join('\n')}`;
    if (Platform.OS === 'web') {
      await Clipboard.setStringAsync(text);
      toast('Meals copied');
    } else {
      try {
        await Share.share({ message: text });
      } catch {
        await Clipboard.setStringAsync(text);
        toast('Meals copied');
      }
    }
  };

  return (
    <View style={{ gap: 14 }}>
      <View style={styles.inlineForm}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="What did you eat?"
          placeholderTextColor={colors.neutral600}
          style={[styles.input, { flex: 1 }]}
          onSubmitEditing={() => {
            log(draft);
            setDraft('');
          }}
        />
        <OutlineButton
          label="Log"
          small
          onPress={() => {
            log(draft);
            setDraft('');
          }}
          style={{ minHeight: 42 }}
        />
      </View>

      {recent.length > 0 && (
        <View>
          <Kicker color={colors.neutral500} style={{ marginBottom: 8 }}>
            Recent — tap to log again
          </Kicker>
          <View style={styles.chipsWrap}>
            {recent.map((r) => (
              <Pressable
                key={r}
                onPress={() => log(r)}
                style={({ hovered, pressed }: any) => [
                  styles.mealChip,
                  (hovered || pressed) && { borderColor: colors.accent500 },
                ]}
              >
                <Text style={styles.mealChipText}>{r}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      <View>
        <Kicker color={colors.neutral500} style={{ marginBottom: 8 }}>
          Today
        </Kicker>
        {withNutrition.length > 0 && (
          <Text style={styles.totalsLine}>
            {totals.calories.toLocaleString()} cal ·{' '}
            {Math.round(totals.protein)}g protein · {Math.round(totals.carbs)}g
            carbs · {Math.round(totals.fat)}g fat
          </Text>
        )}
        {meals.length === 0 ? (
          <Text style={styles.empty}>Nothing logged yet. Fuel counts too.</Text>
        ) : (
          meals.map((m) => (
            <View key={m.id} style={styles.mealRow}>
              <ForkKnife size={16} color={colors.neutral500} />
              <Text style={styles.mealText}>{m.text}</Text>
              {m.nutrition ? (
                <Pressable onPress={() => setNutritionMeal(m)} hitSlop={6}>
                  <Text style={styles.calFigure}>
                    {m.nutrition.calories} cal
                  </Text>
                </Pressable>
              ) : (
                <Pressable onPress={() => setNutritionMeal(m)} hitSlop={6}>
                  <Text style={styles.addNutrition}>+ nutrition</Text>
                </Pressable>
              )}
              <Text style={styles.timeMeta}>{formatClock(m.timestamp)}</Text>
            </View>
          ))
        )}
        {meals.length > 0 && (
          <OutlineButton
            label="Copy today's meals"
            tone="neutral"
            small
            onPress={copyToday}
            style={{ marginTop: 10, alignSelf: 'flex-start' }}
          />
        )}
      </View>

      <NutritionSheet
        meal={nutritionMeal}
        onClose={() => setNutritionMeal(null)}
      />
    </View>
  );
}

function MilestonesTab() {
  const milestones = useAppStore((s) => s.milestones);
  const addMilestone = useAppStore((s) => s.addMilestone);
  const toggleMilestone = useAppStore((s) => s.toggleMilestone);
  const [draft, setDraft] = useState('');

  const add = () => {
    const t = draft.trim();
    if (!t) return;
    addMilestone(t);
    setDraft('');
  };

  return (
    <View style={{ gap: 14 }}>
      <View style={styles.inlineForm}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Add a milestone — e.g. Run a 10K"
          placeholderTextColor={colors.neutral600}
          style={[styles.input, { flex: 1 }]}
          onSubmitEditing={add}
        />
        <OutlineButton label="Add" small onPress={add} style={{ minHeight: 42 }} />
      </View>

      <View>
        {milestones.map((m) => (
          <Pressable
            key={m.id}
            onPress={() => {
              if (!m.done) toast('+50 XP — milestone hit');
              toggleMilestone(m.id);
            }}
            style={styles.milestoneRow}
          >
            {m.done ? (
              <CheckCircle size={22} weight="fill" color={colors.accent500} />
            ) : (
              <Circle size={22} color={colors.neutral600} />
            )}
            <View style={{ flex: 1 }}>
              <Text
                style={[
                  styles.milestoneTitle,
                  m.done && {
                    textDecorationLine: 'line-through',
                    color: colors.neutral500,
                  },
                ]}
              >
                {m.title}
              </Text>
              {m.meta && <Text style={styles.milestoneMeta}>{m.meta}</Text>}
            </View>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export default function TrackScreen() {
  const [tab, setTab] = useState('JOURNAL');
  const refreshHealth = useAppStore((s) => s.refreshHealth);

  // Refresh Health readings when the screen gains focus (no polling).
  useFocusEffect(
    useCallback(() => {
      refreshHealth().catch(() => {});
    }, [refreshHealth]),
  );

  return (
    <ScreenState>
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.bg }}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Track</Text>
        <TodaysHealthCard />
        <WeeklyCheckinCard />
        <SegmentedControl
          segments={['JOURNAL', 'MEALS', 'MILESTONES']}
          value={tab}
          onChange={setTab}
          style={{ marginBottom: 16 }}
        />
        {tab === 'JOURNAL' && <JournalTab />}
        {tab === 'MEALS' && <MealsTab />}
        {tab === 'MILESTONES' && <MilestonesTab />}
      </ScrollView>
    </ScreenState>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: space.screenX,
    paddingTop: 8,
    paddingBottom: 28,
  },
  title: {
    fontFamily: font.medium,
    fontSize: 24,
    color: colors.text,
    marginBottom: 14,
  },
  textarea: {
    fontFamily: font.regular,
    fontSize: 13.5,
    color: colors.text,
    minHeight: 72,
    marginTop: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.sm,
    textAlignVertical: 'top',
  },
  input: {
    fontFamily: font.regular,
    fontSize: 13.5,
    color: colors.text,
    minHeight: 42,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  inlineForm: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'stretch',
  },
  empty: {
    fontFamily: font.regular,
    fontSize: 12.5,
    color: colors.neutral500,
    paddingVertical: 10,
  },
  entryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  entryBody: {
    fontFamily: font.regular,
    fontSize: 13.5,
    color: colors.neutral300,
    lineHeight: 19,
  },
  timeMeta: {
    fontFamily: font.regular,
    fontSize: 11,
    color: colors.neutral600,
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  mealChip: {
    borderWidth: 1,
    borderColor: colors.neutral700,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  mealChipText: {
    fontFamily: font.regular,
    fontSize: 12,
    color: colors.neutral300,
  },
  mealRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 42,
  },
  mealText: {
    flex: 1,
    fontFamily: font.regular,
    fontSize: 13.5,
    color: colors.text,
  },
  totalsLine: {
    fontFamily: font.regular,
    fontSize: 12,
    color: colors.neutral400,
    marginBottom: 8,
    fontVariant: ['tabular-nums'],
  },
  calFigure: {
    fontFamily: font.medium,
    fontSize: 12,
    color: colors.accent300,
    fontVariant: ['tabular-nums'],
  },
  addNutrition: {
    fontFamily: font.regular,
    fontSize: 11.5,
    color: colors.neutral600,
  },
  milestoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 44,
    paddingVertical: 4,
  },
  milestoneTitle: {
    fontFamily: font.regular,
    fontSize: 14,
    color: colors.text,
  },
  milestoneMeta: {
    fontFamily: font.regular,
    fontSize: 11,
    color: colors.accent400,
    marginTop: 2,
  },
});
