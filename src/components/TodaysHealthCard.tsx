import {
  BarbellIcon as Barbell,
  FireIcon as Fire,
  FootprintsIcon as Footprints,
  ScalesIcon as Scales,
} from 'phosphor-react-native';
import React from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { Card, Kicker, OutlineButton } from '@/components/ui';
import { healthCardState } from '@/lib/healthCardState';
import { formatCalendar, formatClock, formatInteger } from '@/lib/intl';
import { formatWeight } from '@/lib/units';
import { selectHealthConnected, useAppStore } from '@/store/useAppStore';
import { colors, font } from '@/theme/tokens';

function timeLabel(iso: string): string {
  return formatClock(Date.parse(iso));
}

function dateLabel(iso: string): string {
  return formatCalendar(new Date(iso), { month: 'short', day: 'numeric' });
}

/**
 * The one route out of the app this card offers. iOS opens the app's own
 * settings page, which carries the Health row once Health access has been
 * requested. Unreachable off native iOS: every caller sits behind
 * `healthAvailable`, false on web, Android and Expo Go — so this is never a
 * dead button in a browser.
 */
function openIOSSettings() {
  Linking.openSettings().catch(() => {});
}

/**
 * TODAY'S HEALTH.
 *
 * THE RULE: this card may render a number only if the app actually read it.
 * A null reading is not a zero — it is "we did not read this", and HealthKit
 * will not say whether that is no data or no permission. Read-denied types
 * return no samples, exactly like types with no data, and Apple provides no
 * API to tell them apart (deliberately: "denied heart rate" is itself a
 * health disclosure). So the card NAMES the ambiguity rather than guessing,
 * and points at Settings, the only place the answer exists.
 *
 * Four states:
 *  - HealthKit structurally unavailable (web/Android/Expo Go/simulator):
 *    render NOTHING. Never a card that cannot populate.
 *  - Available but not connected — including a device that has never been
 *    shown the permission sheet: a Connect prompt, not an empty data card.
 *  - Connected and nothing came back: say exactly that, and say that iOS
 *    does not report which reason. Do not draw zeroes.
 *  - Connected with readings: show them. A measured zero IS information;
 *    an unread value is a dash, never a zero.
 */
