import { Redirect, useRouter } from 'expo-router';
import { CaretLeftIcon as CaretLeft } from 'phosphor-react-native';
import React from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  BeforeNowRow,
  EmptyLine,
  PatternLine,
  Section,
  proofStyles,
} from '@/components/ProofBits';
import { TodaysHealthCard } from '@/components/TodaysHealthCard';
import { OutlineButton } from '@/components/ui';
import { useProofModel } from '@/hooks/useProofModel';
import { COPY, formatMetric, type Report } from '@/lib/proof';
import { formatHoursMinutes } from '@/lib/sleepNight';
import { useAppStore } from '@/store/useAppStore';
import { colors, font } from '@/theme/tokens';

/**
 * PROOF (Phase 38O). The challenge as an experiment on one person: before /
 * now against the two weeks before Day 1, load and recovery against the
 * person's own baseline, patterns in their own days, and the two reports.
 *
 * Native only: it reads Apple Health on the phone. On the web the route
 * sends the visitor home, and nothing links here. Everything on screen is
 * computed on each focus and held in component state (hooks/useProofModel).
 */
export default function ProofScreen() {
  if (Platform.OS === 'web') return <Redirect href="/" />;
  return <ProofBody />;
}

function ReportRow({ r, onOpen }: { r: Report; onOpen: () => void }) {
  return (
    <View style={styles.reportRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.reportTitle}>{r.title}</Text>
        {!r.unlocked ? (
          <Text style={styles.reportSub}>{COPY.reportLocked(r.title, r.unlockDay)}</Text>
        ) : r.empty ? (
          <Text style={styles.reportSub}>{COPY.reportNothing}</Text>
        ) : null}
      </View>
      {r.unlocked && !r.empty ? <OutlineButton label={COPY.reportOpen} small onPress={onOpen} /> : null}
    </View>
  );
}

