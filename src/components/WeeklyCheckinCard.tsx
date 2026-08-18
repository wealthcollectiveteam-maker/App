import { XIcon as X } from 'phosphor-react-native';
import React, { useEffect, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Card, Kicker, OutlineButton } from '@/components/ui';
import { localWeekKey, useAppStore } from '@/store/useAppStore';
import { toast } from '@/store/useToastStore';
import { colors, font, radius } from '@/theme/tokens';

const MOODS = ['Rough', 'Low', 'Okay', 'Good', 'Strong'];

/**
 * Optional weekly weight+mood check-in. Dismissible, never pushed,
 * permanently disableable from settings. Weight pre-fills from Apple
 * Health when available — editable, never silently overwritten.
 * This data is private to the owner and never shown to squadmates.
 */
export function WeeklyCheckinCard() {
  const weeklyCheckinEnabled = useAppStore((s) => s.weeklyCheckinEnabled);
  const checkinHandledWeek = useAppStore((s) => s.checkinHandledWeek);
  const healthPrefs = useAppStore((s) => s.healthPrefs);
  const bodyMassKg = useAppStore((s) => s.healthReadings.bodyMassKg);
  const saveMetricCheckin = useAppStore((s) => s.saveMetricCheckin);
  const dismissCheckinCard = useAppStore((s) => s.dismissCheckinCard);

  const prefill =
    healthPrefs.healthEnabled && healthPrefs.weightPrefillEnabled
      ? bodyMassKg
      : null;

  const [weight, setWeight] = useState(prefill != null ? String(prefill) : '');
  const [touched, setTouched] = useState(false);
  const [mood, setMood] = useState<number | null>(null);

  // Pre-fill arrives async from Health; apply only if the user hasn't typed.
  useEffect(() => {
    if (!touched && prefill != null) setWeight(String(prefill));
  }, [prefill, touched]);

  if (!weeklyCheckinEnabled) return null;
  if (checkinHandledWeek === localWeekKey()) return null;

  return (
    <Card style={{ marginBottom: 14 }}>
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
          keyboardType="numeric"
          placeholder="Weight"
          placeholderTextColor={colors.neutral600}
          style={styles.input}
        />
        <Text style={styles.unit}>kg</Text>
        {prefill != null && !touched && (
          <Text style={styles.prefillNote}>from Apple Health — editable</Text>
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
                style={[
                  styles.moodText,
                  active && { color: colors.accent200 },
                ]}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <OutlineButton
        label="Save check-in"
        small
        onPress={() => {
          const w = parseFloat(weight);
          saveMetricCheckin(Number.isFinite(w) ? w : null, mood);
          toast('Check-in saved');
        }}
        style={{ marginTop: 12, alignSelf: 'flex-start' }}
      />
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
});