export function TodaysHealthCard() {
  const healthAvailable = useAppStore((s) => s.healthAvailable);
  const connected = useAppStore(selectHealthConnected);
  const readings = useAppStore((s) => s.healthReadings);
  const unitPreference = useAppStore((s) => s.unitPreference);
  const setHealthPref = useAppStore((s) => s.setHealthPref);

  // The decision itself lives in lib/healthCardState.ts, where it can be
  // proved in plain Node. This component only draws the answer.
  const state = healthCardState({
    available: healthAvailable,
    connected,
    readings,
  });

  if (state.kind === 'hidden') return null;

  if (state.kind === 'connect') {
    return (
      <Card style={styles.connectCard}>
        <View style={{ flex: 1 }}>
          <Kicker>Apple Health</Kicker>
          <Text style={styles.connectSub}>
            Not connected. Connect to see today{'’'}s steps, energy and
            workouts here. Read-only, and nothing leaves this phone.
          </Text>
        </View>
        <OutlineButton
          label="Connect"
          small
          // setHealthPref does not short-circuit on an unchanged value, so
          // this asks even in the legacy case (a `true` stored by a build
          // whose default was ON, on a phone that was never asked). One call,
          // not two — a second concurrent request would race a second sheet.
          onPress={() => setHealthPref('healthEnabled', true)}
        />
      </Card>
    );
  }

  const { steps, activeEnergyKcal, bodyMass, workouts } = readings;

  if (state.kind === 'nothing-returned') {
    return (
      <Card style={{ marginBottom: 14 }}>
        <Kicker style={{ marginBottom: 10 }}>
          Today{'’'}s health
        </Kicker>
        <Text style={styles.notice}>
          Apple Health returned nothing for today. That is either no data
          recorded yet, or access not granted — iOS does not tell apps which.
        </Text>
        <View style={styles.noticeActions}>
          <OutlineButton
            label="Check access in Settings"
            small
            onPress={openIOSSettings}
          />
        </View>
      </Card>
    );
  }

  return (
    <Card style={{ marginBottom: 14 }}>
      <Kicker style={{ marginBottom: 10 }}>Today{'’'}s health</Kicker>

      <View style={styles.statRow}>
        <View style={styles.stat}>
          <Footprints size={15} color={colors.accent400} />
          <Text style={styles.statValue}>
            {steps == null ? '—' : formatInteger(steps)}
          </Text>
          <Text style={styles.statLabel}>steps</Text>
        </View>
        <View style={styles.stat}>
          <Fire size={15} color={colors.accent400} />
          <Text style={styles.statValue}>
            {activeEnergyKcal == null ? '—' : formatInteger(activeEnergyKcal)}
          </Text>
          <Text style={styles.statLabel}>active kcal</Text>
        </View>
        <View style={styles.stat}>
          <Scales size={15} color={colors.accent400} />
          <Text style={styles.statValue}>
            {bodyMass ? formatWeight(bodyMass.kg, unitPreference) : '—'}
          </Text>
          <Text style={styles.statLabel}>
            {bodyMass ? `weight · ${dateLabel(bodyMass.dateISO)}` : 'weight'}
          </Text>
        </View>
      </View>

      <View style={styles.workoutSection}>
        {workouts == null ? (
          // The workout query did not run. "No workouts today" here would be
          // the card answering a question it never got to ask.
          <Text style={styles.noWorkouts}>
            Workouts could not be read from Apple Health.
          </Text>
        ) : workouts.length === 0 ? (
          // The query ran and came back empty. Report the read, not a verdict
          // on the day — a read-denied workout type looks identical.
          <Text style={styles.noWorkouts}>
            Apple Health returned no workouts for today.
          </Text>
        ) : (
          workouts.map((w, i) => (
            <View key={`${w.startISO}-${i}`} style={styles.workoutRow}>
              <Barbell size={14} color={colors.neutral500} />
              <Text style={styles.workoutText} numberOfLines={1}>
                {w.type}
              </Text>
              <Text style={styles.workoutMeta}>
                {w.minutes} min · {timeLabel(w.startISO)}
              </Text>
            </View>
          ))
        )}
      </View>

      {state.showAccessFootnote && (
        <Pressable onPress={openIOSSettings} hitSlop={6}>
          <Text style={styles.footnote}>
            A dash means Apple Health returned nothing — iOS does not say
            whether that is no data or no access.{' '}
            <Text style={styles.footnoteLink}>Check access in Settings</Text>
          </Text>
        </Pressable>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  connectCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  connectSub: {
    fontFamily: font.regular,
    fontSize: 12,
    color: colors.neutral500,
    marginTop: 4,
    lineHeight: 17,
  },
  notice: {
    fontFamily: font.regular,
    fontSize: 12.5,
    color: colors.neutral400,
    lineHeight: 18.5,
  },
  noticeActions: {
    flexDirection: 'row',
    marginTop: 12,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  stat: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
  },
  statValue: {
    fontFamily: font.medium,
    fontSize: 15,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  statLabel: {
    fontFamily: font.regular,
    fontSize: 10,
    color: colors.neutral500,
    textAlign: 'center',
  },
  workoutSection: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingTop: 10,
    gap: 6,
  },
  noWorkouts: {
    fontFamily: font.regular,
    fontSize: 12,
    color: colors.neutral500,
  },
  workoutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  workoutText: {
    flex: 1,
    fontFamily: font.regular,
    fontSize: 12.5,
    color: colors.text,
  },
  workoutMeta: {
    fontFamily: font.regular,
    fontSize: 11.5,
    color: colors.neutral500,
    fontVariant: ['tabular-nums'],
  },
  footnote: {
    marginTop: 10,
    fontFamily: font.regular,
    fontSize: 11,
    color: colors.neutral600,
    lineHeight: 16,
  },
  footnoteLink: {
    color: colors.accent400,
  },
});
