import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Card, OutlineButton } from '@/components/ui';
import { formatClock } from '@/lib/intl';
import { dateKeyIn, formatHoursMinutes, sleepNightFor, type SleepNight } from '@/lib/sleepNight';
import {
  getHealthService,
  runHealthDiagnostics,
  type HealthDiagnosticsReport,
  type HealthReadProbe,
} from '@/services/HealthService';
import { useAppStore } from '@/store/useAppStore';
import { colors, font } from '@/theme/tokens';

/**
 * DEV ONLY (Phase 38M). What this phone's HealthKit actually did, live:
 * whether the gate opened and the native module loaded, what
 * `isHealthDataAvailable()` returned, the RAW answer to
 * `getRequestStatusForAuthorization` (typeof and value, unmapped) next to the
 * state the app mapped it to, the Health switch and where its value came
 * from, and for each read type whether the query ran, errored,
 * or came back empty — with a SAMPLE COUNT and nothing else.
 *
 * Loaded from Settings through `__DEV__ ? require(...) : null`, so a
 * production bundle never contains it; scripts/lib/distGuard.mjs refuses a
 * bundle in which the title below appears. Not rendered on web either
 * (Settings checks the platform): there is nothing to diagnose in a browser.
 *
 * PRIVACY. Everything here is component state, discarded with the screen.
 * Nothing is logged, persisted or sent, and no HEALTH VALUE appears anywhere
 * in it — no kcal, no kg, no step total, no workout name. Counts, types,
 * statuses and an authorization enum. docs/health-on-device.md tells the
 * owner how to read it.
 */
export const HEALTH_DIAGNOSTICS_TITLE = 'HEALTH DIAGNOSTICS (dev only)';

const READ_LABELS: Record<HealthReadProbe['id'], string> = {
  HKQuantityTypeIdentifierDietaryEnergyConsumed: 'dietary energy (today)',
  HKQuantityTypeIdentifierBodyMass: 'body mass (latest)',
  HKQuantityTypeIdentifierStepCount: 'steps (today)',
  HKQuantityTypeIdentifierActiveEnergyBurned: 'active energy (today)',
  HKWorkoutTypeIdentifier: 'workouts (today)',
  HKCategoryTypeIdentifierSleepAnalysis: 'sleep analysis (last 36 h)',
  HKQuantityTypeIdentifierDietaryWater: 'dietary water (today)',
  HKCategoryTypeIdentifierMindfulSession: 'mindful sessions (today)',
  HKQuantityTypeIdentifierRestingHeartRate: 'resting heart rate (7 d)',
  HKQuantityTypeIdentifierHeartRateVariabilitySDNN: 'HRV, SDNN (7 d)',
  HKQuantityTypeIdentifierRespiratoryRate: 'respiratory rate (7 d)',
};

function readLine(p: HealthReadProbe): { text: string; ok: boolean } {
  switch (p.status) {
    case 'ok':
      return { text: `ran · ${p.count} sample${p.count === 1 ? '' : 's'}`, ok: true };
    case 'empty':
      return { text: 'ran · 0 samples (no data or no access — iOS does not say)', ok: true };
    case 'error':
      return { text: `ERROR · ${p.message ?? '(no message)'}`, ok: false };
    default:
      return { text: 'skipped', ok: false };
  }
}

