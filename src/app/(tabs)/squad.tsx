import * as Clipboard from 'expo-clipboard';
import { UsersThreeIcon as UsersThree } from 'phosphor-react-native';
import React, { useEffect, useState } from 'react';
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
import {
  InitialsTile,
  Micro,
  SegmentBar,
  Skew,
} from '@/components/primitives';
import { ScreenState } from '@/components/ScreenState';
import {
  Card,
  Kicker,
  OutlineButton,
  SegmentedControl,
} from '@/components/ui';
import { PINGS } from '@/constants/challenge';
import { PING_QUIPS } from '@/data/mock';
import type {
  FeedItem,
  ReportReason,
  Squad,
  SquadMember,
} from '@/data/types';
import { normalizeInviteCode } from '@/lib/inviteCode';
import {
  relativeTime,
  selectPingsLeft,
  selectTaskCount,
  selectTierLabel,
  useAppStore,
} from '@/store/useAppStore';
import { toast } from '@/store/useToastStore';
import { colors, font, microTracking, radius, space } from '@/theme/tokens';

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
                // By id where the feed row carries one. Blocking by display
                // name failed for exactly the person it mattered for: a
                // squadmate whose profile RLS will not resolve reads as
                // "Squadmate", and no roster row answers to that.
                blockUser({ id: item.authorId, name: item.who });
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
  newest,
  onLongPress,
}: {
  item: FeedItem;
  newest: boolean;
  onLongPress: (item: FeedItem) => void;
}) {
  const inbound = item.kind === 'ping-in';
  // A ping carries a written message, and the message is the part worth
  // reading — so it, and only it, gets the serif.
  const isPing = inbound || item.kind === 'ping-out';

  return (
    <Pressable
      onLongPress={() => onLongPress(item)}
      delayLongPress={450}
      style={styles.feedRow}
    >
      {/* Newest carries the accent rule. */}
      <View
        style={[
          styles.feedRule,
          { backgroundColor: newest ? colors.accent : 'transparent' },
        ]}
      />
      <Text style={styles.feedText} numberOfLines={2}>
        <Text style={{ fontFamily: font.bold, color: colors.textHi }}>
          {item.who}{' '}
        </Text>
        {inbound ? 'pinged you \u2014 ' : ''}
        {isPing ? (
          <Text style={styles.feedQuote}>
            {'\u201C'}
            {item.text}
            {'\u201D'}
          </Text>
        ) : (
          item.text
        )}
      </Text>
      <Micro size={10} color={colors.textLow}>
        {relativeTime(item.timestamp)}
      </Micro>
    </Pressable>
  );
}

/** Solo mode: the Squad tab's invite-code empty state. */
function SoloState() {
  const createSquad = useAppStore((s) => s.createSquad);
  const joinSquad = useAppStore((s) => s.joinSquad);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  // Both paths await the server and report what it said. The invite code is
  // minted server-side and the refusals — a used code, a bad one — are only
  // knowable there, so guessing optimistically is what produced a header
  // showing six dots.
  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast('Give your squad a name first');
      return;
    }
    setBusy(true);
    try {
      await createSquad(trimmed);
      toast(`${trimmed} created`);
      setName('');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not create that squad.');
    } finally {
      setBusy(false);
    }
  };

  const join = async () => {
    setBusy(true);
    try {
      await joinSquad(code);
      setCode('');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not join that squad.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: 14 }}>
      <Card style={{ alignItems: 'center', paddingVertical: 30 }}>
        <UsersThree size={34} color={colors.neutral500} />
        <Text style={styles.soloTitle}>No squad. No problem.</Text>
        <Text style={styles.soloSub}>
          The challenge counts the same solo. Add a squad when you want
          witnesses.
        </Text>
        {/* The name is asked for, not invented. Every squad this app has
            ever created was called "Group 1", because nothing asked and the
            client sent a literal. The server now refuses a nameless squad
            outright, so this field is the only way one gets made. */}
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Name your squad"
          placeholderTextColor={colors.textLow}
          style={styles.squadNameInput}
          maxLength={30}
          editable={!busy}
          onSubmitEditing={create}
        />
        <OutlineButton
          label={busy ? 'Creating…' : 'Create a squad'}
          disabled={busy}
          onPress={create}
          style={{ marginTop: 12, alignSelf: 'stretch' }}
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
            disabled={busy}
            onPress={() => {
              // Normalised on the way in as well as on the way out: this
              // arrives pasted out of a text message, in any case, with
              // whatever whitespace came with it.
              if (!normalizeInviteCode(code)) return;
              join();
            }}
            style={{ minHeight: 42 }}
          />
        </View>
      </View>
    </View>
  );
}

