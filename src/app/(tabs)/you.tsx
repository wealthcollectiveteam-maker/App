import {
  CaretRightIcon as CaretRight,
  DiamondIcon as Diamond,
  FireIcon as Fire,
  FlagIcon as Flag,
  GearIcon as Gear,
  LightningIcon as Lightning,
  SignOutIcon as SignOut,
  TrophyIcon as Trophy,
} from 'phosphor-react-native';
import { useRouter } from 'expo-router';
import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { FlairAvatar } from '@/components/FlairAvatar';
import { ScreenState } from '@/components/ScreenState';
import { Card, Kicker } from '@/components/ui';
import { CHALLENGE, XP } from '@/constants/challenge';
import {
  selectLevel,
  selectXpIntoLevel,
  selectXpToNext,
  useAppStore,
} from '@/store/useAppStore';
import { toast } from '@/store/useToastStore';
import { colors, font, space } from '@/theme/tokens';

const BADGES = [
  { key: 'dayone', label: 'DAY ONE', Icon: Flag, unlocked: (s: BadgeState) => s.day >= 1 && (s.perfectDays >= 1 || s.day > 1) },
  { key: 'weekone', label: 'WEEK ONE', Icon: Fire, unlocked: (s: BadgeState) => s.bestFlame >= 7 },
  { key: 'digits', label: 'DOUBLE DIGITS', Icon: Lightning, unlocked: (s: BadgeState) => s.bestFlame >= 10 },
  { key: 'halfway', label: 'HALFWAY', Icon: Diamond, unlocked: (s: BadgeState) => s.day >= Math.ceil(CHALLENGE.days / 2) },
  { key: 'finisher', label: 'FINISHER', Icon: Trophy, unlocked: (s: BadgeState) => s.day >= CHALLENGE.days && s.dayComplete },
];

interface BadgeState {
  day: number;
  bestFlame: number;
  perfectDays: number;
  dayComplete: boolean;
}

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

  return (
    <ScreenState>
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={styles.content}
    >
      <View style={{ alignItems: 'center', marginTop: 6 }}>
        <FlairAvatar
          initials={profileName.slice(0, 2).toUpperCase()}
          level={level}
          size={58}
        />
        <Text style={styles.name}>{profileName}</Text>
        <Text style={styles.meta}>
          LVL {level} · {xp.toLocaleString()} XP · Day {day}
        </Text>
        <View style={styles.xpTrack}>
          <View
            style={[
              styles.xpFill,
              { width: `${(into / XP.perLevel) * 100}%` },
            ]}
          />
        </View>
        <Text style={styles.xpHint}>
          {toNext} XP to LVL {level + 1} — flair ring grows
        </Text>
      </View>

      <View style={styles.statGrid}>
        {[
          { label: 'Current day', value: day },
          { label: 'Best flame', value: bestFlame },
          { label: 'Perfect days', value: perfectDays },
        ].map((s) => (
          <Card key={s.label} style={styles.statCell}>
            <Text style={styles.statValue}>{s.value}</Text>
            <Kicker color={colors.neutral500} style={{ marginTop: 4 }}>
              {s.label}
            </Kicker>
          </Card>
        ))}
      </View>

      <Card style={{ marginTop: 12 }}>
        <Kicker style={{ marginBottom: 12 }}>Badges</Kicker>
        <View style={styles.badgeRow}>
          {BADGES.map(({ key, label, Icon, unlocked }) => {
            const on = unlocked(badgeState);
            return (
              <View key={key} style={{ alignItems: 'center', gap: 6, opacity: on ? 1 : 0.35 }}>
                <View
                  style={[
                    styles.badgeCircle,
                    { borderColor: on ? colors.accent600 : colors.neutral700 },
                  ]}
                >
                  <Icon
                    size={19}
                    weight={on ? 'fill' : 'regular'}
                    color={on ? colors.accent300 : colors.neutral500}
                  />
                </View>
                <Text style={styles.badgeLabel}>{label}</Text>
              </View>
            );
          })}
        </View>
      </Card>

      <Card style={{ marginTop: 12 }}>
        <Kicker style={{ marginBottom: 8 }}>Why I started</Kicker>
        <Text style={styles.whyText}>{'\u201C'}{why}{'\u201D'}</Text>
      </Card>

      <View style={{ marginTop: 12 }}>
        {[
          { label: 'Settings', Icon: Gear, meta: null, onPress: () => router.push('/settings') },
          { label: 'Invite code', Icon: CaretRight, meta: squad?.code ?? 'Solo', onPress: () => toast(squad ? 'Invite code copied' : 'Running solo — create a squad from the Squad tab') },
          { label: 'Sign out', Icon: SignOut, meta: null, onPress: () => toast('Signed out (mock)') },
        ].map(({ label, Icon, meta, onPress }) => (
          <Pressable key={label} onPress={onPress} style={styles.row}>
            <Icon size={17} color={colors.neutral500} />
            <Text style={styles.rowLabel}>{label}</Text>
            {meta && <Text style={styles.rowMeta}>{meta}</Text>}
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
  name: {
    fontFamily: font.medium,
    fontSize: 20,
    color: colors.text,
    marginTop: 10,
  },
  meta: {
    fontFamily: font.regular,
    fontSize: 12.5,
    color: colors.neutral500,
    marginTop: 3,
  },
  xpTrack: {
    width: 190,
    height: 4,
    borderRadius: 99,
    backgroundColor: colors.neutral900,
    marginTop: 12,
    overflow: 'hidden',
  },
  xpFill: {
    height: 4,
    borderRadius: 99,
    backgroundColor: colors.accent500,
  },
  xpHint: {
    fontFamily: font.regular,
    fontSize: 11,
    color: colors.neutral500,
    marginTop: 6,
  },
  statGrid: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 18,
  },
  statCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
  },
  statValue: {
    fontFamily: font.medium,
    fontSize: 24,
    color: colors.text,
  },
  badgeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  badgeCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeLabel: {
    fontFamily: font.medium,
    fontSize: 7.5,
    letterSpacing: 0.7,
    color: colors.neutral500,
    textAlign: 'center',
    maxWidth: 52,
  },
  whyText: {
    fontFamily: font.regular,
    fontSize: 13.5,
    color: colors.neutral300,
    fontStyle: 'italic',
    lineHeight: 19,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 48,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  rowLabel: {
    flex: 1,
    fontFamily: font.regular,
    fontSize: 14,
    color: colors.text,
  },
  rowMeta: {
    fontFamily: font.medium,
    fontSize: 12.5,
    letterSpacing: 1.5,
    color: colors.neutral500,
  },
});
