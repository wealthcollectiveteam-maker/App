import { useRouter } from 'expo-router';
import { CaretLeftIcon as CaretLeft } from 'phosphor-react-native';
import React, { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card, Kicker, OutlineButton } from '@/components/ui';
import type { MetricCheckin } from '@/data/types';
import type { UnitPreference, WeightVerdict } from '@/lib/units';
import {
  MAX_PLAUSIBLE_KG,
  MIN_PLAUSIBLE_KG,
  checkWeightEntry,
  formatWeight,
  formatWeightValue,
  weightProblemMessage,
  weightUnitLabel,
} from '@/lib/units';
import { useAppStore } from '@/store/useAppStore';
import { toast } from '@/store/useToastStore';
import { colors, font, radius, space } from '@/theme/tokens';

const MOODS = ['Rough', 'Low', 'Okay', 'Good', 'Strong'];

function dateLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** What a row is worth saying out loud, for a confirmation that names it. */
function describe(checkin: MetricCheckin, pref: UnitPreference): string {
  const weight =
    checkin.weightKg != null ? formatWeight(checkin.weightKg, pref) : 'no weight';
  return `${weight} · ${dateLabel(checkin.timestamp)}`;
}

/**
 * One past check-in: read-only until Correct is tapped, then an input holding
 * the value in the user's own unit.
 *
 * Nothing here is optimistic. The store action awaits the server and rejects
 * if it refused, so the row only changes after the database has agreed — and
 * on refusal the typed value stays in the field, which is the point. Showing
 * a corrected number that silently reverts would leave someone unsure which
 * weight their history now holds, which is worse than the wrong number they
 * already knew about.
 */