export function HealthDiagnostics() {
  const [report, setReport] = useState<HealthDiagnosticsReport | null>(null);
  // N2b: last night per SOURCE next to the union, so Oura + Watch being ADDED
  // rather than merged would read as two totals that sum to the union.
  const [night, setNight] = useState<SleepNight | null | 'unread'>('unread');
  const zone = useAppStore((s) => s.challengeTimezone ?? undefined);
  const [running, setRunning] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const healthAvailable = useAppStore((s) => s.healthAvailable);
  const healthAsked = useAppStore((s) => s.healthAsked);
  const healthAuthRaw = useAppStore((s) => s.healthAuthRaw);
  const switchOn = useAppStore((s) => s.healthPrefs.healthEnabled);
  const prefsSource = useAppStore((s) => s.healthPrefsSource);
  const refreshHealth = useAppStore((s) => s.refreshHealth);

  const run = useCallback(async () => {
    setRunning(true);
    setFailure(null);
    try {
      const next = await runHealthDiagnostics();
      setReport(next);
      const samples = await getHealthService().getRecentSleepSamples(36);
      setNight(samples ? sleepNightFor(samples, dateKeyIn(Date.now(), zone), zone) : 'unread');
      // So the store's own view (the card, the switch) is as fresh as this.
      await refreshHealth();
    } catch (e) {
      setFailure(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, [refreshHealth, zone]);

  useEffect(() => {
    run();
  }, [run]);

  const row = (label: string, value: string, ok?: boolean) => (
    <View style={styles.row} key={label}>
      <Text style={styles.label}>{label}</Text>
      <Text
        style={[
          styles.value,
          ok === undefined ? null : { color: ok ? colors.accent400 : colors.textHi },
        ]}
      >
        {value}
      </Text>
    </View>
  );

  const verdict = (() => {
    if (!report) return running ? 'Running…' : 'Not run yet.';
    if (report.simulated) return 'SIMULATED — the dev sheet is feeding fake Health data.';
    if (!report.env.gateOpen) return 'GATE CLOSED — this runtime is treated as no-HealthKit (web, Android or Expo Go).';
    if (report.module.status !== 'loaded') return `BAD — the native module did not load (${report.module.status}).`;
    if (report.available !== true) return 'BAD — isHealthDataAvailable() is not true on this device.';
    if (!report.auth) return 'BAD — no authorization answer.';
    if (report.auth.parsedAs === 'unknown') return `BAD — the authorization answer was not understood: ${report.auth.raw}.`;
    if (report.auth.parsedAs === 'not-requested') return 'GOOD — HealthKit is here and this phone has NOT been asked yet. Track should show the Connect prompt.';
    const errors = report.reads.filter((r) => r.status === 'error').length;
    if (errors > 0) return `PARTIAL — asked, but ${errors} of ${report.reads.length} reads errored. See below.`;
    return 'GOOD — asked, and every read ran. Zero-sample rows are no data or no access; iOS does not say which.';
  })();

  return (
    <Card style={{ marginTop: 10 }}>
      <Text style={styles.title}>{HEALTH_DIAGNOSTICS_TITLE}</Text>
      <Text style={styles.verdict}>{verdict}</Text>
      {failure ? <Text style={styles.error}>Diagnostics threw: {failure}</Text> : null}

      {report ? (
        <>
          <Text style={styles.section}>Runtime</Text>
          {row('platform', report.env.platformOS)}
          {row('appOwnership', String(report.env.appOwnership))}
          {row('isRunningInExpoGo()', String(report.env.runningInExpoGo), !report.env.runningInExpoGo)}
          {row('gate open (may require module)', String(report.env.gateOpen), report.env.gateOpen)}
          {row(
            'native module',
            report.module.status + (report.module.message ? ` · ${report.module.message}` : ''),
            report.module.status === 'loaded' || report.module.status === 'simulated',
          )}
          {row(
            'isHealthDataAvailable()',
            report.available === null
              ? `not callable${report.availableError ? ` · ${report.availableError}` : ''}`
              : String(report.available),
            report.available === true,
          )}

          <Text style={styles.section}>Authorization (getRequestStatusForAuthorization)</Text>
          {report.auth ? (
            <>
              {row('raw value', report.auth.raw)}
              {row('typeof', report.auth.typeOf, report.auth.typeOf === 'number')}
              {row('mapped to', report.auth.parsedAs, report.auth.parsedAs !== 'unknown')}
            </>
          ) : (
            row('raw value', 'not asked — gate closed or module missing', false)
          )}

          <Text style={styles.section}>Reads (sample counts only — never values)</Text>
          {report.reads.map((p) => {
            const line = readLine(p);
            return row(READ_LABELS[p.id], line.text, line.ok);
          })}

          <Text style={styles.section}>Last night, per source (union must not be the sum)</Text>
          {night === 'unread'
            ? row('sleep', 'not read', false)
            : night === null
              ? row('sleep', 'no main sleep ended today in the challenge zone')
              : (
                <>
                  {night.perSource.map((p) => row(p.source, formatHoursMinutes(p.asleepMinutes)))}
                  {row('UNION (what the app uses)', formatHoursMinutes(night.asleepMinutes), true)}
                  {night.perSource.length > 1
                    ? row(
                        'sum of sources (must be ≥ union)',
                        formatHoursMinutes(night.perSource.reduce((a, p) => a + p.asleepMinutes, 0)),
                      )
                    : null}
                </>
              )}
        </>
      ) : null}

      <Text style={styles.section}>What the app currently believes</Text>
      {row('healthAvailable', String(healthAvailable), healthAvailable)}
      {row('healthAsked', String(healthAsked))}
      {row('last auth answer (store)', healthAuthRaw ?? '(none yet)')}
      {row('Health switch', switchOn ? 'ON' : 'OFF')}
      {row(
        'switch read from',
        prefsSource === 'device'
          ? 'this phone (AsyncStorage ranked.healthPrefs.v1)'
          : 'built-in default — never stored on this phone',
      )}
      <Text style={styles.meta}>
        The switch is never read from the account: health_enabled is not synced.
      </Text>

      <View style={styles.actions}>
        <OutlineButton
          label={running ? 'Running…' : 'Re-run'}
          small
          disabled={running}
          onPress={run}
        />
        {report ? (
          <Text style={styles.meta}>Last run {formatClock(Date.parse(report.ranAtISO))}</Text>
        ) : null}
      </View>
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
    color: colors.textHi,
  },
  error: {
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 6,
    color: colors.textHi,
  },
  section: {
    fontFamily: font.semibold,
    fontSize: 10,
    letterSpacing: 1,
    color: colors.textLow,
    marginTop: 14,
    marginBottom: 2,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 6,
  },
  label: {
    fontFamily: font.regular,
    fontSize: 12,
    color: colors.textMid,
    flexShrink: 0,
  },
  value: {
    fontFamily: font.semibold,
    fontSize: 12,
    letterSpacing: 0.3,
    color: colors.textMid,
    textAlign: 'right',
    flexShrink: 1,
  },
  meta: {
    fontFamily: font.regular,
    fontSize: 11,
    lineHeight: 15,
    color: colors.textLow,
    marginTop: 6,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
  },
});
