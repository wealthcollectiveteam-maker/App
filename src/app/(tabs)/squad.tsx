import * as Clipboard from 'expo-clipboard';
import {
  BellIcon as Bell,
  CameraIcon as Camera,
  CheckCircleIcon as CheckCircle,
  PaperPlaneRightIcon as PaperPlaneRight,
} from 'phosphor-react-native';
import React, { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { BottomSheet } from '@/components/BottomSheet';
import { FlairAvatar } from '@/components/FlairAvatar';
import {
  Card,
  Kicker,
  OutlineButton,
  SegmentedControl,
} from '@/components/ui';
import { PING_QUIPS } from '@/data/mock';
import type { FeedItem, SquadMember } from '@/data/types';
import { relativeTime, useAppStore } from '@/store/useAppStore';
import { toast } from '@/store/useToastStore';
import { colors, font, radius, space } from '@/theme/tokens';

function PingSheet({
  member,
  onClose,
}: {
  member: SquadMember | null;
  onClose: () => void;
}) {
  const sendPing = useAppStore((s) => s.sendPing);
  const [text, setText] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const send = () => {
    const message = text.trim() || selected;
    if (!message || !member) return;
    sendPing(member.name, message);
    toast(`Ping sent to ${member.name}`);
    setText('');
    setSelected(null);
    onClose();
  };

  return (
    <BottomSheet visible={!!member} onClose={onClose}>
      <Kicker style={{ marginBottom: 12 }}>
        Ping {member?.name ?? ''}
      </Kicker>
      <View style={styles.quipWrap}>
        {PING_QUIPS.map((q) => {
          const active = selected === q;
          return (
            <Pressable
              key={q}
              onPress={() => setSelected(active ? null : q)}
              style={[
                styles.quip,
                active && {
                  borderColor: colors.accent500,
                  backgroundColor: colors.accentTint,
                },
              ]}
            >
              <Text
                style={[
                  styles.quipText,
                  active && { color: colors.accent200 },
                ]}
              >
                {q}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.sendRow}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="…or say it your way"
          placeholderTextColor={colors.neutral600}
          style={styles.input}
          onSubmitEditing={send}
        />
        <OutlineButton label="Send" small onPress={send} style={{ minHeight: 42 }} />
      </View>
    </BottomSheet>
  );
}

function FeedRow({ item }: { item: FeedItem }) {
  const inbound = item.kind === 'ping-in';
  const Icon =
    item.kind === 'proof'
      ? Camera
      : item.kind === 'complete'
        ? CheckCircle
        : inbound
          ? Bell
          : PaperPlaneRight;

  return (
    <View style={[styles.feedRow, inbound && styles.feedRowInbound]}>
      <Icon
        size={16}
        weight={inbound ? 'fill' : 'regular'}
        color={inbound ? colors.accent300 : colors.neutral500}
      />
      <Text style={styles.feedText} numberOfLines={2}>
        <Text style={{ fontFamily: font.semibold, color: colors.text }}>
          {item.who}{' '}
        </Text>
        {inbound ? `pinged you — ${item.text}` : item.text}
      </Text>
      <Text style={styles.timeMeta}>{relativeTime(item.timestamp)}</Text>
    </View>
  );
}

function SquadTab({ onPing }: { onPing: (m: SquadMember) => void }) {
  const squad = useAppStore((s) => s.squad);
  const feed = useAppStore((s) => s.feed);

  const copyCode = async () => {
    await Clipboard.setStringAsync(squad.code);
    toast('Invite code copied');
  };

  return (
    <View style={{ gap: 14 }}>
      <Card>
        <View style={styles.squadHeader}>
          <View>
            <Text style={styles.squadName}>{squad.name}</Text>
            <Text style={styles.squadStreak}>
              {squad.streak}-day squad streak
            </Text>
          </View>
          <Pressable onPress={copyCode} style={{ alignItems: 'flex-end' }}>
            <Kicker color={colors.neutral500}>Invite code</Kicker>
            <Text style={styles.inviteCode}>{squad.code}</Text>
          </Pressable>
        </View>
      </Card>

      <View>
        <Kicker color={colors.neutral500} style={{ marginBottom: 8 }}>
          Members
        </Kicker>
        {squad.members.map((m) => (
          <View key={m.id} style={styles.memberRow}>
            <FlairAvatar initials={m.initials} level={m.level} size={36} />
            <View style={{ flex: 1 }}>
              <Text style={styles.memberName}>{m.name}</Text>
              <Text style={styles.memberMeta}>{m.doneToday} of 6 today</Text>
            </View>
            {!m.isSelf && (
              <OutlineButton label="Ping" small onPress={() => onPing(m)} />
            )}
          </View>
        ))}
      </View>

      <View>
        <Kicker color={colors.neutral500} style={{ marginBottom: 8 }}>
          Today
        </Kicker>
        {feed.length === 0 ? (
          <Text style={styles.empty}>
            No activity yet. Be the first to lock in.
          </Text>
        ) : (
          feed.map((f) => <FeedRow key={f.id} item={f} />)
        )}
      </View>
    </View>
  );
}

function LeaderboardTab() {
  const [range, setRange] = useState('THIS WEEK');
  const week = useAppStore((s) => s.leaderboardWeek);
  const allTime = useAppStore((s) => s.leaderboardAllTime);
  const rows = range === 'THIS WEEK' ? week : allTime;

  return (
    <View style={{ gap: 14 }}>
      <SegmentedControl
        segments={['THIS WEEK', 'ALL-TIME']}
        value={range}
        onChange={setRange}
      />
      <View>
        {rows.map((r, i) => (
          <View
            key={r.id}
            style={[
              styles.leaderRow,
              r.isSelf && {
                borderWidth: 1,
                borderColor: colors.accent700,
                borderRadius: radius.sm,
              },
            ]}
          >
            <Text
              style={[
                styles.rank,
                i === 0 && { color: colors.accent400 },
              ]}
            >
              {i + 1}
            </Text>
            <FlairAvatar
              initials={r.name.slice(0, 2).toUpperCase()}
              level={r.level}
              size={32}
            />
            <Text style={styles.leaderName}>{r.name}</Text>
            <Text style={styles.leaderXp}>{r.xp.toLocaleString()} XP</Text>
          </View>
        ))}
      </View>
      <Text style={styles.footerNote}>
        XP resets weekly. Flames don{'\u2019'}t lie.
      </Text>
    </View>
  );
}

export default function SquadScreen() {
  const [tab, setTab] = useState('SQUAD');
  const [pingTarget, setPingTarget] = useState<SquadMember | null>(null);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>Squad</Text>
      <SegmentedControl
        segments={['SQUAD', 'LEADERBOARD']}
        value={tab}
        onChange={setTab}
        style={{ marginBottom: 16 }}
      />
      {tab === 'SQUAD' ? (
        <SquadTab onPing={setPingTarget} />
      ) : (
        <LeaderboardTab />
      )}
      <PingSheet member={pingTarget} onClose={() => setPingTarget(null)} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: space.screenX,
    paddingTop: 8,
    paddingBottom: 28,
  },
  title: {
    fontFamily: font.medium,
    fontSize: 24,
    color: colors.text,
    marginBottom: 14,
  },
  squadHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  squadName: {
    fontFamily: font.medium,
    fontSize: 18,
    color: colors.text,
  },
  squadStreak: {
    fontFamily: font.regular,
    fontSize: 12,
    color: colors.neutral500,
    marginTop: 3,
  },
  inviteCode: {
    fontFamily: font.medium,
    fontSize: 14,
    letterSpacing: 2,
    color: colors.accent300,
    marginTop: 3,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
  },
  memberName: {
    fontFamily: font.medium,
    fontSize: 14,
    color: colors.text,
  },
  memberMeta: {
    fontFamily: font.regular,
    fontSize: 11.5,
    color: colors.neutral500,
    marginTop: 1,
  },
  feedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 6,
  },
  feedRowInbound: {
    backgroundColor: colors.accent900,
  },
  feedText: {
    flex: 1,
    fontFamily: font.regular,
    fontSize: 12.5,
    color: colors.neutral300,
    lineHeight: 17,
  },
  timeMeta: {
    fontFamily: font.regular,
    fontSize: 10.5,
    color: colors.neutral600,
  },
  empty: {
    fontFamily: font.regular,
    fontSize: 12.5,
    color: colors.neutral500,
    paddingVertical: 10,
  },
  quipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  quip: {
    borderWidth: 1,
    borderColor: colors.neutral700,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  quipText: {
    fontFamily: font.regular,
    fontSize: 12.5,
    color: colors.neutral300,
  },
  sendRow: {
    flexDirection: 'row',
    gap: 8,
  },
  input: {
    flex: 1,
    fontFamily: font.regular,
    fontSize: 13.5,
    color: colors.text,
    minHeight: 42,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
  },
  leaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    paddingHorizontal: 10,
  },
  rank: {
    width: 18,
    fontFamily: font.medium,
    fontSize: 14,
    color: colors.neutral500,
    textAlign: 'center',
  },
  leaderName: {
    flex: 1,
    fontFamily: font.medium,
    fontSize: 14,
    color: colors.text,
  },
  leaderXp: {
    fontFamily: font.regular,
    fontSize: 13,
    color: colors.neutral400,
  },
  footerNote: {
    fontFamily: font.regular,
    fontSize: 11.5,
    color: colors.neutral600,
    textAlign: 'center',
    marginTop: 4,
  },
});
