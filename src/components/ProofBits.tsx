import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Card, Kicker } from '@/components/ui';
import {
  COPY,
  formatDiff,
  formatMetric,
  type BeforeNow,
  type Pattern,
  type WeeklyPoint,
} from '@/lib/proof';
import { colors, font } from '@/theme/tokens';

/**
 * The small pieces the PROOF screens share (Phase 38O). Plain, in the
 * existing card treatment; a designer redoes the look later. No chart
 * library: the weekly trend is a row of Views with a dot placed by value.
 * Every sentence comes from lib/proof/copy.ts, which the copy guard reads.
 */

export function Section({ title, intro, children }: { title: string; intro?: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: 18 }}>
      <Kicker style={{ marginBottom: 6 }}>{title}</Kicker>
      {intro ? <Text style={styles.intro}>{intro}</Text> : null}
      <Card>{children}</Card>
    </View>
  );
}

export function EmptyLine({ text }: { text: string }) {
  return <Text style={styles.empty}>{text}</Text>;
}

/** Weekly medians as dots on a baseline. Simple weekly points, nothing more. */
export function WeeklyTrend({ points, format }: { points: WeeklyPoint[]; format: (v: number) => string }) {
  const present = points.filter((p) => p.value != null) as (WeeklyPoint & { value: number })[];
  if (present.length < 2) return null;
  const min = Math.min(...present.map((p) => p.value));
  const max = Math.max(...present.map((p) => p.value));
  const range = max - min;
  return (
    <View style={styles.trend}>
      {points.map((p) => (
        <View key={p.week} style={styles.trendCol}>
          <View style={styles.trendTrack}>
            {p.value != null ? (
              <View
                style={[
                  styles.dot,
                  { bottom: range > 0 ? Math.round(((p.value - min) / range) * 22) : 11 },
                ]}
              />
            ) : null}
          </View>
          <Text style={styles.trendLabel}>W{p.week}</Text>
          <Text style={styles.trendValue}>{p.value != null ? format(p.value) : '—'}</Text>
        </View>
      ))}
    </View>
  );
}

export function BeforeNowRow({ m, unit }: { m: BeforeNow; unit: 'metric' | 'imperial' }) {
  if (!m.baseline || !m.now) return null;
  return (
    <View style={styles.row}>
      <View style={styles.rowHead}>
        <Text style={styles.label}>{m.label}</Text>
        {m.diff != null ? <Text style={styles.diff}>{formatDiff(m.key, m.diff, unit)}</Text> : null}
      </View>
      <View style={styles.pair}>
        <View style={styles.cell}>
          <Text style={styles.value}>{formatMetric(m.key, m.baseline.value, unit)}</Text>
          <Text style={styles.small}>
            {COPY.beforeLabel} · {COPY.days(m.baseline.n)}
          </Text>
        </View>
        <View style={styles.cell}>
          <Text style={styles.value}>{formatMetric(m.key, m.now.value, unit)}</Text>
          <Text style={styles.small}>
            {COPY.nowLabel} · {COPY.days(m.now.n)}
          </Text>
        </View>
      </View>
      <WeeklyTrend points={m.weekly} format={(v) => formatMetric(m.key, v, unit)} />
    </View>
  );
}

export function PatternLine({ p }: { p: Pattern }) {
  return (
    <View style={styles.row}>
      <Text style={styles.body}>{p.text}</Text>
    </View>
  );
}

export const proofStyles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  title: { fontFamily: font.bold, fontSize: 28, letterSpacing: -0.8, color: colors.textHi },
  subtitle: { fontFamily: font.regular, fontSize: 13, lineHeight: 18, color: colors.textMid },
  reading: { fontFamily: font.regular, fontSize: 14, color: colors.textMid, marginTop: 24 },
});

const styles = StyleSheet.create({
  intro: { fontFamily: font.regular, fontSize: 12, lineHeight: 17, color: colors.textLow, marginBottom: 8 },
  empty: { fontFamily: font.regular, fontSize: 13, lineHeight: 18, color: colors.textMid },
  row: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.neutral800 },
  rowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  label: { fontFamily: font.semibold, fontSize: 13, color: colors.textHi },
  diff: { fontFamily: font.semibold, fontSize: 13, color: colors.accent400 },
  pair: { flexDirection: 'row', gap: 16, marginTop: 6 },
  cell: { flex: 1 },
  value: { fontFamily: font.bold, fontSize: 18, letterSpacing: -0.3, color: colors.textHi },
  small: { fontFamily: font.regular, fontSize: 11, color: colors.textLow, marginTop: 2 },
  body: { fontFamily: font.regular, fontSize: 13.5, lineHeight: 19, color: colors.text },
  trend: { flexDirection: 'row', gap: 6, marginTop: 10 },
  trendCol: { flex: 1, alignItems: 'center' },
  trendTrack: { height: 28, width: '100%', borderBottomWidth: 1, borderBottomColor: colors.neutral800 },
  dot: { position: 'absolute', left: '50%', marginLeft: -3, width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent400 },
  trendLabel: { fontFamily: font.regular, fontSize: 9, color: colors.textLow, marginTop: 3 },
  trendValue: { fontFamily: font.regular, fontSize: 9, color: colors.textMid },
});
