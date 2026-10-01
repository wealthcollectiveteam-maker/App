import { useRouter } from 'expo-router';
import { CaretRightIcon as CaretRight, XIcon as X } from 'phosphor-react-native';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';

import { Card, Kicker, OutlineButton } from '@/components/ui';
import { checkinCardState } from '@/lib/checkinCard';
import type { WeightVerdict } from '@/lib/units';
import {
  MAX_PLAUSIBLE_KG,
  MIN_PLAUSIBLE_KG,
  checkWeightEntry,
  formatWeight,
  formatWeightValue,
  weightProblemMessage,
  weightUnitLabel,
} from '@/lib/units';
import {
  localWeekKey,
  selectWeightPrefillKg,
  useAppStore,
} from '@/store/useAppStore';
import { toast } from '@/store/useToastStore';
import { formatCalendar } from '@/lib/intl';
import { colors, font, radius } from '@/theme/tokens';

const MOODS = ['Rough', 'Low', 'Okay', 'Good', 'Strong'];

/**
 * Optional weekly weight+mood check-in. Dismissible, never pushed,
 * permanently disableable from settings. Weight pre-fills from Apple
 * Health when a sample from the last 7 days exists — editable, never
 * silently overwritten. Input/display follow the unit preference; storage
 * is ALWAYS canonical kg via lib/units.ts. Private to the owner.
 */
