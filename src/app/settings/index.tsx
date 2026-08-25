import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import {
  CaretLeftIcon as CaretLeft,
  CaretRightIcon as CaretRight,
} from 'phosphor-react-native';
import React, { useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NotificationPermissionBanner } from '@/components/NotificationPermissionBanner';
import { Card, Kicker, OutlineButton, SegmentedControl } from '@/components/ui';
import { CHALLENGE_LENGTHS } from '@/constants/challenge';
import {
  PRIVACY_POLICY_URL,
  TERMS_OF_SERVICE_URL,
  isPlaceholderLegalUrl,
} from '@/constants/legal';
import type {
  ChallengeLength,
  SquadSummary,
  HealthPrefs,
  NotificationPrefs,
} from '@/data/types';
import { useAppStore } from '@/store/useAppStore';
import { useSessionStore } from '@/store/useSessionStore';
import { toast } from '@/store/useToastStore';
import { colors, font, radius, space } from '@/theme/tokens';

const PREF_ROWS: { key: keyof NotificationPrefs; label: string; sub: string }[] = [
  { key: 'timerAlerts', label: 'Timer alerts', sub: 'Running, halfway, 5-min and done notifications' },
  { key: 'pings', label: 'Pings', sub: 'When a squadmate pings you' },
  { key: 'squadActivity', label: 'Squad activity', sub: 'Completions and proof in your squad' },
  { key: 'dailyReminder', label: 'Daily reminder', sub: 'An evening nudge if tasks are open' },
];

/**
 * A browser cannot deliver a notification this app is able to send, and it
 * has no Apple Health to read. Rather than show toggles that quietly do
 * nothing, each affected section says what is true here once and moves on.
 */
const IS_WEB = Platform.OS === 'web';

const HEALTH_SUB_ROWS: { key: keyof HealthPrefs; label: string; sub: string }[] = [
  { key: 'dietPromptEnabled', label: 'Diet prompt', sub: 'Suggest marking diet complete when food is logged elsewhere' },
  { key: 'workoutPromptEnabled', label: 'Workout prompt', sub: 'Suggest marking workouts found in Apple Health' },
  { key: 'weightPrefillEnabled', label: 'Weight pre-fill', sub: 'Pre-fill the weekly check-in from your latest weight' },
];

/**
 * Changing the length mid-run. In the challenge section, one tap from the
 * settings root — this decides when the challenge ends, so it does not live
 * behind another screen.
 *
 * The confirmation is the point of this component. Shortening to a length
 * the run has already passed does not move the finish line, it CROSSES it:
 * the challenge completes today and cannot be un-completed. So the tap that
 * would do that asks first, in those words, and only the second tap calls
 * the server. Lengthening, which has no such consequence, just happens.
 */
