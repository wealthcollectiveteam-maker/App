import { getCalendars } from 'expo-localization';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui';
import { probeIntl, type IntlCapabilities } from '@/lib/intl';
import { useAppStore } from '@/store/useAppStore';
import { colors, font } from '@/theme/tokens';

/**
 * DEV ONLY. What this runtime's `Intl` can do, and how it formats the
 * challenge's timezone and the device's. Reached from a Developer row in
 * Settings that exists only in development builds and Expo Go; this file is
 * loaded through `__DEV__ ? require(...) : null`, so a production bundle
 * never contains it — scripts/lib/distGuard.mjs refuses a bundle in which
 * the title below appears. docs/intl-check.md tells the owner how to read it.
 */
export const INTL_DIAGNOSTICS_TITLE = 'INTL DIAGNOSTICS (dev only)';

function deviceZone(): string | null {
  try {
    return getCalendars()[0]?.timeZone ?? null;
  } catch {
    return null;
  }
}

function verdict(c: IntlCapabilities): { ok: boolean; line: string } {
  if (c.dateTimeFormat && c.formatToParts && c.namedTimeZone && c.numberFormat) {
    return { ok: true, line: 'GOOD — every capability the app uses is present.' };
  }
  if (!c.dateTimeFormat) {
    return { ok: false, line: 'BAD — Intl is missing. Every date label falls back to the device clock.' };
  }
  if (!c.namedTimeZone) {
    return { ok: false, line: 'BAD — named timezones are not honoured. The day boundary would follow the phone, not the challenge.' };
  }
  return { ok: false, line: 'PARTIAL — see the rows below.' };
}

export function logIntlDiagnostics(): void {
  const zone = useAppStore.getState().challengeTimezone ?? deviceZone() ?? 'America/New_York';
  const c = probeIntl(undefined, zone);
  const v = verdict(c);
  console.log(`[intl] ${v.line} zone=${zone} sample="${c.sample}" caps=${JSON.stringify({
    dateTimeFormat: c.dateTimeFormat,
    formatToParts: c.formatToParts,
    namedTimeZone: c.namedTimeZone,
    numberFormat: c.numberFormat,
  })}`);
}

export function IntlDiagnostics() {
  const challengeZone = useAppStore((s) => s.challengeTimezone);
  const device = deviceZone();
  const zone = challengeZone ?? device ?? 'America/New_York';
  const c = probeIntl(undefined, zone);
  const v = verdict(c);
  const row = (label: string, ok: boolean) => (
    <View style={styles.row} key={label}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, { color: ok ? colors.accent400 : colors.textHi }]}>
        {ok ? 'present' : 'MISSING'}
      </Text>
    </View>
  );
  return (
    <Card style={{ marginTop: 10 }}>
      <Text style={styles.title}>{INTL_DIAGNOSTICS_TITLE}</Text>
      <Text style={[styles.verdict, { color: v.ok ? colors.accent400 : colors.textHi }]}>{v.line}</Text>
      {row('Intl.DateTimeFormat', c.dateTimeFormat)}
      {row('formatToParts', c.formatToParts)}
      {row('named timezone honoured', c.namedTimeZone)}
      {row('Intl.NumberFormat', c.numberFormat)}
      <Text style={styles.meta}>Challenge zone: {challengeZone ?? '(none yet)'}</Text>
      <Text style={styles.meta}>Device zone: {device ?? '(unknown)'}</Text>
      <Text style={styles.meta}>Now in {zone}: {c.sample}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  title: {
    fontFamily: font.semibold,
    fontSize: 10,
    letterSpacing: 1.2,
    color: colors.textMid,
  },
  verdict: {
    fontFamily: font.medium,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  label: {
    fontFamily: font.regular,
    fontSize: 13,
    color: colors.textMid,
  },
  value: {
    fontFamily: font.semibold,
    fontSize: 12,
    letterSpacing: 0.6,
  },
  meta: {
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textLow,
    marginTop: 6,
  },
});
