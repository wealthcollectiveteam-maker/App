import { useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card, Kicker } from '@/components/ui';
import { formatClockIn, formatWater } from '@/lib/healthLinks';
import { formatInteger, wallClockIn } from '@/lib/intl';
import {
  dateKeyIn,
  formatHoursMinutes,
  sleepNightFor,
  type SleepNight,
  type SleepStage,
} from '@/lib/sleepNight';
import { getHealthService, type DiscreteSample } from '@/services/HealthService';
import { useAppStore } from '@/store/useAppStore';
import { colors, font, radius } from '@/theme/tokens';

/**
 * LAST NIGHT, RECOVERY, 7 DAYS (Phase 38N, N4). Rendered under the Today's
 * Health card on Track, only when Health is connected.
 *
 * Neutral numbers. No targets, no colour grading, no scores. Where a type has
 * nothing, the line says "No data in Apple Health" and never why — iOS does
 * not tell an app whether a type is denied, missing, or not shared by the
 * device that has it.
 *
 * PRIVACY: everything here is COMPONENT STATE, computed on the phone each
 * time the screen gains focus, and discarded with it. Nothing is written to
 * the store, to disk, to a log, or over the network.
 */

const WEEK_DAYS = 7;

interface RecoveryRow {
  key: string;
  label: string;
  unit: string;
  decimals: number;
  lastNight: number | null;
  /** True when no reading fell inside the night and the latest one is shown. */
  latest: boolean;
  weekAvg: number | null;
}

interface WeekRow {
  key: string;
  label: string;
  values: (number | null)[];
  format: (v: number) => string;
}

interface Insights {
  night: SleepNight | null;
  recovery: RecoveryRow[];
  week: WeekRow[];
  /** Weekday initials for the 7 columns, oldest first. */
  dayLabels: string[];
}