/**
 * Squad settings: rename, and leave. Both live next to the invite code
 * because that is where the squad's own identity is on screen — a squad you
 * administer from the app's Settings tab is a squad you have to go looking
 * for.
 *
 * Rename is CREATOR ONLY, and the control is absent rather than disabled for
 * everyone else: a greyed-out field invites a tap that can only ever fail.
 * The server refuses regardless — that is where the rule actually lives —
 * so this is presentation, not enforcement.
 */
function SquadSettingsSheet({
  squad,
  visible,
  onClose,
}: {
  squad: Squad;
  visible: boolean;
  onClose: () => void;
}) {
  const renameSquad = useAppStore((s) => s.renameSquad);
  const leaveSquad = useAppStore((s) => s.leaveSquad);
  const [draft, setDraft] = useState(squad.name);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  // The sheet outlives the squad it was opened for when the user switches,
  // so the draft follows the squad rather than whatever was typed last.
  useEffect(() => {
    setDraft(squad.name);
    setConfirming(false);
  }, [squad.id, squad.name]);

  const rename = async () => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === squad.name) return;
    setBusy(true);
    try {
      await renameSquad(squad.id, trimmed);
      toast(`Renamed to ${trimmed}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not rename that squad.');
    } finally {
      setBusy(false);
    }
  };

  const leave = async () => {
    setBusy(true);
    try {
      await leaveSquad(squad.id);
      toast(`Left ${squad.name}`);
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not leave that squad.');
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Kicker style={{ marginBottom: 12 }}>{squad.name}</Kicker>

      {squad.isCreator ? (
        <>
          <Micro color={colors.textMid}>Name</Micro>
          <View style={styles.sendRow}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              style={styles.input}
              maxLength={30}
              editable={!busy}
              onSubmitEditing={rename}
              accessibilityLabel="Squad name"
            />
            <OutlineButton
              label={busy ? '…' : 'Save'}
              small
              onPress={rename}
              style={{ minHeight: 42 }}
            />
          </View>
        </>
      ) : (
        <Text style={styles.settingsNote}>
          Only whoever created this squad can rename it.
        </Text>
      )}

      <View style={styles.settingsDivider} />

      {confirming ? (
        <>
          {/* Names the squad. With several memberships the only thing that
              tells these apart is the name, so "Leave squad?" is a question
              the user cannot safely answer. */}
          <Text style={styles.settingsNote}>
            Leave {squad.name}? Your challenge, streak and history stay
            exactly as they are — a squad is social only.
          </Text>
          <View style={styles.settingsActions}>
            <OutlineButton
              label={busy ? 'Leaving…' : `Leave ${squad.name}`}
              small
              tone="neutral"
              onPress={leave}
            />
            <OutlineButton
              label="Cancel"
              small
              tone="ghost"
              onPress={() => setConfirming(false)}
            />
          </View>
        </>
      ) : (
        <OutlineButton
          label="Leave squad"
          small
          tone="neutral"
          onPress={() => setConfirming(true)}
          style={{ alignSelf: 'flex-start' }}
        />
      )}
    </BottomSheet>
  );
}

function SquadTab({ onPing }: { onPing: (m: SquadMember) => void }) {
  const squad = useAppStore((s) => s.squad);
  const feed = useAppStore((s) => s.feed);
  const blockedUsers = useAppStore((s) => s.blockedUsers);
  const taskCount = useAppStore(selectTaskCount);
  const pingsLeft = useAppStore(selectPingsLeft);
  const [moderating, setModerating] = useState<FeedItem | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const squads = useAppStore((s) => s.squads);
  const setActiveSquad = useAppStore((s) => s.setActiveSquad);

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

  // Keyed on the author id, with the name only as a fallback for rows this
  // device composed itself (and for the mock, which has no ids). A blocked
  // user whose name RLS will not resolve renders as "Squadmate" and slipped
  // straight through a name-keyed filter; two squadmates sharing a display
  // name hid each other.
  const blockedIds = new Set(blockedUsers.map((b) => b.id));
  const blockedNames = new Set(blockedUsers.map((b) => b.name));
  const visibleFeed = feed.filter((f) =>
    f.authorId ? !blockedIds.has(f.authorId) : !blockedNames.has(f.who),
  );
  const outOfPings = pingsLeft === 0;

  return (
    <View style={{ gap: 14 }}>
      {/* Only when there IS a choice. With one squad a switcher is a control
          that does nothing, and one squad is the common case — it does not
          pay for the rare one. */}
      {squads.length > 1 && (
        <SegmentedControl
          segments={squads.map((q) => q.name)}
          value={squad.name}
          onChange={(name) => {
            const next = squads.find((q) => q.name === name);
            if (next) setActiveSquad(next.id).catch(() => {});
          }}
        />
      )}
      <Card>
        <View style={styles.squadHeader}>
          {/* Flexible so a long squad name can never squeeze the code out
              of the row — the code is the one thing here that must stay
              fully readable. */}
          <View style={{ flex: 1, minWidth: 150, paddingRight: 12 }}>
            <Text style={styles.squadName} numberOfLines={2}>
              {squad.name}
            </Text>
            <View style={styles.squadStreakRow}>
              {/* Zero is not a streak of length zero, it is a squad that
                  has not finished a day together yet — say that. */}
              <Micro color={colors.accent400}>
                {squad.streak > 0
                  ? `${squad.streak}-day squad streak`
                  : 'Squad starts today'}
              </Micro>
              <View style={styles.diamond} />
            </View>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Micro color={colors.textMid}>Invite code</Micro>
            {squad.code ? (
              <>
                {/* Plain selectable Text: readable aloud, and long-press
                    still works if the clipboard is unavailable. It scales
                    with the system font — the row wraps rather than clips. */}
                <Text
                  style={styles.inviteCode}
                  selectable
                  maxFontSizeMultiplier={1.5}
                >
                  {squad.code}
                </Text>
                <View style={styles.codeActions}>
                  <OutlineButton label="Copy" small onPress={copyCode} />
                  <OutlineButton
                    label="Settings"
                    small
                    tone="ghost"
                    onPress={() => setSettingsOpen(true)}
                  />
                </View>
              </>
            ) : (
              <Text style={styles.inviteCodePending}>Getting code…</Text>
            )}
          </View>
        </View>
      </Card>

      <SquadSettingsSheet
        squad={squad}
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />

      <View>
        <View style={styles.membersHeader}>
          <Micro color={colors.textMid}>Members</Micro>
          <Micro color={outOfPings ? colors.textLow : colors.textMid}>
            {pingsLeft} of {PINGS.maxPerDay} pings left today
          </Micro>
        </View>
        {squad.members.map((m) => {
          // Squadmates run their own tiers, so their denominator is theirs,
          // not the viewer's. Your own row stays on your live task list —
          // it updates the moment a task is added, without a squad refresh.
          const total = m.isSelf ? taskCount : m.tasksToday || taskCount;
          return (
          <View key={m.id} style={styles.memberRow}>
            <InitialsTile initials={m.initials} active={m.isSelf} size={44} />
            <View style={{ flex: 1, gap: 8 }}>
              <View style={styles.memberNameRow}>
                <Text style={styles.memberName}>{m.name}</Text>
                {/* Day N of M, per member. Challenge length is a personal
                    choice that can change mid-run, so a bare "Day 12" says
                    nothing about how far through someone is — and if a
                    squadmate shortens their challenge, this is where the
                    squad sees it. Visibility, not enforcement. */}
                {m.durationDays > 0 && (
                  <Text style={styles.memberDay}>
                    Day {m.day} / {m.durationDays}
                  </Text>
                )}
              </View>
              {/* This member's OWN task count, never the viewer's. */}
              <SegmentBar done={Math.min(m.doneToday, total)} total={total} />
            </View>
            <Text style={styles.memberCount} maxFontSizeMultiplier={1.4}>
              {Math.min(m.doneToday, total)}/{total}
            </Text>
            {!m.isSelf && (
              <Skew
                label="Ping"
                size="sm"
                tone={outOfPings ? 'muted' : 'accent'}
                disabled={outOfPings}
                onPress={() => onPing(m)}
                accessibilityLabel={"Ping " + m.name}
              />
            )}
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
        <Micro color={colors.textMid} style={{ marginBottom: 10 }}>
          Today
        </Micro>
        {visibleFeed.length === 0 ? (
          <Text style={styles.empty}>
            No activity yet. Be the first to lock in.
          </Text>
        ) : (
          visibleFeed.map((f, i) => (
            <FeedRow
              key={f.id}
              item={f}
              newest={i === 0}
              onLongPress={setModerating}
            />
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
                borderColor: colors.accent,
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
        <View style={styles.header}>
          <Text style={styles.title}>Squad</Text>
          <SegmentedControl
            segments={['SQUAD', 'LEADERBOARD']}
            value={tab}
            onChange={setTab}
          />
        </View>
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
  header: {
    flexDirection: 'row',
    // flex-end, not baseline: the tab underline is a View, which has no
    // baseline to align to.
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 18,
  },
  title: {
    fontFamily: font.bold,
    fontSize: 32,
    letterSpacing: -1,
    color: colors.textHi,
  },
  squadHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
  },
  squadName: {
    fontFamily: font.bold,
    fontSize: 22,
    letterSpacing: -0.5,
    color: colors.textHi,
  },
  squadStreakRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  },
  diamond: {
    width: 8,
    height: 8,
    backgroundColor: colors.accent,
    transform: [{ rotate: '45deg' }],
  },
  settingsNote: {
    fontFamily: font.regular,
    fontSize: 12.5,
    color: colors.textLow,
    lineHeight: 17,
  },
  settingsDivider: {
    height: 1,
    backgroundColor: colors.line,
    marginVertical: 16,
  },
  settingsActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  codeActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  inviteCode: {
    // Monospace on purpose: this gets read out loud, and 0/O and 1/I have
    // to be tellable apart.
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    fontSize: 26,
    letterSpacing: 3,
    color: colors.textHi,
    marginTop: 6,
  },
  inviteCodePending: {
    fontFamily: font.regular,
    fontSize: 13,
    color: colors.textMid,
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
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: 68,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  memberNameRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
  },
  memberDay: {
    fontFamily: font.regular,
    fontSize: 11,
    color: colors.textLow,
    fontVariant: ['tabular-nums'],
  },
  memberName: {
    fontFamily: font.bold,
    fontSize: 17,
    letterSpacing: -0.3,
    color: colors.textHi,
  },
  memberCount: {
    fontFamily: font.semibold,
    fontSize: 13,
    color: colors.textMid,
    fontVariant: ['tabular-nums'],
  },
  outOfPings: {
    fontFamily: font.regular,
    fontSize: 12,
    color: colors.textLow,
    marginTop: 10,
  },
  feedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    paddingRight: 14,
    paddingVertical: 12,
    marginBottom: 6,
  },
  feedRule: {
    width: 2,
    alignSelf: 'stretch',
    marginVertical: -12,
  },
  feedText: {
    flex: 1,
    fontFamily: font.regular,
    fontSize: 13.5,
    color: colors.textMid,
    lineHeight: 19,
  },
  feedQuote: {
    fontFamily: font.serifItalic,
    color: colors.accent400,
  },
  timeMeta: {
    fontFamily: font.regular,
    fontSize: 10.5,
    color: colors.textLow,
  },
  empty: {
    fontFamily: font.regular,
    fontSize: 13,
    color: colors.textMid,
    paddingVertical: 10,
  },
  squadNameInput: {
    alignSelf: 'stretch',
    marginTop: 18,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 14,
    minHeight: 44,
    fontFamily: font.medium,
    fontSize: 15,
    color: colors.textHi,
  },
  soloTitle: {
    fontFamily: font.bold,
    fontSize: 20,
    letterSpacing: -0.4,
    color: colors.textHi,
    marginTop: 14,
  },
  soloSub: {
    fontFamily: font.regular,
    fontSize: 13.5,
    color: colors.textMid,
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 19,
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
    borderColor: colors.line,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  quipText: {
    fontFamily: font.medium,
    fontSize: 13,
    color: colors.textMid,
  },
  reasonRow: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    marginBottom: 2,
  },
  reasonText: {
    fontFamily: font.medium,
    fontSize: 15,
    color: colors.textHi,
  },
  sendRow: {
    flexDirection: 'row',
    gap: 8,
  },
  input: {
    flex: 1,
    fontFamily: font.regular,
    fontSize: 14,
    color: colors.textHi,
    minHeight: 44,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.line,
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
    width: 20,
    fontFamily: font.black,
    fontSize: 15,
    color: colors.textLow,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  leaderName: {
    flex: 1,
    fontFamily: font.bold,
    fontSize: 15,
    letterSpacing: -0.2,
    color: colors.textHi,
  },
  leaderTierTag: {
    backgroundColor: colors.accentDeep,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  leaderTierText: {
    fontFamily: font.semibold,
    fontSize: 9,
    letterSpacing: microTracking(9),
    textTransform: 'uppercase',
    color: colors.accent400,
  },
  leaderXp: {
    fontFamily: font.semibold,
    fontSize: 13,
    color: colors.textMid,
    fontVariant: ['tabular-nums'],
  },
  footerNote: {
    fontFamily: font.regular,
    fontSize: 12,
    color: colors.textLow,
    textAlign: 'center',
    marginTop: 4,
  },
});