function CheckinRow({
  checkin,
  pref,
  first,
}: {
  checkin: MetricCheckin;
  pref: UnitPreference;
  first: boolean;
}) {
  const updateMetricCheckin = useAppStore((s) => s.updateMetricCheckin);
  const deleteMetricCheckin = useAppStore((s) => s.deleteMetricCheckin);

  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [mood, setMood] = useState<number | null>(checkin.mood);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Non-null while the entry looks like the wrong unit and we are asking.
  const [query, setQuery] = useState<Extract<
    WeightVerdict,
    { kind: 'ambiguous' }
  > | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const startEditing = () => {
    setValue(
      checkin.weightKg != null ? formatWeightValue(checkin.weightKg, pref) : '',
    );
    setMood(checkin.mood);
    setFailure(null);
    setQuery(null);
    setEditing(true);
  };

  const commit = async (kg: number | null) => {
    setBusy(true);
    setFailure(null);
    try {
      await updateMetricCheckin(checkin.id, kg, mood);
      setEditing(false);
      setQuery(null);
      toast('Check-in corrected');
    } catch (error) {
      // The value stays in the field and the reason stays on the row. The
      // service has already toasted; this is what survives the toast.
      setFailure(
        error instanceof Error
          ? error.message
          : 'That correction did not save.',
      );
    } finally {
      setBusy(false);
    }
  };

  /**
   * The SAME guard the entry field uses, on the same terms. A correction that
   * introduces a second wrong number is not a correction — and this screen
   * exists because of a 203 that meant pounds, so the one place it must fire
   * is the place that fixes one.
   */
  const onSave = () => {
    const verdict = checkWeightEntry(value, pref);
    switch (verdict.kind) {
      case 'ok':
        return commit(verdict.kg);
      case 'empty':
        // A blank field is a mood-only check-in, as it is on entry.
        return commit(null);
      // Each way of being wrong gets its own sentence — the same wording the
      // entry card uses, from the same place, so a correction screen and an
      // entry screen cannot disagree about what "92.15" is wrong about.
      case 'malformed':
        setFailure(weightProblemMessage(verdict.problem, pref));
        return;
      case 'implausible':
        setFailure(
          `A weight has to be between ${formatWeight(
            MIN_PLAUSIBLE_KG,
            pref,
          )} and ${formatWeight(MAX_PLAUSIBLE_KG, pref)}.`,
        );
        return;
      case 'ambiguous':
        setQuery(verdict);
        return;
    }
  };

  const onDelete = async () => {
    setBusy(true);
    setFailure(null);
    try {
      await deleteMetricCheckin(checkin.id);
      toast('Check-in deleted');
    } catch (error) {
      setConfirmingDelete(false);
      setFailure(
        error instanceof Error ? error.message : 'That check-in was not deleted.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.row, !first && styles.rowBorder]}>
      <View style={styles.rowHead}>
        <View style={{ flex: 1 }}>
          <Text style={styles.weight}>
            {checkin.weightKg != null
              ? formatWeight(checkin.weightKg, pref)
              : 'No weight'}
          </Text>
          <Text style={styles.meta}>
            {dateLabel(checkin.timestamp)}
            {checkin.mood ? ` · ${MOODS[checkin.mood - 1]}` : ''}
          </Text>
        </View>
        {!editing && !confirmingDelete && (
          <View style={styles.actions}>
            <OutlineButton label="Correct" small onPress={startEditing} />
            <OutlineButton
              label="Delete"
              small
              tone="neutral"
              onPress={() => {
                setFailure(null);
                setConfirmingDelete(true);
              }}
            />
          </View>
        )}
      </View>

      {editing && (
        <View style={styles.editBox}>
          <View style={styles.weightRow}>
            <TextInput
              value={value}
              onChangeText={setValue}
              // decimal-pad, for the same reason the entry card uses it: the
              // iOS "numeric" pad carries no decimal separator key at all, so
              // a corrected weight could not be given a decimal on the device
              // this ships to.
              keyboardType="decimal-pad"
              inputMode="decimal"
              placeholder={`Weight (${weightUnitLabel(pref)})`}
              placeholderTextColor={colors.neutral600}
              style={styles.input}
              maxLength={6}
              autoFocus
              accessibilityLabel={`Weight in ${
                pref === 'imperial' ? 'pounds' : 'kilograms'
              }, one decimal place`}
            />
            <Text style={styles.unit}>{weightUnitLabel(pref)}</Text>
          </View>

          <View style={styles.moodRow}>
            {MOODS.map((label, i) => {
              const active = mood === i + 1;
              return (
                <Pressable
                  key={label}
                  onPress={() => setMood(active ? null : i + 1)}
                  style={[
                    styles.moodPill,
                    active && {
                      borderColor: colors.accent500,
                      backgroundColor: colors.accentTint,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.moodText,
                      active && { color: colors.accent200 },
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {query && (
            <View style={styles.queryBox}>
              <Text style={styles.queryText}>
                {formatWeight(query.kg, pref)} is a long way from ordinary. Did
                you mean {formatWeight(query.meantKg, query.meantUnit)}?
              </Text>
              <View style={styles.queryRow}>
                <OutlineButton
                  label={`Yes — ${formatWeight(query.meantKg, query.meantUnit)}`}
                  small
                  disabled={busy}
                  onPress={() => commit(query.meantKg)}
                />
                <OutlineButton
                  label={`No — ${formatWeight(query.kg, pref)}`}
                  small
                  tone="neutral"
                  disabled={busy}
                  onPress={() => commit(query.kg)}
                />
              </View>
            </View>
          )}

          <View style={styles.editActions}>
            <OutlineButton
              label={busy ? 'Saving…' : 'Save correction'}
              small
              disabled={busy}
              onPress={onSave}
            />
            <OutlineButton
              label="Cancel"
              small
              tone="neutral"
              disabled={busy}
              onPress={() => {
                setEditing(false);
                setQuery(null);
                setFailure(null);
              }}
            />
          </View>
        </View>
      )}

      {/* Names the date AND the value. "Delete this check-in?" on a list of
          eleven near-identical rows is how the wrong one goes. */}
      {confirmingDelete && (
        <View style={styles.confirmBox}>
          <Text style={styles.confirmText}>
            Delete the check-in of {describe(checkin, pref)}? This cannot be
            undone.
          </Text>
          <View style={styles.editActions}>
            <OutlineButton
              label={busy ? 'Deleting…' : 'Delete it'}
              small
              disabled={busy}
              onPress={onDelete}
            />
            <OutlineButton
              label="Keep it"
              small
              tone="neutral"
              disabled={busy}
              onPress={() => setConfirmingDelete(false)}
            />
          </View>
        </View>
      )}

      {failure && <Text style={styles.failure}>{failure}</Text>}
    </View>
  );
}

/**
 * Every past check-in, newest first, in the user's own unit.
 *
 * Storage never changes: weight_kg is canonical and this screen reads it
 * through lib/units.ts like every other surface. Switching the preference
 * re-renders the list; it rewrites nothing.
 *
 * No pagination, deliberately. A 75-day run produces about eleven weekly
 * entries, so the whole history is one short list — paging it would add a
 * control for a problem nobody has.
 */
export default function MetricsHistoryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const checkins = useAppStore((s) => s.metricCheckins);
  const pref = useAppStore((s) => s.unitPreference);

  const ordered = [...checkins].sort((a, b) => b.timestamp - a.timestamp);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 10 }]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <CaretLeft size={20} color={colors.neutral400} />
        </Pressable>
        <Text style={styles.title}>Check-in history</Text>
        <View style={{ width: 20 }} />
      </View>

      <Kicker style={{ marginBottom: 8 }}>
        {ordered.length === 1 ? '1 check-in' : `${ordered.length} check-ins`}
      </Kicker>

      {ordered.length === 0 ? (
        <Card>
          <Text style={styles.empty}>
            No check-ins yet. They are optional — the weekly card on Track is
            where they start.
          </Text>
        </Card>
      ) : (
        <Card>
          {ordered.map((checkin, i) => (
            <CheckinRow
              key={checkin.id}
              checkin={checkin}
              pref={pref}
              first={i === 0}
            />
          ))}
        </Card>
      )}

      <Text style={styles.footnote}>
        Private to you. Squadmates never see your weight or mood.
      </Text>
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
    marginBottom: 14,
  },
  title: {
    fontFamily: font.medium,
    fontSize: 20,
    color: colors.text,
  },
  row: {
    paddingVertical: 12,
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  rowHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  weight: {
    fontFamily: font.medium,
    fontSize: 15,
    color: colors.text,
  },
  meta: {
    fontFamily: font.regular,
    fontSize: 11.5,
    color: colors.neutral500,
    marginTop: 3,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  editBox: {
    marginTop: 12,
  },
  weightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  input: {
    fontFamily: font.regular,
    fontSize: 13.5,
    color: colors.text,
    minHeight: 40,
    width: 100,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
  },
  unit: {
    fontFamily: font.regular,
    fontSize: 13,
    color: colors.neutral400,
  },
  moodRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 12,
  },
  moodPill: {
    borderWidth: 1,
    borderColor: colors.neutral700,
    borderRadius: radius.pill,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  moodText: {
    fontFamily: font.regular,
    fontSize: 12,
    color: colors.neutral300,
  },
  editActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  queryBox: {
    marginTop: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: colors.accent700,
    borderRadius: radius.sm,
    backgroundColor: colors.accentTint,
  },
  queryText: {
    fontFamily: font.regular,
    fontSize: 12.5,
    color: colors.text,
    lineHeight: 18,
  },
  queryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  confirmBox: {
    marginTop: 12,
  },
  confirmText: {
    fontFamily: font.regular,
    fontSize: 12.5,
    color: colors.text,
    lineHeight: 18,
  },
  failure: {
    fontFamily: font.regular,
    fontSize: 12,
    color: colors.accent300,
    marginTop: 10,
    lineHeight: 17,
  },
  empty: {
    fontFamily: font.regular,
    fontSize: 12.5,
    color: colors.neutral500,
    lineHeight: 18,
  },
  footnote: {
    fontFamily: font.regular,
    fontSize: 11,
    color: colors.neutral600,
    marginTop: 14,
    lineHeight: 16,
  },
});
