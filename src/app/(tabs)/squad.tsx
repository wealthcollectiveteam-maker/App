import * as Clipboard from 'expo-clipboard';
import {
  BellIcon as Bell,
  CameraIcon as Camera,
  CheckCircleIcon as CheckCircle,
  PaperPlaneRightIcon as PaperPlaneRight,
  PencilSimpleIcon as PencilSimple,
  UsersThreeIcon as UsersThree,
} from 'phosphor-react-native';
import React, { useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { BottomSheet } from '@/components/BottomSheet';
import { FlairAvatar } from '@/components/FlairAvatar';
import { ScreenState } from '@/components/ScreenState';
import {
  Card,
  Kicker,
  OutlineButton,
  SegmentedControl,
} from '@/components/ui';
import { PINGS } from '@/constants/challenge';
import { PING_QUIPS } from '@/data/mock';
import type { FeedItem, ReportReason, SquadMember } from '@/data/types';
import { normalizeInviteCode } from '@/lib/inviteCode';
import {
  relativeTime,
  selectPingsLeft,
  selectTaskCount,
  selectTierLabel,
  useAppStore,
} from '@/store/useAppStore';
import { toast } from '@/store/useToastStore';
import { colors, font, radius, space } from '@/theme/tokens';

const REPORT_REASONS: ReportReason[] = [
  'Spam',
  'Harassment',
  'Inappropriate content',
  'Other',
];

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
    const sent = sendPing(member.name, message);
    toast(sent ? `Ping sent to ${member.name}` : 'Out of pings — resets at midnight');
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

/** Long-press a feed row for UGC moderation: report content or block user. */
function ModerationSheet({
  item,
  onClose,
}: {
  item: FeedItem | null;
  onClose: () => void;
}) {
  const reportFeedItem = useAppStore((s) => s.reportFeedItem);
  const blockUser = useAppStore((s) => s.blockUser);
  const [reporting, setReporting] = useState(false);

  const close = () => {
    setReporting(false);
    onClose();
  };

  return (
    <BottomSheet visible={!!item} onClose={close}>
      {!reporting ? (
        <>
          <Kicker style={{ marginBottom: 12 }}>
            {item?.who} — {item?.text}
          </Kicker>
          <OutlineButton
            label="Report content"
            tone="neutral"
            onPress={() => setReporting(true)}
            style={{ marginBottom: 8 }}
          />
          {item && item.who !== 'You' && (
            <OutlineButton
              label={`Block ${item.who}`}
              tone="neutral"
              onPress={() => {
                blockUser(item.who);
                toast(`${item.who} blocked`);
                close();
              }}
            />
          )}
        </>
      ) : (
        <>
          <Kicker style={{ marginBottom: 12 }}>Report — why?</Kicker>
          {REPORT_REASONS.map((r) => (
            <Pressable
              key={r}
              onPress={() => {
                if (item) reportFeedItem(item.id, r);
                toast('Report submitted');
                close();
              }}
              style={styles.reasonRow}
            >
              <Text style={styles.reasonText}>{r}</Text>
            </Pressable>
          ))}
        </>
      )}
    </BottomSheet>
  );
}

function FeedRow({
  item,
  onLongPress,
}: {
  item: FeedItem;
  onLongPress: (item: FeedItem) => void;
}) {
  const inbound = item.kind === 'ping-in';
  const Icon =
    item.kind === 'proof'
      ? Camera
      : item.kind === 'complete'
        ? CheckCircle
        : item.kind === 'change'
          ? PencilSimple
          : inbound
            ? Bell
            : PaperPlaneRight;

  return (
    <Pressable
      onLongPress={() => onLongPress(item)}
      delayLongPress={450}
      style={[styles.feedRow, inbound && styles.feedRowInbound]}
    >
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
    </Pressable>
  );
}

/** Solo mode: the Squad tab's invite-code empty state. */
function SoloState() {
  const createSquad = useAppStore((s) => s.createSquad);
  const joinSquad = useAppStore((s) => s.joinSquad);
  const [code, setCode] = useState('');

  return (
    <View style={{ gap: 14 }}>
      <Card style={{ alignItems: 'center', paddingVertical: 30 }}>
        <UsersThree size={34} color={colors.neutral500} />
        <Text style={styles.soloTitle}>No squad. No problem.</Text>
        <Text style={styles.soloSub}>
          The challenge counts the same solo. Add a squad when you want
          witnesses.
        </Text>
        <OutlineButton
          label="Create a squad"
          onPress={() => {
            createSquad('Group 1');
            // The server mints the code; it appears in the header a moment
            // later. Naming one here would be inventing it — the old toast
            // read out the mock's code on every real build.
            toast('Squad created — your invite code is on the way');
          }}
          style={{ marginTop: 18, alignSelf: 'stretch' }}
        />
      </Card>
      <View>
        <Kicker color={colors.neutral500} style={{ marginBottom: 8 }}>
          Have an invite code?
        </Kicker>
        <View style={styles.sendRow}>
          <TextInput
            value={code}
            onChangeText={(v) => setCode(normalizeInviteCode(v))}
            placeholder="Enter invite code"
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="off"
            placeholderTextColor={colors.neutral600}
            style={[styles.input, styles.codeInput]}
          />
          <OutlineButton
            label="Join"
            small
            onPress={() => {
              // Normalised on the way in as well as on the way out: this
              // arrives pasted out of a text message, in any case, with
              // whatever whitespace came with it.
              const c = normalizeInviteCode(code);
              if (!c) return;
              joinSquad(c);
              // Which squad it is comes back from the server.
              toast('Joining squad…');
              setCode('');
            }}
            style={{ minHeight: 42 }}
          />
        </View>
      </View>
    </View>
  );
}

function SquadTab({ onPing }: { onPing: (m: SquadMember) => void }) {
  const squad = useAppStore((s) => s.squad);
  const feed = useAppStore((s) => s.feed);
  const blockedUsers = useAppStore((s) => s.blockedUsers);
  const taskCount = useAppStore(selectTaskCount);
  const pingsLeft = useAppStore(selectPingsLeft);
  const [moderating, setModerating] = useState<FeedItem | null>(null);

  // Copies the value from STATE. Nothing here reads the rendered view, and
  // the code is plain Text, not an input — a secure/managed field is how a
  // copy control ends up putting something other than the code on the
  // clipboard.
  const copyCode = async () => {
    const value = squad?.code ?? '';
    if (!value) {
      toast('The invite code hasn’t arrived yet — one moment');
      return;
    }
    try {
      await Clipboard.setStringAsync(value);
      toast(`Invite code ${value} copied`);
    } catch {
      toast('Could not copy — the code is above, tap and hold to select');
    }
  };

  if (!squad) return <SoloState />;

  const visibleFeed = feed.filter((f) => !blockedUsers.includes(f.who));
  const outOfPings = pingsLeft === 0;

  return (
    <View style={{ gap: 14 }}>
      <Card>
        <View style={styles.squadHeader}>
          {/* Flexible so a long squad name can never squeeze the code out
              of the row — the code is the one thing here that must stay
              fully readable. */}
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={styles.squadName} numberOfLines={2}>
              {squad.name}
            </Text>
            <Text style={styles.squadStreak}>
              {squad.streak}-day squad streak
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Kicker color={colors.neutral500}>Invite code</Kicker>
            {squad.code ? (
              <>
                {/* Plain selectable Text: readable aloud, and long-press
                    still works if the clipboard is unavailable. */}
                <Text style={styles.inviteCode} selectable>
                  {squad.code}
                </Text>
                <OutlineButton
                  label="Copy"
                  small
                  onPress={copyCode}
                  style={{ marginTop: 6 }}
                />
              </>
            ) : (
              <Text style={styles.inviteCodePending}>Getting code…</Text>
            )}
          </View>
        </View>
      </Card>

      <View>
        <View style={styles.membersHeader}>
          <Kicker color={colors.neutral500}>Members</Kicker>
          <Text
            style={[
              styles.pingCounter,
              outOfPings && { color: colors.neutral600 },
            ]}
          >
            {pingsLeft} of {PINGS.maxPerDay} pings left today
          </Text>
        </View>
        {squad.members.map((m) => {
          // Squadmates run their own tiers, so their denominator is theirs,
          // not the viewer's. Your own row stays on your live task list —
          // it updates the moment a task is added, without a squad refresh.
          const total = m.isSelf ? taskCount : m.tasksToday || taskCount;
          return (
          <View key={m.id} style={styles.memberRow}>
            <FlairAvatar initials={m.initials} level={m.level} size={36} />
            <View style={{ flex: 1 }}>
              <Text style={styles.memberName}>{m.name}</Text>
              <Text style={styles.memberMeta}>
                {Math.min(m.doneToday, total)} of {total} today
              </Text>
            </View>
            {!m.isSelf &&
              (outOfPings ? (
                <View style={styles.pingDisabled}>
                  <Text style={styles.pingDisabledText}>PING</Text>
                </View>
              ) : (
                <OutlineButton label="Ping" small onPress={() => onPing(m)} />
              ))}
          </View>
          );
        })}
        {outOfPings && (
          <Text style={styles.outOfPings}>
            Out of pings — resets at midnight
          </Text>
        )}
      </View>

      <View>
        <Kicker color={colors.neutral500} style={{ marginBottom: 8 }}>
          Today
        </Kicker>
        {visibleFeed.length === 0 ? (
          <Text style={styles.empty}>
            No activity yet. Be the first to lock in.
          </Text>
        ) : (
          visibleFeed.map((f) => (
            <FeedRow key={f.id} item={f} onLongPress={setModerating} />
          ))
        )}
      </View>

      <ModerationSheet item={moderating} onClose={() => setModerating(null)} />
    </View>
  );
}

function LeaderboardTab() {
  const [range, setRange] = useState('THIS WEEK');
  const week = useAppStore((s) => s.leaderboardWeek);
  const allTime = useAppStore((s) => s.leaderboardAllTime);
  // The self row's tier tag renders live so CUSTOM shows the day it applies.
  const selfTierLabel = useAppStore(selectTierLabel);
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
            <View style={styles.leaderTierTag}>
              <Text style={styles.leaderTierText}>
                {r.isSelf ? selfTierLabel : r.tierLabel}
              </Text>
            </View>
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
    <ScreenState>
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
    </ScreenState>
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
    // Monospace on purpose: this gets read out loud, and 0/O and 1/I have
    // to be tellable apart.
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    fontSize: 26,
    letterSpacing: 3,
    color: colors.accent300,
    marginTop: 3,
  },
  inviteCodePending: {
    fontFamily: font.regular,
    fontSize: 13,
    color: colors.neutral500,
    marginTop: 6,
  },
  codeInput: {
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    letterSpacing: 2,
  },
  membersHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  pingCounter: {
    fontFamily: font.regular,
    fontSize: 11,
    color: colors.neutral500,
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
  pingDisabled: {
    minHeight: 32,
    borderWidth: 1,
    borderColor: colors.neutral700,
    borderRadius: radius.sm,
    paddingVertical: 6,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pingDisabledText: {
    fontFamily: font.medium,
    fontSize: 10.5,
    letterSpacing: 1.9,
    color: colors.neutral600,
  },
  outOfPings: {
    fontFamily: font.regular,
    fontSize: 11.5,
    color: colors.neutral600,
    marginTop: 6,
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
  soloTitle: {
    fontFamily: font.medium,
    fontSize: 17,
    color: colors.text,
    marginTop: 12,
  },
  soloSub: {
    fontFamily: font.regular,
    fontSize: 12.5,
    color: colors.neutral500,
    marginTop: 6,
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 16,
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
  reasonRow: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    marginBottom: 2,
  },
  reasonText: {
    fontFamily: font.regular,
    fontSize: 14,
    color: colors.text,
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
  leaderTierTag: {
    backgroundColor: colors.accent900,
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  leaderTierText: {
    fontFamily: font.medium,
    fontSize: 8.5,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.accent300,
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