export function WeeklyCheckinCard() {
  const router = useRouter();
  const weeklyCheckinEnabled = useAppStore((s) => s.weeklyCheckinEnabled);
  const checkinHandledWeek = useAppStore((s) => s.checkinHandledWeek);
  const unitPreference = useAppStore((s) => s.unitPreference);
  const metricCheckins = useAppStore((s) => s.metricCheckins);
  const saveMetricCheckin = useAppStore((s) => s.saveMetricCheckin);
  const dismissCheckinCard = useAppStore((s) => s.dismissCheckinCard);
  const reopenCheckinCard = useAppStore((s) => s.reopenCheckinCard);
  // Only a Health sample from the last 7 days pre-fills (older = stale).
  const prefill = useAppStore(useShallow(selectWeightPrefillKg));
  const prefillKg = prefill?.kg ?? null;

  const [weight, setWeight] = useState(
    prefillKg != null ? formatWeightValue(prefillKg, unitPreference) : '',
  );
  const [touched, setTouched] = useState(false);
  const [mood, setMood] = useState<number | null>(null);
  // Non-null while the entry looks like the wrong unit and we are asking.
  const [query, setQuery] = useState<Extract<
    WeightVerdict,
    { kind: 'ambiguous' }
  > | null>(null);

  // Pre-fill arrives async from Health; apply only if the user hasn't typed.
  useEffect(() => {
    if (!touched && prefillKg != null) {
      setWeight(formatWeightValue(prefillKg, unitPreference));
    }
  }, [prefillKg, touched, unitPreference]);

  const openHistory = () => router.push('/metrics-history');

  // WHAT TO SHOW is decided in lib/checkinCard.ts, not here. It used to be a
  // run of early `return null`s in this file, and one of them — the weightless
  // check-in below — took the whole card off the screen for a week with no
  // test able to see it. The rule it now holds: switched off is the ONLY
  // reason to render nothing.
  const state = checkinCardState({
    enabled: weeklyCheckinEnabled,
    handledWeek: checkinHandledWeek,
    thisWeek: localWeekKey(),
    checkins: metricCheckins,
  });

  if (state.mode === 'hidden') return null;

  // Handled for this week: one row instead of the card, rendered through the
  // unit preference (history re-renders, storage never rewrites).
  //
  // The row is the way INTO the history, not a dead end. A weight entered in
  // the wrong unit is usually noticed weeks later, by which time it is not
  // the most recent entry — so "edit the last one" would never reach it, and
  // this has to open the whole list.
  //
  // And it always carries a way BACK to the entry form. Checking in twice in
  // a week is allowed — the rows are timestamped and the history holds both —
  // so "already done this week" is a default, never a lock.
  if (state.mode === 'summary') {
    return (
      <View testID="weekly-checkin-card" style={styles.lastRow}>
        <Pressable
          onPress={state.hasHistory ? openHistory : undefined}
          style={styles.lastRowMain}
          disabled={!state.hasHistory}
          accessibilityRole={state.hasHistory ? 'button' : undefined}
          accessibilityLabel={state.hasHistory ? 'Check-in history' : undefined}
        >
          <Text style={styles.lastLine}>
            {state.lastWeightKg != null && state.lastAt != null
              ? `Last check-in: ${formatWeight(state.lastWeightKg, unitPreference)} · ` +
                formatCalendar(new Date(state.lastAt), { month: 'short', day: 'numeric' })
              : // A mood-only check-in has no weight to read back. Saying so is
                // the honest version of what used to be an empty screen.
                'Checked in this week — no weight recorded.'}
          </Text>
          {state.hasHistory && <CaretRight size={13} color={colors.neutral600} />}
        </Pressable>
        <Pressable
          onPress={reopenCheckinCard}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Add another check-in"
        >
          <Text style={styles.historyLink}>New entry</Text>
        </Pressable>
      </View>
    );
  }

  const commit = (kg: number | null) => {
    saveMetricCheckin(kg, mood);
    toast('Check-in saved');
  };

  const onSave = () => {
    const verdict = checkWeightEntry(weight, unitPreference);
    switch (verdict.kind) {
      case 'ok':
        return commit(verdict.kg);
      // A blank field is a mood-only check-in, which has always been allowed.
      case 'empty':
        return commit(null);
      // Anything typed that is not a weight is a mistake, not a blank — and
      // each way of being wrong gets its own sentence rather than one
      // catch-all that leaves the user guessing which character broke it.
      case 'malformed':
        return toast(weightProblemMessage(verdict.problem, unitPreference));
      case 'implausible':
        return toast(
          `A weight has to be between ${formatWeight(
            MIN_PLAUSIBLE_KG,
            unitPreference,
          )} and ${formatWeight(MAX_PLAUSIBLE_KG, unitPreference)}.`,
        );
      // Never saved on the spot: the number is plausible in the OTHER unit,
      // so only the user can settle which one they meant.
      case 'ambiguous':
        return setQuery(verdict);
    }
  };

  return (
    <Card testID="weekly-checkin-card" style={{ marginBottom: 14 }}>
      <View style={styles.header}>
        <Kicker>Weekly check-in — optional</Kicker>
        <Pressable onPress={dismissCheckinCard} hitSlop={10}>
          <X size={14} color={colors.neutral500} />
        </Pressable>
      </View>
      <Text style={styles.sub}>
        Just your starting line moving. Private to you — squadmates never see
        it.
      </Text>

      <View style={styles.weightRow}>
        <TextInput
          value={weight}
          onChangeText={(t) => {
            setTouched(true);
            setWeight(t);
          }}
          // decimal-pad, not numeric: on iOS "numeric" is the phone-style
          // pad with no decimal separator on it at all, so a weight with a
          // decimal in it was literally untypeable on the device this ships
          // to. decimal-pad puts the separator on the key row, and the OS
          // chooses whether that key is a point or a comma for the user's
          // locale — which is why the parser accepts both.
          keyboardType="decimal-pad"
          inputMode="decimal"
          placeholder={`Weight (${weightUnitLabel(unitPreference)})`}
          placeholderTextColor={colors.neutral600}
          style={styles.input}
          maxLength={6}
          accessibilityLabel={`Weight in ${
            unitPreference === 'imperial' ? 'pounds' : 'kilograms'
          }, one decimal place`}
        />
        <Text style={styles.unit}>{weightUnitLabel(unitPreference)}</Text>
        {prefill != null && !touched && (
          <Text style={styles.prefillNote}>
            From Apple Health ·{' '}
            {formatCalendar(new Date(prefill.dateISO), { month: 'short', day: 'numeric' })}{' '}
            — editable
          </Text>
        )}
      </View>

      <View style={styles.moodRow}>
        {MOODS.map((label, i) => {
          const active = mood === i + 1;
          return (
            <Pressable
              key={label}
              onPress={() => setMood(active ? null : i + 1)}
              style={[
                styles.moodPill,
                active && {
                  borderColor: colors.accent500,
                  backgroundColor: colors.accentTint,
                },
              ]}
            >
              <Text
                style={[styles.moodText, active && { color: colors.accent200 }]}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* The guard, in the one place a wrong number can still get in. A user
          typed 203 meaning pounds into a field reading kilograms and it was
          stored in silence as 203 kg. There is no way to edit a saved
          check-in afterwards, so here is the only chance to catch it. */}
      {query && (
        <View style={styles.queryBox}>
          <Text style={styles.queryText}>
            {formatWeight(query.kg, unitPreference)} is a long way from
            ordinary. Did you mean{' '}
            {formatWeight(query.meantKg, query.meantUnit)}?
          </Text>
          <View style={styles.queryRow}>
            <OutlineButton
              label={`Yes — ${formatWeight(query.meantKg, query.meantUnit)}`}
              small
              onPress={() => {
                setQuery(null);
                commit(query.meantKg);
              }}
            />
            <OutlineButton
              label={`No — ${formatWeight(query.kg, unitPreference)}`}
              small
              tone="neutral"
              onPress={() => {
                setQuery(null);
                commit(query.kg);
              }}
            />
          </View>
        </View>
      )}

      <View style={styles.footerRow}>
        <OutlineButton label="Save check-in" small onPress={onSave} />
        {/* The line above only exists once this week's check-in is done, so
            without this the way into the history is missing for most of the
            week — which is most of the time someone notices a wrong one. */}
        {state.hasHistory && (
          <Pressable
            onPress={openHistory}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Check-in history"
          >
            <Text style={styles.historyLink}>Past check-ins</Text>
          </Pressable>
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sub: {
    fontFamily: font.regular,
    fontSize: 12,
    color: colors.neutral500,
    marginTop: 6,
    lineHeight: 17,
  },
  weightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  input: {
    fontFamily: font.regular,
    fontSize: 13.5,
    color: colors.text,
    minHeight: 40,
    width: 100,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
  },
  unit: {
    fontFamily: font.regular,
    fontSize: 13,
    color: colors.neutral400,
  },
  prefillNote: {
    flex: 1,
    fontFamily: font.regular,
    fontSize: 11,
    color: colors.neutral500,
    textAlign: 'right',
  },
  moodRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 12,
  },
  moodPill: {
    borderWidth: 1,
    borderColor: colors.neutral700,
    borderRadius: radius.pill,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  moodText: {
    fontFamily: font.regular,
    fontSize: 12,
    color: colors.neutral300,
  },
  queryBox: {
    marginTop: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: colors.accent700,
    borderRadius: radius.sm,
    backgroundColor: colors.accentTint,
  },
  queryText: {
    fontFamily: font.regular,
    fontSize: 12.5,
    color: colors.text,
    lineHeight: 18,
  },
  queryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  lastRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 12,
  },
  lastRowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  lastLine: {
    fontFamily: font.regular,
    fontSize: 11.5,
    color: colors.neutral500,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 12,
  },
  historyLink: {
    fontFamily: font.regular,
    fontSize: 11.5,
    color: colors.accent400,
  },
});