function ProofBody() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const unit = useAppStore((s) => s.unitPreference);
  const { status, model } = useProofModel();

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={[proofStyles.content, { paddingTop: insets.top + 10 }]}
    >
      <View style={proofStyles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <CaretLeft size={20} color={colors.neutral400} />
        </Pressable>
        <Text style={proofStyles.title}>{COPY.title}</Text>
        <View style={{ width: 20 }} />
      </View>
      <Text style={proofStyles.subtitle}>{COPY.subtitle}</Text>

      {status === 'not-connected' ? (
        <View style={{ marginTop: 18 }}>
          <TodaysHealthCard />
        </View>
      ) : null}
      {status === 'idle' || status === 'reading' ? (
        <Text style={proofStyles.reading}>{COPY.reading}</Text>
      ) : null}
      {status === 'error' ? <Text style={proofStyles.reading}>Apple Health could not be read just now.</Text> : null}

      {status === 'ready' && model ? (
        <>
          {/* BEFORE / NOW */}
          <Section title={COPY.beforeNow} intro={COPY.beforeNowIntro}>
            {model.beforeNow.some((m) => m.baseline && m.now) ? (
              <>
                {model.beforeNow.map((m) => (
                  <BeforeNowRow key={m.key} m={m} unit={unit} />
                ))}
                {model.beforeNow.some((m) => m.baseline && !m.now) ? (
                  <Text style={styles.note}>
                    {COPY.noNowData} {model.beforeNow.filter((m) => m.baseline && !m.now).map((m) => m.label).join(', ')}.
                  </Text>
                ) : null}
                {model.beforeNow.some((m) => !m.baseline) ? (
                  <Text style={styles.note}>
                    {COPY.noBaseline} {model.beforeNow.filter((m) => !m.baseline).map((m) => m.label).join(', ')}.
                  </Text>
                ) : null}
              </>
            ) : (
              <EmptyLine text={COPY.noBaselineAny} />
            )}
          </Section>

          {/* LOAD & RECOVERY */}
          <Section title={COPY.loadRecovery} intro={COPY.loadIntro}>
            {(() => {
              const latest = model.load[model.load.length - 1];
              const anyLoad = model.load.some((p) => p.minutes != null && p.minutes > 0);
              return anyLoad && latest ? (
                <View style={styles.loadRow}>
                  <Text style={styles.loadValue}>
                    {latest.minutes != null ? formatHoursMinutes(Math.round(latest.minutes)) : '—'}
                  </Text>
                  <Text style={styles.small}>
                    workouts in the last 7 days · {COPY.days(latest.n)} with a value
                  </Text>
                  <View style={styles.loadBars}>
                    {model.load.slice(-14).map((p) => {
                      const max = Math.max(1, ...model.load.slice(-14).map((x) => x.minutes ?? 0));
                      return (
                        <View key={p.dateKey} style={styles.loadCol}>
                          <View
                            style={[
                              styles.loadBar,
                              { height: p.minutes ? Math.max(2, Math.round((p.minutes / max) * 26)) : 2 },
                            ]}
                          />
                        </View>
                      );
                    })}
                  </View>
                  <Text style={styles.small}>Each bar is one day{'’'}s rolling 7-day total, last 14 days.</Text>
                </View>
              ) : (
                <EmptyLine text={COPY.loadNoWorkouts} />
              );
            })()}
            <View style={styles.recovery}>
              {!model.recoveryHasBaseline ? (
                <EmptyLine text={COPY.recoveryNoBaseline} />
              ) : model.observations.length ? (
                model.observations.map((o) => (
                  <Text key={o.kind} style={styles.observation}>
                    {o.text}
                  </Text>
                ))
              ) : (
                <EmptyLine text={COPY.recoveryQuiet} />
              )}
              {model.beforeNow
                .filter((m) => (m.key === 'rhr' || m.key === 'hrv') && m.baseline && m.now)
                .map((m) => (
                  <Text key={m.key} style={styles.small}>
                    {m.label}: {formatMetric(m.key, m.now!.value, unit)} over the last {COPY.days(m.now!.n)},
                    against {formatMetric(m.key, m.baseline!.value, unit)} before Day 1 ({COPY.days(m.baseline!.n)}).
                  </Text>
                ))}
            </View>
          </Section>

          {/* WHAT MOVES ME */}
          <Section title={COPY.patterns} intro={COPY.patternsIntro}>
            {model.patterns.length ? (
              <>
                {model.patterns.map((p) => (
                  <PatternLine key={p.key} p={p} />
                ))}
                <Text style={styles.caveat}>{COPY.patternsCaveat}</Text>
              </>
            ) : (
              <EmptyLine text={COPY.patternsNone} />
            )}
          </Section>

          {/* REPORTS */}
          <Section title={COPY.reports}>
            <ReportRow r={model.halfway} onOpen={() => router.push('/proof-report?kind=halfway')} />
            <ReportRow r={model.final} onOpen={() => router.push('/proof-report?kind=final')} />
          </Section>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  note: { fontFamily: font.regular, fontSize: 12, lineHeight: 17, color: colors.textLow, marginTop: 10 },
  small: { fontFamily: font.regular, fontSize: 11.5, lineHeight: 16, color: colors.textLow, marginTop: 4 },
  loadRow: {},
  loadValue: { fontFamily: font.bold, fontSize: 22, letterSpacing: -0.5, color: colors.textHi },
  loadBars: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 26, marginTop: 10 },
  loadCol: { flex: 1, justifyContent: 'flex-end' },
  loadBar: { width: '100%', backgroundColor: colors.accent400, borderRadius: 1 },
  recovery: { marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.neutral800 },
  observation: { fontFamily: font.medium, fontSize: 13.5, lineHeight: 19, color: colors.text, marginBottom: 6 },
  caveat: { fontFamily: font.regular, fontSize: 11.5, color: colors.textLow, marginTop: 10 },
  reportRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  reportTitle: { fontFamily: font.semibold, fontSize: 14, color: colors.textHi },
  reportSub: { fontFamily: font.regular, fontSize: 12, color: colors.textLow, marginTop: 2 },
});
