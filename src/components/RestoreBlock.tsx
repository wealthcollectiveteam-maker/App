import { useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Micro, PrimaryButton } from '@/components/primitives';
import { formatCalendar } from '@/lib/intl';
import { restoreOffer } from '@/lib/restoreOffer';
import { useAppStore } from '@/store/useAppStore';
import { useSessionStore } from '@/store/useSessionStore';
import { toast } from '@/store/useToastStore';
import { colors, font, space } from '@/theme/tokens';

/** "September 29" for a YYYY-MM-DD, read as a date and nothing else. */
function calendarLabel(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return formatCalendar(d, { month: 'long', day: 'numeric', timeZone: 'UTC' });
}

/**
 * THE DOOR (Phase 38H). Rendered wherever a person in this state will look:
 * on Home under the day number, and on check-in where the reopened day will
 * appear. It renders when — and only when — the server says a missed day
 * can be reopened; nothing about the restart notice, a sealed day or a
 * dismissal enters into it. The decision and the copy are in
 * lib/restoreOffer.ts; this renders them and performs the tap.
 *
 * The tap: restore on the server, re-hydrate the session (which challenge
 * is alive just changed), put the reopened day in front of the person.
 * Restoring changes no flame; sealing the day does.
 */
export function RestoreBlock({ compact = false }: { compact?: boolean }) {
  const restorable = useAppStore((s) => s.restorable);
  const day = useAppStore((s) => s.day);
  const restoreMissedDay = useAppStore((s) => s.restoreMissedDay);
  const setActiveDay = useAppStore((s) => s.setActiveDay);
  const [busy, setBusy] = React.useState(false);
  const router = useRouter();

  const offer = restoreOffer({
    restorable,
    currentDay: day,
    restoreByLabel: restorable ? calendarLabel(restorable.restoreBy) : '',
  });
  if (!offer) return null;

  const range = offer.lastDay > offer.day;
  const onRestore = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // The store reads the offer's kind and calls the RPC it names (38R).
      await restoreMissedDay();
      // Which challenge is alive just changed: re-run the session funnel,
      // which hydrates the reopened run and, from the setup screen, flips
      // the status to signedIn so the tabs render.
      await useSessionStore.getState().retry();
      // Land on the oldest reopened day. The store's `yesterday` is that day
      // after the hydrate (lib/catchUp.ts); 'yesterday' is refused if it is
      // not open, which leaves today — the honest fallback.
      setActiveDay('yesterday');
      router.replace('/checkin');
    } catch (e) {
      // Plain words on screen; the server's own sentence in the console.
      console.warn('[reopen]', e instanceof Error ? e.message : e);
      toast(
        range
          ? 'Those days could not be reopened. Refresh and try again.'
          : 'That day could not be reopened. Refresh and try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <View testID="restore-block" style={[styles.block, compact && styles.blockCompact]}>
      <View style={styles.rule} />
      <View style={styles.body}>
        <Micro color={colors.accent400}>{offer.deadline}</Micro>
        <Text style={styles.explainer}>{offer.explainer}</Text>
        <PrimaryButton
          label={busy ? 'Reopening…' : offer.button}
          disabled={busy}
          onPress={onRestore}
          style={{ marginTop: 12 }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    marginTop: 18,
  },
  blockCompact: {
    marginTop: 0,
    marginBottom: 18,
  },
  rule: {
    width: 2,
    backgroundColor: colors.accent,
  },
  body: {
    flex: 1,
    padding: space.cardPad,
  },
  explainer: {
    fontFamily: font.regular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textHi,
    marginTop: 8,
  },
});
