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

import { MealBuilderSheet } from '@/components/MealBuilderSheet';
import { Micro, Serif, Skew, TheWall } from '@/components/primitives';
import { QuickAddSheet } from '@/components/QuickAddSheet';
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
  const durationDays = useAppStore((s) => s.durationDays);
  const dayComplete = useAppStore((s) => s.dayComplete);
  const journal = useAppStore((s) => s.journal);
  const saveJournal = useAppStore((s) => s.saveJournal);
  const [draft, setDraft] = useState('');

  // Days finished BEFORE today, plus today once it is sealed. Nothing here
  // invents a per-day history the app does not keep.
  const doneDays = Math.max(0, day - 1) + (dayComplete ? 1 : 0);
  const today = journal.filter((e) => e.day === day);
  const earlier = journal.filter((e) => e.day !== day);

  const save = () => {
    const text = draft.trim();
    if (!text) return;
    saveJournal(text);
    setDraft('');
    toast('+10 XP — entry saved');
  };

  return (
    <View style={{ gap: 14 }}>
      <Card>
        <TheWall day={day} doneDays={doneDays} total={durationDays} />
      </Card>

      <Card>
        <View style={styles.entryHeader}>
          <Micro color={colors.textMid}>
            Day {String(day).padStart(2, '0')} — Today{'’'}s entry
          </Micro>
          {today.length > 0 && (
            <Micro size={10} color={colors.textLow}>
              {relativeTime(today[0].timestamp)}
            </Micro>
          )}
        </View>

        {today.length === 0 ? (
          <Serif style={{ marginTop: 14, color: colors.textLow }}>
            Nothing written yet. Day {day} is a good place to start.
          </Serif>
        ) : (
          today.map((e) => (
            <Serif key={e.id} size={20} style={{ marginTop: 14 }}>
              {'“'}
              {e.text}
              {'”'}
            </Serif>
          ))
        )}

        <View style={styles.entryDivider} />

        <View style={styles.saveRow}>
          <TextInput
            multiline
            value={draft}
            onChangeText={setDraft}
            placeholder="How did today go?"
            placeholderTextColor={colors.textLow}
            style={styles.textarea}
          />
          <Skew label="Save entry" onPress={save} />
        </View>
      </Card>

      {earlier.map((e) => (
        <Card key={e.id}>
          <View style={styles.entryHeader}>
            <Micro color={colors.textMid}>
              Day {String(e.day).padStart(2, '0')}
            </Micro>
            <Micro size={10} color={colors.textLow}>
              {relativeTime(e.timestamp)}
            </Micro>
          </View>
          <Serif style={{ marginTop: 10 }}>{e.text}</Serif>
        </Card>
      ))}
    </View>
  );
}

function MealsTab() {
  const meals = useAppStore((s) => s.meals);
  const logMeal = useAppStore((s) => s.logMeal);
  const day = useAppStore((s) => s.day);
  const savedMeals = useAppStore((s) => s.savedMeals);
  const logSavedMeal = useAppStore((s) => s.logSavedMeal);
  // People eat the same meals on repeat: the last 8 distinct, one tap each.
  const recent = selectRecentMeals(meals).slice(0, 8);
  const [draft, setDraft] = useState('');
  const [nutritionMeal, setNutritionMeal] = useState<Meal | null>(null);
  const [quickAddOpen, setQuickAddOpen] = useState(false);

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
        <OutlineButton
          label="Quick add"
          small
          tone="neutral"
          onPress={() => setQuickAddOpen(true)}
          style={{ minHeight: 42 }}
        />
      </View>

      {savedMeals.length > 0 && (
        <View>
          <Kicker color={colors.neutral500} style={{ marginBottom: 8 }}>
            Saved meals — one tap
          </Kicker>
          <View style={styles.chipsWrap}>
            {savedMeals.map((sm) => (
              <Pressable
                key={sm.id}
                onPress={() => {
                  logSavedMeal(sm.id);
                  toast(`Logged — ${sm.nutrition.calories} cal`);
                }}
                style={({ hovered, pressed }: any) => [
                  styles.mealChip,
                  { borderColor: colors.accent800 },
                  (hovered || pressed) && { borderColor: colors.accent500 },
                ]}
              >
                <Text style={styles.mealChipText}>
                  {sm.name} · {sm.nutrition.calories} cal
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

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

      <MealBuilderSheet
        meal={nutritionMeal}
        onClose={() => setNutritionMeal(null)}
      />
      <QuickAddSheet
        visible={quickAddOpen}
        onClose={() => setQuickAddOpen(false)}
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
        <View style={styles.header}>
          <Text style={styles.title}>Track</Text>
          <SegmentedControl
            segments={['JOURNAL', 'MEALS', 'MILESTONES']}
            value={tab}
            onChange={setTab}
          />
        </View>
        {tab === 'JOURNAL' && <JournalTab />}
        {tab === 'MEALS' && <MealsTab />}
        {tab === 'MILESTONES' && <MilestonesTab />}
        {/* Health readings sit under the tab content: on-device only, and
            never the loudest thing on the screen. */}
        <View style={{ marginTop: 16, gap: 12 }}>
          <TodaysHealthCard />
          <WeeklyCheckinCard />
        </View>
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
  header: {
    flexDirection: 'row',
    // flex-end, not baseline: the tab underline is a View, which has no
    // baseline to align to.
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 18,
  },
  title: {
    fontFamily: font.bold,
    fontSize: 32,
    letterSpacing: -1,
    color: colors.textHi,
  },
  entryDivider: {
    height: 1,
    backgroundColor: colors.line,
    marginTop: 22,
  },
  saveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 14,
  },
  textarea: {
    flex: 1,
    fontFamily: font.regular,
    fontSize: 15,
    color: colors.textHi,
    minHeight: 44,
    paddingVertical: 8,
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
