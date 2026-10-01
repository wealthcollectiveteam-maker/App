import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { CaretLeftIcon as CaretLeft } from 'phosphor-react-native';
import React from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BeforeNowRow, EmptyLine, PatternLine, Section, proofStyles } from '@/components/ProofBits';
import { useProofModel } from '@/hooks/useProofModel';
import { COPY, clock } from '@/lib/proof';
import { formatHoursMinutes } from '@/lib/sleepNight';
import { useAppStore } from '@/store/useAppStore';
import { colors, font } from '@/theme/tokens';

/**
 * HALFWAY and DAY 75 (Phase 38O, O3). A one-screen summary built only from
 * the model: before / now for every metric with a baseline, total workout
 * time, nights logged, median bedtime and wake, and the strongest pattern if
 * one qualifies. Only what exists is rendered. Not shareable in this phase.
 */
export default function ProofReportScreen() {
  if (Platform.OS === 'web') return <Redirect href="/" />;
  return <ReportBody />;
}

function ReportBody() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { kind } = useLocalSearchParams<{ kind?: string }>();
  const unit = useAppStore((s) => s.unitPreference);
  const { status, model } = useProofModel();
  const r = model ? (kind === 'final' ? model.final : model.halfway) : null;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={[proofStyles.content, { paddingTop: insets.top + 10 }]}
    >
      <View style={proofStyles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <CaretLeft size={20} color={colors.neutral400} />
        </Pressable>
        <Text style={proofStyles.title}>{r ? r.title : COPY.title}</Text>
        <View style={{ width: 20 }} />
      </View>

      {status !== 'ready' || !r ? <Text style={proofStyles.reading}>{COPY.reading}</Text> : null}

      {r && !r.unlocked ? <Text style={proofStyles.reading}>{COPY.reportLocked(r.title, r.unlockDay)}</Text> : null}

      {r && r.unlocked && r.empty ? <Text style={proofStyles.reading}>{COPY.reportNothing}</Text> : null}

      {r && r.unlocked && !r.empty ? (
        <>
          {r.beforeNow.length ? (
            <Section title={COPY.beforeNow}>
              {r.beforeNow.map((m) => (
                <BeforeNowRow key={m.key} m={m} unit={unit} />
              ))}
              {r.withoutBaseline.length ? (
                <Text style={styles.note}>
                  {COPY.noBaseline} {r.withoutBaseline.join(', ')}.
                </Text>
              ) : null}
            </Section>
          ) : null}

          <Section title={COPY.loadRecovery}>
            {r.totalWorkoutMinutes != null ? (
              <View style={styles.stat}>
                <Text style={styles.statValue}>{formatHoursMinutes(Math.round(r.totalWorkoutMinutes))}</Text>
                <Text style={styles.statLabel}>
                  {COPY.totalWorkouts} · {COPY.days(r.workoutDays)}
                </Text>
              </View>
            ) : (
              <EmptyLine text={COPY.loadNoWorkouts} />
            )}
            {r.nightsLogged > 0 ? (
              <>
                <View style={styles.stat}>
                  <Text style={styles.statValue}>{r.nightsLogged}</Text>
                  <Text style={styles.statLabel}>{COPY.nightsLogged}</Text>
                </View>
                {r.medianBedtimeMinutes != null ? (
                  <View style={styles.stat}>
                    <Text style={styles.statValue}>{clock(r.medianBedtimeMinutes + 12 * 60)}</Text>
                    <Text style={styles.statLabel}>{COPY.medianBedtime}</Text>
                  </View>
                ) : null}
                {r.medianWakeMinutes != null ? (
                  <View style={styles.stat}>
                    <Text style={styles.statValue}>{clock(r.medianWakeMinutes)}</Text>
                    <Text style={styles.statLabel}>{COPY.medianWake}</Text>
                  </View>
                ) : null}
              </>
            ) : null}
          </Section>

          {r.topPattern ? (
            <Section title={COPY.topPattern}>
              <PatternLine p={r.topPattern} />
              <Text style={styles.caveat}>{COPY.patternsCaveat}</Text>
            </Section>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  note: { fontFamily: font.regular, fontSize: 12, lineHeight: 17, color: colors.textLow, marginTop: 10 },
  stat: { paddingVertical: 8 },
  statValue: { fontFamily: font.bold, fontSize: 22, letterSpacing: -0.5, color: colors.textHi },
  statLabel: { fontFamily: font.regular, fontSize: 12, color: colors.textLow, marginTop: 2 },
  caveat: { fontFamily: font.regular, fontSize: 11.5, color: colors.textLow, marginTop: 10 },
});
