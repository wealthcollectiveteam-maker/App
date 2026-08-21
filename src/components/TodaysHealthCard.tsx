import {
  BarbellIcon as Barbell,
  FireIcon as Fire,
  FootprintsIcon as Footprints,
  ScalesIcon as Scales,
} from 'phosphor-react-native';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Card, Kicker, OutlineButton } from '@/components/ui';
import { formatWeight } from '@/lib/units';
import { useAppStore } from '@/store/useAppStore';
import { colors, font } from '@/theme/tokens';

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

/**
 * TODAY'S HEALTH — the visible destination for the Health permission.
 * Three deliberate states:
 *  - HealthKit structurally unavailable (Expo Go/simulator/non-iOS): render
 *    NOTHING. Never show a card that cannot populate.
 *  - Available but not connected: a compact connect prompt, not an empty
 *    data card.
 *  - Connected: real zeroes are information — always render the rows.
 * Values live in memory only; nothing here is persisted or synced.
 */
export function TodaysHealthCard() {
  const healthAvailable = useAppStore((s) => s.healthAvailable);
  const healthEnabled = useAppStore((s) => s.healthPrefs.healthEnabled);
  const readings = useAppStore((s) => s.healthReadings);
  const unitPreference = useAppStore((s) => s.unitPreference);
  const setHealthPref = useAppStore((s) => s.setHealthPref);

  if (!healthAvailable) return null;

  if (!healthEnabled) {
    return (
      <Card style={styles.connectCard}>
        <View style={{ flex: 1 }}>
          <Kicker>Apple Health</Kicker>
          <Text style={styles.connectSub}>
            See today{'\u2019'}s steps, energy and workouts here.
          </Text>
        </View>
        <OutlineButton
          label="Connect"
          small
          onPress={() => setHealthPref('healthEnabled', true)}
        />
      </Card>
    );
  }

  return (
    <Card style={{ marginBottom: 14 }}>
      <Kicker style={{ marginBottom: 10 }}>Today{'\u2019'}s health</Kicker>

      <View style={styles.statRow}>
        <View style={styles.stat}>
          <Footprints size={15} color={colors.accent400} />
          <Text style={styles.statValue}>
            {(readings.steps ?? 0).toLocaleString()}
          </Text>
          <Text style={styles.statLabel}>steps</Text>
        </View>
        <View style={styles.stat}>
          <Fire size={15} color={colors.accent400} />
          <Text style={styles.statValue}>
            {(readings.activeEnergyKcal ?? 0).toLocaleString()}
          </Text>
          <Text style={styles.statLabel}>active kcal</Text>
        </View>
        <View style={styles.stat}>
          <Scales size={15} color={colors.accent400} />
          <Text style={styles.statValue}>
            {readings.bodyMass
              ? formatWeight(readings.bodyMass.kg, unitPreference)
              : '—'}
          </Text>
          <Text style={styles.statLabel}>
            {readings.bodyMass
              ? `weight · ${dateLabel(readings.bodyMass.dateISO)}`
              : 'weight'}
          </Text>
        </View>
      </View>

      <View style={styles.workoutSection}>
        {readings.workouts.length === 0 ? (
          <Text style={styles.noWorkouts}>No workouts recorded today.</Text>
        ) : (
          readings.workouts.map((w, i) => (
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
});