function ChallengeLengthRow() {
  const durationDays = useAppStore((s) => s.durationDays);
  const day = useAppStore((s) => s.day);
  const changeChallengeDuration = useAppStore((s) => s.changeChallengeDuration);
  const [confirming, setConfirming] = useState<ChallengeLength | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = async (days: ChallengeLength) => {
    setBusy(true);
    try {
      const { completed } = await changeChallengeDuration(days);
      toast(
        completed
          ? 'Challenge complete — that was your last day.'
          : `Challenge is now ${days} days.`,
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not change the length.');
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  };

  const press = (days: ChallengeLength) => {
    if (days === durationDays || busy) return;
    // The server applies exactly this rule (p_duration <= current day ends
    // the challenge); asking it first would be a round trip to learn
    // something the app already knows.
    if (days <= day) {
      setConfirming(days);
      return;
    }
    apply(days);
  };

  return (
    <>
      <Kicker style={styles.sectionKicker}>Challenge length</Kicker>
      <Card>
        <Text style={styles.rowSub}>
          You are on day {day} of {durationDays}. Moving the finish line never
          changes a day you have already logged.
        </Text>
        <SegmentedControl
          segments={CHALLENGE_LENGTHS.map((l) => String(l.days))}
          value={String(durationDays)}
          onChange={(v) => press(Number(v) as ChallengeLength)}
          style={{ marginTop: 10 }}
        />
        {confirming !== null && (
          <View style={styles.confirmBox}>
            <Text style={styles.rowSub}>
              You are already on day {day}. Setting {confirming} days finishes
              your challenge today, and that cannot be undone.
            </Text>
            <View style={styles.confirmRow}>
              <OutlineButton
                label={busy ? 'Finishing…' : 'Finish it'}
                small
                onPress={() => apply(confirming)}
              />
              <OutlineButton
                label="Cancel"
                small
                tone="ghost"
                onPress={() => setConfirming(null)}
              />
            </View>
          </View>
        )}
      </Card>
    </>
  );
}

/**
 * One squad, with the only destructive action Settings offers for it.
 *
 * The confirmation names the squad on purpose: with several memberships the
 * rows differ by name alone, and "Leave squad?" over a list of four is a
 * question about which the user cannot answer.
 */
function SquadRow({ squad, first }: { squad: SquadSummary; first: boolean }) {
  const leaveSquad = useAppStore((s) => s.leaveSquad);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const leave = async () => {
    setBusy(true);
    try {
      await leaveSquad(squad.id);
      toast(`Left ${squad.name}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not leave that squad.');
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <View style={[styles.prefRow, !first && styles.rowBorder]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{squad.name}</Text>
        <Text style={styles.rowSub}>
          {confirming
            ? `Leave ${squad.name}? Your challenge and history stay exactly as they are.`
            : 'Leaving keeps your challenge — solo mode is first-class.'}
        </Text>
      </View>
      {confirming ? (
        <View style={styles.confirmRow}>
          <OutlineButton
            label={busy ? 'Leaving…' : 'Leave'}
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
      ) : (
        <OutlineButton
          label="Leave"
          small
          tone="neutral"
          onPress={() => setConfirming(true)}
        />
      )}
    </View>
  );
}

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const prefs = useAppStore((s) => s.notificationPrefs);
  const setPref = useAppStore((s) => s.setNotificationPref);
  const profileName = useAppStore((s) => s.profileName);
  const why = useAppStore((s) => s.why);
  const updateProfile = useAppStore((s) => s.updateProfile);
  const squads = useAppStore((s) => s.squads);
  const blockedUsers = useAppStore((s) => s.blockedUsers);
  const unblockUser = useAppStore((s) => s.unblockUser);
  const deleteAccount = useAppStore((s) => s.deleteAccount);
  const healthPrefs = useAppStore((s) => s.healthPrefs);
  const setHealthPref = useAppStore((s) => s.setHealthPref);
  const healthAvailable = useAppStore((s) => s.healthAvailable);
  const weeklyCheckinEnabled = useAppStore((s) => s.weeklyCheckinEnabled);
  const setWeeklyCheckinEnabled = useAppStore((s) => s.setWeeklyCheckinEnabled);
  const unitPreference = useAppStore((s) => s.unitPreference);
  const setUnitPreference = useAppStore((s) => s.setUnitPreference);
  const signOut = useSessionStore((s) => s.signOut);

  const [name, setName] = useState(profileName);
  const [whyDraft, setWhyDraft] = useState(why);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteText, setDeleteText] = useState('');
  const [deleting, setDeleting] = useState(false);

  // Opens a hosted document in a SFSafariViewController sheet rather than
  // leaving for Safari, so the user comes straight back to Settings. Both
  // documents are hosted, not in-app: they have to be updatable without a
  // build, and App Store Connect points at the same Privacy Policy URL.
  const openLegalDoc = (label: string, url: string) => () => {
    if (isPlaceholderLegalUrl(url)) {
      toast(`${label} URL not set yet`);
      return;
    }
    WebBrowser.openBrowserAsync(url).catch(() =>
      toast(`Could not open the ${label}`),
    );
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 10 },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <CaretLeft size={20} color={colors.neutral400} />
        </Pressable>
        <Text style={styles.title}>Settings</Text>
        <View style={{ width: 20 }} />
      </View>

      <Kicker style={styles.sectionKicker}>Notifications</Kicker>
      {IS_WEB ? (
        <Card>
          <Text style={styles.rowSub}>
            In a browser this app can{'’'}t send you notifications. Pings
            still send and still show up in Squad, and the timer still keeps
            time — you just have to come back and look. Install the iOS app for
            alerts.
          </Text>
        </Card>
      ) : (
        <>
          <NotificationPermissionBanner />
          <Card>
            {PREF_ROWS.map(({ key, label, sub }, i) => (
              <View
                key={key}
                style={[styles.prefRow, i > 0 && styles.rowBorder]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowLabel}>{label}</Text>
                  <Text style={styles.rowSub}>{sub}</Text>
                </View>
                <Switch
                  value={prefs[key]}
                  onValueChange={(v) => setPref(key, v)}
                  trackColor={{
                    false: colors.neutral800,
                    true: colors.accent700,
                  }}
                  thumbColor={prefs[key] ? colors.accent300 : colors.neutral500}
                />
              </View>
            ))}
          </Card>
        </>
      )}

      <Kicker style={styles.sectionKicker}>Units</Kicker>
      <Card>
        <Text style={styles.rowSub}>
          One preference for weight and height. Stored values never change —
          only how they read.
        </Text>
        <SegmentedControl
          segments={['LB / FT', 'KG / CM']}
          value={unitPreference === 'imperial' ? 'LB / FT' : 'KG / CM'}
          onChange={(v) =>
            setUnitPreference(v === 'LB / FT' ? 'imperial' : 'metric')
          }
          style={{ marginTop: 10 }}
        />
      </Card>

      <Kicker style={styles.sectionKicker}>Challenge</Kicker>
      <Card>
        <Pressable
          onPress={() => router.push('/my-challenge')}
          style={styles.prefRow}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.rowLabel}>My Challenge</Text>
            <Text style={styles.rowSub}>
              Edit daily tasks and tier — changes always start tomorrow.
            </Text>
          </View>
          <CaretRight size={15} color={colors.neutral600} />
        </Pressable>
      </Card>

      <ChallengeLengthRow />

      {/* Only where a HealthKit source can actually be queried. Everywhere
          else — web, Android, Expo Go, the simulator — this whole section
          goes, the same way TodaysHealthCard on Track does. A "Connect Apple
          Health" switch that can never connect to anything is worse than no
          switch: it reads as a feature the user failed to turn on. */}
      {healthAvailable && (
        <>
          <Kicker style={styles.sectionKicker}>Apple Health</Kicker>
          <Card>
            <View style={styles.prefRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel}>Connect Apple Health</Text>
                <Text style={styles.rowSub}>
                  Read-only. Data stays on this device — never uploaded, never
                  visible to squadmates.
                </Text>
              </View>
              <Switch
                value={healthPrefs.healthEnabled}
                onValueChange={(v) => setHealthPref('healthEnabled', v)}
                trackColor={{ false: colors.neutral800, true: colors.accent700 }}
                thumbColor={
                  healthPrefs.healthEnabled
                    ? colors.accent300
                    : colors.neutral500
                }
              />
            </View>
            {healthPrefs.healthEnabled &&
              HEALTH_SUB_ROWS.map(({ key, label, sub }) => (
                <View key={key} style={[styles.prefRow, styles.rowBorder]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowLabel}>{label}</Text>
                    <Text style={styles.rowSub}>{sub}</Text>
                  </View>
                  <Switch
                    value={healthPrefs[key]}
                    onValueChange={(v) => setHealthPref(key, v)}
                    trackColor={{
                      false: colors.neutral800,
                      true: colors.accent700,
                    }}
                    thumbColor={
                      healthPrefs[key] ? colors.accent300 : colors.neutral500
                    }
                  />
                </View>
              ))}
          </Card>
        </>
      )}

      <Kicker style={styles.sectionKicker}>Track</Kicker>
      <Card>
        <View style={styles.prefRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowLabel}>Weekly check-in card</Text>
            <Text style={styles.rowSub}>
              The optional weight & mood card in Track. Off hides it for good.
            </Text>
          </View>
          <Switch
            value={weeklyCheckinEnabled}
            onValueChange={setWeeklyCheckinEnabled}
            trackColor={{ false: colors.neutral800, true: colors.accent700 }}
            thumbColor={
              weeklyCheckinEnabled ? colors.accent300 : colors.neutral500
            }
          />
        </View>
      </Card>

      <Kicker style={styles.sectionKicker}>Profile</Kicker>
      <Card>
        <Text style={styles.rowSub}>Display name</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          style={styles.input}
          placeholderTextColor={colors.neutral600}
        />
        <Text style={[styles.rowSub, { marginTop: 12 }]}>Why I started</Text>
        <TextInput
          value={whyDraft}
          onChangeText={setWhyDraft}
          multiline
          style={[styles.input, { minHeight: 64 }]}
          placeholderTextColor={colors.neutral600}
        />
        <OutlineButton
          label="Save profile"
          small
          onPress={() => {
            updateProfile(name, whyDraft);
            toast('Profile saved');
          }}
          style={{ marginTop: 12, alignSelf: 'flex-start' }}
        />
      </Card>

      {squads.length > 0 && (
        <>
          <Kicker style={styles.sectionKicker}>
            {squads.length > 1 ? 'Squads' : 'Squad'}
          </Kicker>
          <Card>
            {/* Every squad, not just the one on screen. A list that showed
                only the active squad would leave the others unleavable from
                here, which is the shape the single-squad model left behind. */}
            {squads.map((q, i) => (
              <SquadRow key={q.id} squad={q} first={i === 0} />
            ))}
          </Card>
        </>
      )}

      <Kicker style={styles.sectionKicker}>Blocked users</Kicker>
      <Card>
        {blockedUsers.length === 0 ? (
          <Text style={styles.rowSub}>
            No one blocked. Long-press a feed item to block or report.
          </Text>
        ) : (
          blockedUsers.map((b, i) => (
            <View key={b.id} style={[styles.prefRow, i > 0 && styles.rowBorder]}>
              <Text style={[styles.rowLabel, { flex: 1 }]}>{b.name}</Text>
              <OutlineButton
                label="Unblock"
                small
                tone="neutral"
                onPress={() => {
                  // By id: two blocked users can share a display name, and
                  // one whose profile no longer resolves has none at all.
                  unblockUser(b.id);
                  toast(`${b.name} unblocked`);
                }}
              />
            </View>
          ))
        )}
      </Card>

      <Kicker style={styles.sectionKicker}>Legal</Kicker>
      <Card>
        <Pressable
          onPress={openLegalDoc('Terms of Service', TERMS_OF_SERVICE_URL)}
          style={styles.prefRow}
        >
          <Text style={[styles.rowLabel, { flex: 1 }]}>Terms of Service</Text>
          <CaretRight size={15} color={colors.neutral600} />
        </Pressable>
        <Pressable
          onPress={openLegalDoc('Privacy Policy', PRIVACY_POLICY_URL)}
          style={[styles.prefRow, styles.rowBorder]}
        >
          <Text style={[styles.rowLabel, { flex: 1 }]}>Privacy Policy</Text>
          <CaretRight size={15} color={colors.neutral600} />
        </Pressable>
      </Card>

      <Kicker style={styles.sectionKicker}>Account</Kicker>
      <Card>
        {!confirmingDelete ? (
          <View style={styles.prefRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Delete account</Text>
              <Text style={styles.rowSub}>
                Erases your challenge, journal, meals and metrics.
              </Text>
            </View>
            <OutlineButton
              label="Delete"
              small
              tone="neutral"
              onPress={() => setConfirmingDelete(true)}
            />
          </View>
        ) : (
          <View>
            <Text style={styles.rowLabel}>
              Type DELETE to confirm. This can{'\u2019'}t be undone.
            </Text>
            <TextInput
              value={deleteText}
              onChangeText={setDeleteText}
              autoCapitalize="characters"
              placeholder="DELETE"
              placeholderTextColor={colors.neutral600}
              style={styles.input}
            />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
              <OutlineButton
                label="Cancel"
                small
                tone="neutral"
                onPress={() => {
                  setConfirmingDelete(false);
                  setDeleteText('');
                }}
              />
              <OutlineButton
                label={deleting ? 'Deleting…' : 'Delete forever'}
                small
                disabled={deleting}
                onPress={() => {
                  if (deleteText.trim().toUpperCase() !== 'DELETE') {
                    toast('Type DELETE to confirm');
                    return;
                  }
                  // "Account deleted" used to be said before the server had
                  // been asked. A refused delete then left the user signed in
                  // with a blank screen and their data untouched, under a
                  // toast that had already congratulated them. It waits now,
                  // and only the resolved case claims anything.
                  setDeleting(true);
                  deleteAccount()
                    .then(() => {
                      // The session ends inside deleteAccount(); the gate
                      // takes it from here to the sign-in screen.
                      setConfirmingDelete(false);
                      setDeleteText('');
                      toast('Account deleted');
                    })
                    .catch(() => {
                      toast('Couldn’t delete your account — nothing changed');
                    })
                    .finally(() => setDeleting(false));
                }}
              />
            </View>
          </View>
        )}
        <View style={[styles.prefRow, styles.rowBorder, { marginTop: 12 }]}>
          <Text style={[styles.rowLabel, { flex: 1 }]}>Sign out</Text>
          <OutlineButton
            label="Sign out"
            small
            tone="neutral"
            onPress={() => {
              // Clears the service mirror and this device's copy of the
              // account before ending the session: nothing of one account
              // may be readable by the next one to sign in here.
              signOut()
                .then(() => toast('Signed out'))
                .catch(() => toast('Signed out'));
            }}
          />
        </View>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: space.screenX,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  title: {
    fontFamily: font.medium,
    fontSize: 20,
    color: colors.text,
  },
  confirmBox: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    marginTop: 12,
    paddingTop: 12,
    gap: 10,
  },
  confirmRow: {
    flexDirection: 'row',
    gap: 8,
  },
  sectionKicker: {
    marginTop: 18,
    marginBottom: 8,
  },
  prefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 48,
    paddingVertical: 6,
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  rowLabel: {
    fontFamily: font.regular,
    fontSize: 14,
    color: colors.text,
  },
  rowSub: {
    fontFamily: font.regular,
    fontSize: 11.5,
    color: colors.neutral500,
    marginTop: 2,
  },
  input: {
    fontFamily: font.regular,
    fontSize: 13.5,
    color: colors.text,
    minHeight: 42,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
    marginTop: 6,
    textAlignVertical: 'top',
  },
});
