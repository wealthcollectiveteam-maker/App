import { useRouter } from 'expo-router';
import {
  CaretLeftIcon as CaretLeft,
  CaretRightIcon as CaretRight,
} from 'phosphor-react-native';
import React, { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card, Kicker, OutlineButton, SegmentedControl } from '@/components/ui';
import type { HealthPrefs, NotificationPrefs } from '@/data/types';
import { useAppStore } from '@/store/useAppStore';
import { toast } from '@/store/useToastStore';
import { colors, font, radius, space } from '@/theme/tokens';

const PREF_ROWS: { key: keyof NotificationPrefs; label: string; sub: string }[] = [
  { key: 'pings', label: 'Pings', sub: 'When a squadmate pings you' },
  { key: 'squadActivity', label: 'Squad activity', sub: 'Completions and proof in your squad' },
  { key: 'dailyReminder', label: 'Daily reminder', sub: 'An evening nudge if tasks are open' },
];

const HEALTH_SUB_ROWS: { key: keyof HealthPrefs; label: string; sub: string }[] = [
  { key: 'dietPromptEnabled', label: 'Diet prompt', sub: 'Suggest marking diet complete when food is logged elsewhere' },
  { key: 'workoutPromptEnabled', label: 'Workout prompt', sub: 'Suggest marking workouts found in Apple Health' },
  { key: 'weightPrefillEnabled', label: 'Weight pre-fill', sub: 'Pre-fill the weekly check-in from your latest weight' },
];

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const prefs = useAppStore((s) => s.notificationPrefs);
  const setPref = useAppStore((s) => s.setNotificationPref);
  const profileName = useAppStore((s) => s.profileName);
  const why = useAppStore((s) => s.why);
  const updateProfile = useAppStore((s) => s.updateProfile);
  const squad = useAppStore((s) => s.squad);
  const leaveSquad = useAppStore((s) => s.leaveSquad);
  const blockedUsers = useAppStore((s) => s.blockedUsers);
  const unblockUser = useAppStore((s) => s.unblockUser);
  const deleteAccount = useAppStore((s) => s.deleteAccount);
  const healthPrefs = useAppStore((s) => s.healthPrefs);
  const setHealthPref = useAppStore((s) => s.setHealthPref);
  const weeklyCheckinEnabled = useAppStore((s) => s.weeklyCheckinEnabled);
  const setWeeklyCheckinEnabled = useAppStore((s) => s.setWeeklyCheckinEnabled);
  const unitPreference = useAppStore((s) => s.unitPreference);
  const setUnitPreference = useAppStore((s) => s.setUnitPreference);

  const [name, setName] = useState(profileName);
  const [whyDraft, setWhyDraft] = useState(why);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteText, setDeleteText] = useState('');

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
              healthPrefs.healthEnabled ? colors.accent300 : colors.neutral500
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

      {squad && (
        <>
          <Kicker style={styles.sectionKicker}>Squad</Kicker>
          <Card>
            <View style={styles.prefRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel}>{squad.name}</Text>
                <Text style={styles.rowSub}>
                  Leaving keeps your challenge — solo mode is first-class.
                </Text>
              </View>
              <OutlineButton
                label="Leave"
                small
                tone="neutral"
                onPress={() => {
                  leaveSquad();
                  toast('Left the squad — running solo');
                }}
              />
            </View>
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
          blockedUsers.map((n, i) => (
            <View key={n} style={[styles.prefRow, i > 0 && styles.rowBorder]}>
              <Text style={[styles.rowLabel, { flex: 1 }]}>{n}</Text>
              <OutlineButton
                label="Unblock"
                small
                tone="neutral"
                onPress={() => {
                  unblockUser(n);
                  toast(`${n} unblocked`);
                }}
              />
            </View>
          ))
        )}
      </Card>

      <Kicker style={styles.sectionKicker}>Legal</Kicker>
      <Card>
        {[
          { label: 'Terms of Service', route: '/settings/terms' as const },
          { label: 'Privacy Policy', route: '/settings/privacy' as const },
        ].map(({ label, route }, i) => (
          <Pressable
            key={label}
            onPress={() => router.push(route)}
            style={[styles.prefRow, i > 0 && styles.rowBorder]}
          >
            <Text style={[styles.rowLabel, { flex: 1 }]}>{label}</Text>
            <CaretRight size={15} color={colors.neutral600} />
          </Pressable>
        ))}
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
                label="Delete forever"
                small
                onPress={() => {
                  if (deleteText.trim().toUpperCase() !== 'DELETE') {
                    toast('Type DELETE to confirm');
                    return;
                  }
                  deleteAccount();
                  setConfirmingDelete(false);
                  setDeleteText('');
                  toast('Account deleted (mock)');
                  router.back();
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
            onPress={() => toast('Signed out (mock)')}
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
