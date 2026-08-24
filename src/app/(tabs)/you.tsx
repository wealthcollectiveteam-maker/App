import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  DiamondBadge,
  InitialsTile,
  Micro,
  Serif,
  StatBox,
} from '@/components/primitives';
import { ScreenState } from '@/components/ScreenState';
import { Card } from '@/components/ui';
import { CHALLENGE, XP } from '@/constants/challenge';
import {
  selectLevel,
  selectXpIntoLevel,
  selectXpToNext,
  useAppStore,
} from '@/store/useAppStore';
import { toast } from '@/store/useToastStore';
import { colors, font, microTracking, space } from '@/theme/tokens';

interface BadgeState {
  day: number;
  bestFlame: number;
  perfectDays: number;
  dayComplete: boolean;
}

/** Every threshold is derived from CHALLENGE.days — none is typed twice. */
const HALFWAY = Math.ceil(CHALLENGE.days / 2);

const BADGES: {
  key: string;
  value: number;
  label: string;
  earned: (s: BadgeState) => boolean;
}[] = [
  {
    key: 'dayone',
    value: 1,
    label: 'Day one',
    earned: (s) => s.day >= 1 && (s.perfectDays >= 1 || s.day > 1),
  },
  {
    key: 'weekone',
    value: 7,
    label: 'Week one',
    earned: (s) => s.bestFlame >= 7,
  },
  {
    key: 'digits',
    value: 10,
    label: 'Double digits',
    earned: (s) => s.bestFlame >= 10,
  },
  {
    key: 'halfway',
    value: HALFWAY,
    label: 'Halfway',
    earned: (s) => s.day >= HALFWAY,
  },
  {
    key: 'finisher',
    value: CHALLENGE.days,
    label: 'Finisher',
    earned: (s) => s.day >= CHALLENGE.days && s.dayComplete,
  },
];

export default function YouScreen() {
  const day = useAppStore((s) => s.day);
  const xp = useAppStore((s) => s.xp);
  const bestFlame = useAppStore((s) => s.bestFlame);
  const perfectDays = useAppStore((s) => s.perfectDays);
  const dayComplete = useAppStore((s) => s.dayComplete);
  const why = useAppStore((s) => s.why);
  const squad = useAppStore((s) => s.squad);
  const profileName = useAppStore((s) => s.profileName);
  const router = useRouter();

  const level = selectLevel(xp);
  const into = selectXpIntoLevel(xp);
  const toNext = selectXpToNext(xp);
  const badgeState: BadgeState = { day, bestFlame, perfectDays, dayComplete };

  const rows = [
    { label: 'My Challenge', meta: null, onPress: () => router.push('/my-challenge') },
    { label: 'Settings', meta: null, onPress: () => router.push('/settings') },
    {
      label: 'Invite code',
      meta: squad?.code ?? 'Solo',
      onPress: () =>
        toast(
          squad
            ? 'Invite code copied'
            : 'Running solo — create a squad from the Squad tab',
        ),
    },
    { label: 'Sign out', meta: null, onPress: () => toast('Signed out (mock)') },
  ];

  return (
    <ScreenState>
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.bg }}
        contentContainerStyle={styles.content}
      >
        <View style={styles.identity}>
          <InitialsTile
            initials={profileName.slice(0, 2).toUpperCase()}
            active
            size={84}
          />
          <View style={{ flex: 1 }}>
            <Text style={styles.name} numberOfLines={1}>
              {profileName}
            </Text>
            <Micro color={colors.textMid} style={{ marginTop: 6 }}>
              LVL {level} · {xp.toLocaleString()} XP · Day {day}
            </Micro>
            <View style={styles.xpTrack}>
              <View
                style={[styles.xpFill, { width: `${(into / XP.perLevel) * 100}%` }]}
              />
            </View>
            <Serif size={13} style={{ marginTop: 8, color: colors.textLow }}>
              {toNext} XP to LVL {level + 1} — flair ring grows
            </Serif>
          </View>
        </View>

        <View style={styles.statGrid}>
          <StatBox value={day} label="Current day" />
          <StatBox value={bestFlame} label="Best flame" tone="accent" />
          <StatBox value={perfectDays} label="Perfect days" tone="accent" />
        </View>

        <Card style={{ marginTop: 12 }}>
          <Micro color={colors.textMid}>Badges</Micro>
          <View style={styles.badgeRow}>
            {BADGES.map((b) => (
              <DiamondBadge
                key={b.key}
                value={b.value}
                label={b.label}
                earned={b.earned(badgeState)}
              />
            ))}
          </View>
        </Card>

        <View style={styles.whyCard}>
          <View style={styles.whyRule} />
          <View style={styles.whyBody}>
            <Micro color={colors.textMid}>Why I started</Micro>
            <Serif size={21} style={{ marginTop: 10, color: colors.textHi }}>
              {'“'}
              {why}
              {'”'}
            </Serif>
          </View>
        </View>

        <View style={{ marginTop: 20 }}>
          {rows.map(({ label, meta, onPress }) => (
            <Pressable
              key={label}
              onPress={onPress}
              accessibilityRole="button"
              accessibilityLabel={label}
              style={styles.row}
            >
              <Text style={styles.rowLabel}>{label}</Text>
              {meta ? (
                <Text style={styles.rowMeta}>{meta}</Text>
              ) : (
                <Text style={styles.rowArrow}>{'→'}</Text>
              )}
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </ScreenState>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: space.screenX,
    paddingTop: 8,
    paddingBottom: 28,
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
  },
  name: {
    fontFamily: font.bold,
    fontSize: 30,
    letterSpacing: -0.9,
    color: colors.textHi,
  },
  xpTrack: {
    height: 3,
    backgroundColor: colors.surfaceAlt,
    marginTop: 12,
    overflow: 'hidden',
  },
  xpFill: {
    height: 3,
    backgroundColor: colors.accent,
  },
  statGrid: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 22,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 22,
  },
  whyCard: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    marginTop: 12,
  },
  whyRule: {
    width: 2,
    backgroundColor: colors.accent,
  },
  whyBody: {
    flex: 1,
    padding: space.cardPad,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  rowLabel: {
    flex: 1,
    fontFamily: font.medium,
    fontSize: 17,
    color: colors.textHi,
  },
  rowMeta: {
    fontFamily: font.semibold,
    fontSize: 14,
    letterSpacing: microTracking(14),
    color: colors.textMid,
  },
  rowArrow: {
    fontFamily: font.regular,
    fontSize: 17,
    color: colors.textLow,
  },
});