const RECOVERY_TYPES = [
  { key: 'HKQuantityTypeIdentifierRestingHeartRate', label: 'Resting heart rate', unit: 'bpm', decimals: 0 },
  { key: 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN', label: 'Heart rate variability', unit: 'ms', decimals: 0 },
  { key: 'HKQuantityTypeIdentifierRespiratoryRate', label: 'Respiratory rate', unit: '/min', decimals: 1 },
] as const;

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** The value for last night: the mean of samples during the night, else the latest within a day. */
function nightValue(samples: DiscreteSample[], night: SleepNight | null, now: number) {
  if (night) {
    const inNight = samples.filter(
      (s) => s.endMs >= night.bedtimeMs - 3_600_000 && s.endMs <= night.wakeMs + 3_600_000,
    );
    const m = mean(inNight.map((s) => s.value));
    if (m != null) return { value: m, latest: false };
  }
  const recent = samples.filter((s) => now - s.endMs <= 86_400_000).sort((a, b) => b.endMs - a.endMs);
  return recent.length ? { value: recent[0].value, latest: true } : { value: null, latest: false };
}

async function compute(zone: string | undefined, unitPreference: 'metric' | 'imperial'): Promise<Insights> {
  const service = getHealthService();
  const now = Date.now();
  const [sleep, rhr, hrv, rr, steps, water, workouts] = await Promise.all([
    service.getRecentSleepSamples((WEEK_DAYS + 1) * 24),
    service.getRecentSamples('HKQuantityTypeIdentifierRestingHeartRate', WEEK_DAYS),
    service.getRecentSamples('HKQuantityTypeIdentifierHeartRateVariabilitySDNN', WEEK_DAYS),
    service.getRecentSamples('HKQuantityTypeIdentifierRespiratoryRate', WEEK_DAYS),
    service.getDailySums('HKQuantityTypeIdentifierStepCount', WEEK_DAYS),
    service.getDailySums('HKQuantityTypeIdentifierDietaryWater', WEEK_DAYS),
    service.getRecentWorkouts(WEEK_DAYS),
  ]);

  // The 7 dates, oldest first, in the challenge zone.
  const dateKeys: string[] = [];
  const dayLabels: string[] = [];
  for (let i = WEEK_DAYS - 1; i >= 0; i -= 1) {
    const at = now - i * 86_400_000;
    dateKeys.push(dateKeyIn(at, zone));
    const w = wallClockIn(at, zone);
    dayLabels.push('SMTWTFS'[new Date(w.year, w.month - 1, w.day).getDay()] ?? '');
  }

  const nights = dateKeys.map((k) => (sleep ? sleepNightFor(sleep, k, zone) : null));
  const night = nights[nights.length - 1];

  const samplesByKey: Record<string, DiscreteSample[] | null> = {
    HKQuantityTypeIdentifierRestingHeartRate: rhr,
    HKQuantityTypeIdentifierHeartRateVariabilitySDNN: hrv,
    HKQuantityTypeIdentifierRespiratoryRate: rr,
  };
  const recovery: RecoveryRow[] = RECOVERY_TYPES.map((t) => {
    const samples = samplesByKey[t.key];
    if (!samples || !samples.length) {
      return { ...t, lastNight: null, latest: false, weekAvg: null };
    }
    const ln = nightValue(samples, night, now);
    return { ...t, lastNight: ln.value, latest: ln.latest, weekAvg: mean(samples.map((s) => s.value)) };
  });

  // Workout minutes per day, bucketed on the challenge zone's dates.
  let workoutMinutes: (number | null)[] | null = null;
  if (workouts) {
    workoutMinutes = dateKeys.map(() => null);
    for (const w of workouts) {
      const idx = dateKeys.indexOf(dateKeyIn(Date.parse(w.startISO), zone));
      if (idx >= 0) workoutMinutes[idx] = (workoutMinutes[idx] ?? 0) + w.minutes;
    }
  }

  const week: WeekRow[] = [
    {
      key: 'sleep',
      label: 'Sleep',
      values: nights.map((n) => (n ? n.asleepMinutes : null)),
      format: (v) => formatHoursMinutes(Math.round(v)),
    },
    { key: 'steps', label: 'Steps', values: steps ?? dateKeys.map(() => null), format: (v) => formatInteger(v) },
    {
      key: 'workouts',
      label: 'Workout minutes',
      values: workoutMinutes ?? dateKeys.map(() => null),
      format: (v) => `${Math.round(v)} min`,
    },
  ];
  // Water only when there is any — a row of nothing says nothing.
  if (water && water.some((v) => v != null && v > 0)) {
    week.push({ key: 'water', label: 'Water', values: water, format: (v) => formatWater(v, unitPreference) });
  }

  return { night, recovery, week, dayLabels };
}

const STAGE_ORDER: SleepStage[] = ['deep', 'core', 'rem', 'unspecified'];
const STAGE_LABEL: Record<SleepStage, string> = { deep: 'Deep', core: 'Core', rem: 'REM', unspecified: 'Asleep' };
const STAGE_COLOR: Record<SleepStage, string> = {
  deep: colors.accent700,
  core: colors.accent400,
  rem: colors.accent300,
  unspecified: colors.neutral500,
};

function fmt(v: number | null, decimals: number): string {
  if (v == null) return '—';
  return decimals === 0 ? String(Math.round(v)) : v.toFixed(decimals);
}

export function HealthInsights() {
  const zone = useAppStore((s) => s.challengeTimezone ?? undefined);
  const unitPreference = useAppStore((s) => s.unitPreference);
  const [data, setData] = useState<Insights | null>(null);
  const [more, setMore] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      compute(zone, unitPreference)
        .then((d) => {
          if (live) setData(d);
        })
        .catch(() => {
          if (live) setData(null);
        });
      return () => {
        live = false;
      };
    }, [zone, unitPreference]),
  );

  if (!data) return null;
  const { night } = data;

  return (
    <Card style={{ marginBottom: 14 }}>
      <Kicker style={{ marginBottom: 8 }}>Last night</Kicker>
      {night ? (
        <>
          <View style={styles.nightRow}>
            <View style={styles.nightCell}>
              <Text style={styles.big}>{formatHoursMinutes(night.asleepMinutes)}</Text>
              <Text style={styles.small}>asleep</Text>
            </View>
            <View style={styles.nightCell}>
              <Text style={styles.mid}>{formatClockIn(night.bedtimeMs, zone)}</Text>
              <Text style={styles.small}>bedtime</Text>
            </View>
            <View style={styles.nightCell}>
              <Text style={styles.mid}>{formatClockIn(night.wakeMs, zone)}</Text>
              <Text style={styles.small}>woke</Text>
            </View>
          </View>
          {night.stages ? (
            <>
              <View style={styles.strip}>
                {STAGE_ORDER.filter((st) => night.stages?.[st]).map((st) => (
                  <View
                    key={st}
                    style={[styles.stripSeg, { flex: night.stages![st]!, backgroundColor: STAGE_COLOR[st] }]}
                  />
                ))}
              </View>
              <View style={styles.legend}>
                {STAGE_ORDER.filter((st) => night.stages?.[st]).map((st) => (
                  <View key={st} style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: STAGE_COLOR[st] }]} />
                    <Text style={styles.small}>
                      {STAGE_LABEL[st]} {formatHoursMinutes(night.stages![st]!)}
                    </Text>
                  </View>
                ))}
              </View>
            </>
          ) : null}
          <Text style={styles.source}>
            From {night.sources.join(' and ')}
            {night.napMinutes > 0 ? ` · plus ${formatHoursMinutes(night.napMinutes)} napped` : ''}
          </Text>
        </>
      ) : (
        <Text style={styles.none}>No data in Apple Health.</Text>
      )}

      <Pressable onPress={() => setMore((m) => !m)} hitSlop={8} style={styles.moreRow}>
        <Text style={styles.more}>{more ? 'Less' : 'Recovery and 7 days'}</Text>
      </Pressable>

      {more ? (
        <>
          <Kicker style={{ marginTop: 10, marginBottom: 6 }}>Recovery</Kicker>
          <View style={styles.recoveryHead}>
            <Text style={[styles.small, { flex: 1 }]} />
            <Text style={[styles.small, styles.col]}>last night</Text>
            <Text style={[styles.small, styles.col]}>7-day avg</Text>
          </View>
          {data.recovery.map((r) => (
            <View key={r.key} style={styles.recoveryRow}>
              <Text style={styles.label}>{r.label}</Text>
              {r.lastNight == null && r.weekAvg == null ? (
                <Text style={[styles.none, { flex: 2, textAlign: 'right' }]}>No data in Apple Health</Text>
              ) : (
                <>
                  <Text style={[styles.value, styles.col]}>
                    {fmt(r.lastNight, r.decimals)}
                    {r.lastNight != null ? <Text style={styles.small}> {r.unit}{r.latest ? ' (latest)' : ''}</Text> : null}
                  </Text>
                  <Text style={[styles.value, styles.col]}>
                    {fmt(r.weekAvg, r.decimals)}
                    {r.weekAvg != null ? <Text style={styles.small}> {r.unit}</Text> : null}
                  </Text>
                </>
              )}
            </View>
          ))}

          <Kicker style={{ marginTop: 14, marginBottom: 6 }}>7 days</Kicker>
          {data.week.map((row) => {
            const present = row.values.filter((v): v is number => v != null);
            const max = present.length ? Math.max(...present) : 0;
            return (
              <View key={row.key} style={styles.weekRow}>
                <View style={styles.weekHead}>
                  <Text style={styles.label}>{row.label}</Text>
                  <Text style={styles.small}>
                    {present.length ? `today ${row.values[row.values.length - 1] != null ? row.format(row.values[row.values.length - 1]!) : '—'}` : 'No data in Apple Health'}
                  </Text>
                </View>
                {present.length ? (
                  <View style={styles.bars}>
                    {row.values.map((v, i) => (
                      <View key={i} style={styles.barCol}>
                        <View style={styles.barTrack}>
                          <View
                            style={[
                              styles.bar,
                              { height: v == null || max <= 0 ? 2 : Math.max(2, Math.round((v / max) * 28)) },
                              v == null && styles.barEmpty,
                            ]}
                          />
                        </View>
                        <Text style={styles.dayLabel}>{data.dayLabels[i]}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            );
          })}
          <Text style={styles.source}>Computed on this phone each time. Nothing is stored.</Text>
        </>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  nightRow: { flexDirection: 'row', gap: 12 },
  nightCell: { flex: 1 },
  big: { fontFamily: font.bold, fontSize: 22, letterSpacing: -0.5, color: colors.textHi },
  mid: { fontFamily: font.semibold, fontSize: 16, color: colors.textHi, marginTop: 4 },
  small: { fontFamily: font.regular, fontSize: 11, color: colors.textLow },
  strip: {
    flexDirection: 'row',
    height: 8,
    borderRadius: radius.sm,
    overflow: 'hidden',
    marginTop: 12,
    gap: 2,
  },
  stripSeg: { height: 8 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 6 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  source: { fontFamily: font.regular, fontSize: 11, color: colors.textLow, marginTop: 8 },
  none: { fontFamily: font.regular, fontSize: 12.5, color: colors.textMid },
  moreRow: { marginTop: 10, alignSelf: 'flex-start' },
  more: { fontFamily: font.semibold, fontSize: 12, color: colors.accent400, letterSpacing: 0.3 },
  recoveryHead: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 2 },
  recoveryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: colors.neutral800,
  },
  label: { flex: 1, fontFamily: font.regular, fontSize: 13, color: colors.textMid },
  col: { width: 96, textAlign: 'right' },
  value: { fontFamily: font.semibold, fontSize: 13, color: colors.textHi },
  weekRow: { paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.neutral800 },
  weekHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  bars: { flexDirection: 'row', gap: 6, marginTop: 6 },
  barCol: { flex: 1, alignItems: 'center' },
  barTrack: { height: 28, width: '100%', justifyContent: 'flex-end' },
  bar: { width: '100%', backgroundColor: colors.accent400, borderRadius: 2 },
  barEmpty: { backgroundColor: colors.neutral800 },
  dayLabel: { fontFamily: font.regular, fontSize: 9, color: colors.textLow, marginTop: 3 },
});
