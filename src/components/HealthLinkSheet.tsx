import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { BottomSheet } from '@/components/BottomSheet';
import { Kicker, OutlineButton } from '@/components/ui';
import {
  HEALTH_RULE_KINDS,
  LITRES_PER_GALLON,
  describeLink,
  parseClock,
  suggestLinkForText,
  type HealthLink,
  type HealthRuleKind,
  type TaskLike,
} from '@/lib/healthLinks';
import { useAppStore } from '@/store/useAppStore';
import { toast } from '@/store/useToastStore';
import { colors, font, radius } from '@/theme/tokens';

/**
 * LINK A TASK TO APPLE HEALTH (Phase 38N). Reached from a task's row on My
 * Challenge. Six rules; the wording may suggest one, and the suggestion is
 * shown as a default the user has to accept — nothing is linked until Link
 * is tapped. A link is configuration and lives on this device
 * (lib/healthLinks.ts, PREF_KEYS.healthLinks). No Health value is read here.
 */

/** What the form holds for the selected rule, as typed. */
interface Draft {
  kind: HealthRuleKind;
  a: string;
  b: string;
}

function draftFrom(link: HealthLink, imperial: boolean): Draft {
  switch (link.kind) {
    case 'sleep':
      return { kind: 'sleep', a: String(link.minHours ?? 7), b: link.maxHours != null ? String(link.maxHours) : '' };
    case 'wake': {
      const m = link.byMinute ?? 360;
      const h12 = Math.floor(m / 60) % 12 || 12;
      return { kind: 'wake', a: `${h12}:${String(m % 60).padStart(2, '0')} ${m < 720 ? 'AM' : 'PM'}`, b: '' };
    }
    case 'water': {
      const litres = link.minLitres ?? LITRES_PER_GALLON;
      return { kind: 'water', a: imperial ? (litres / LITRES_PER_GALLON).toFixed(2) : litres.toFixed(2), b: '' };
    }
    case 'steps':
      return { kind: 'steps', a: String(link.minSteps ?? 10000), b: '' };
    case 'workout':
      return { kind: 'workout', a: String(link.minMinutes ?? 45), b: '' };
    case 'mindful':
      return { kind: 'mindful', a: String(link.minMinutes ?? 10), b: '' };
    default:
      return { kind: 'sleep', a: '7', b: '' };
  }
}

const BLANK: Record<HealthRuleKind, Draft> = {
  sleep: { kind: 'sleep', a: '7', b: '' },
  wake: { kind: 'wake', a: '6:00 AM', b: '' },
  water: { kind: 'water', a: '', b: '' },
  steps: { kind: 'steps', a: '10000', b: '' },
  workout: { kind: 'workout', a: '45', b: '' },
  mindful: { kind: 'mindful', a: '10', b: '' },
};

function linkFrom(d: Draft, imperial: boolean): HealthLink | null {
  const num = (t: string) => {
    const n = Number(t.replace(/,/g, '').trim());
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  switch (d.kind) {
    case 'sleep': {
      const minHours = num(d.a);
      if (minHours == null) return null;
      const maxHours = d.b.trim() ? num(d.b) : null;
      if (d.b.trim() && (maxHours == null || maxHours < minHours)) return null;
      return { kind: 'sleep', minHours, ...(maxHours != null ? { maxHours } : {}) };
    }
    case 'wake': {
      const byMinute = parseClock(d.a);
      return byMinute == null ? null : { kind: 'wake', byMinute };
    }
    case 'water': {
      const v = num(d.a);
      if (v == null) return null;
      const litres = imperial ? v * LITRES_PER_GALLON : v;
      return { kind: 'water', minLitres: Math.round(litres * 1000) / 1000 };
    }
    case 'steps': {
      const v = num(d.a);
      return v == null ? null : { kind: 'steps', minSteps: Math.round(v) };
    }
    case 'workout':
    case 'mindful': {
      const v = num(d.a);
      return v == null ? null : { kind: d.kind, minMinutes: Math.round(v) };
    }
    default:
      return null;
  }
}

function unitFor(kind: HealthRuleKind, imperial: boolean): string {
  switch (kind) {
    case 'sleep':
      return 'hours';
    case 'wake':
      return 'e.g. 6:00 AM';
    case 'water':
      return imperial ? 'gallons' : 'litres';
    case 'steps':
      return 'steps';
    default:
      return 'minutes';
  }
}

export function HealthLinkSheet({
  task,
  onClose,
}: {
  task: TaskLike | null;
  onClose: () => void;
}) {
  const links = useAppStore((s) => s.healthLinks);
  const setHealthLink = useAppStore((s) => s.setHealthLink);
  const unitPreference = useAppStore((s) => s.unitPreference);
  const imperial = unitPreference === 'imperial';

  const existing = task ? links[task.key] ?? null : null;
  const suggested = task && !existing ? suggestLinkForText(task) : null;

  // Reset the form whenever the sheet opens for a different task.
  const [seenKey, setSeenKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(BLANK.sleep);
  const [accepted, setAccepted] = useState(false);
  const key = task?.key ?? null;
  if (key !== seenKey) {
    setSeenKey(key);
    setAccepted(false);
    if (existing) setDraft(draftFrom(existing, imperial));
    else if (suggested) setDraft(draftFrom(suggested, imperial));
    else setDraft(BLANK.sleep);
  }

  if (!task) return null;
  const candidate = linkFrom(draft, imperial);

  return (
    <BottomSheet visible={!!task} onClose={onClose}>
      <Kicker style={{ marginBottom: 6 }}>Link to Apple Health</Kicker>
      <Text style={styles.taskLabel}>{task.label}</Text>
      <Text style={styles.sub}>
        When Apple Health shows the rule is met for the open day, this task gets
        a Mark complete suggestion. You always confirm; nothing ticks itself.
        Read on this phone only.
      </Text>

      {suggested && !accepted ? (
        <View style={styles.suggestBox}>
          <Text style={styles.suggestText}>
            From the wording: {describeLink(suggested, unitPreference)}
          </Text>
          <OutlineButton
            label="Use this"
            small
            onPress={() => {
              setDraft(draftFrom(suggested, imperial));
              setAccepted(true);
            }}
          />
        </View>
      ) : null}

      <View style={styles.kinds}>
        {HEALTH_RULE_KINDS.map((k) => {
          const on = draft.kind === k.kind;
          return (
            <Pressable
              key={k.kind}
              onPress={() => setDraft(on ? draft : BLANK[k.kind])}
              style={[styles.kindRow, on && styles.kindRowOn]}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
            >
              <View style={[styles.dot, on && styles.dotOn]} />
              <Text style={[styles.kindLabel, on && styles.kindLabelOn]}>{k.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.inputRow}>
        <TextInput
          value={draft.a}
          onChangeText={(a) => setDraft({ ...draft, a })}
          keyboardType={draft.kind === 'wake' ? 'default' : 'decimal-pad'}
          placeholder={unitFor(draft.kind, imperial)}
          placeholderTextColor={colors.neutral500}
          style={styles.input}
        />
        <Text style={styles.unit}>{draft.kind === 'wake' ? '' : unitFor(draft.kind, imperial)}</Text>
        {draft.kind === 'sleep' ? (
          <>
            <Text style={styles.unit}>to</Text>
            <TextInput
              value={draft.b}
              onChangeText={(b) => setDraft({ ...draft, b })}
              keyboardType="decimal-pad"
              placeholder="at most (optional)"
              placeholderTextColor={colors.neutral500}
              style={styles.input}
            />
          </>
        ) : null}
      </View>
      {candidate ? (
        <Text style={styles.preview}>{describeLink(candidate, unitPreference)}</Text>
      ) : (
        <Text style={styles.previewBad}>Enter a value to link.</Text>
      )}

      <OutlineButton
        label={existing ? 'Save link' : 'Link'}
        disabled={!candidate}
        onPress={() => {
          if (!candidate) return;
          setHealthLink(task.key, candidate);
          toast(`Linked: ${describeLink(candidate, unitPreference)}`);
          onClose();
        }}
        style={{ marginBottom: 8 }}
      />
      {existing ? (
        <OutlineButton
          label="Unlink"
          tone="neutral"
          onPress={() => {
            setHealthLink(task.key, null);
            toast('Unlinked from Apple Health');
            onClose();
          }}
          style={{ marginBottom: 8 }}
        />
      ) : null}
      <OutlineButton label="Cancel" tone="ghost" onPress={onClose} />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  taskLabel: {
    fontFamily: font.semibold,
    fontSize: 16,
    color: colors.textHi,
  },
  sub: {
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textLow,
    marginTop: 6,
    marginBottom: 12,
  },
  suggestBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.accentTint,
    borderWidth: 1,
    borderColor: colors.accent800,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 12,
  },
  suggestText: {
    flex: 1,
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 16,
    color: colors.neutral300,
  },
  kinds: {
    gap: 4,
    marginBottom: 12,
  },
  kindRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: radius.sm,
  },
  kindRowOn: {
    backgroundColor: colors.neutral800,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.neutral500,
  },
  dotOn: {
    borderColor: colors.accent400,
    backgroundColor: colors.accent400,
  },
  kindLabel: {
    fontFamily: font.regular,
    fontSize: 13,
    color: colors.textMid,
  },
  kindLabelOn: {
    color: colors.textHi,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  input: {
    flex: 1,
    minWidth: 80,
    fontFamily: font.medium,
    fontSize: 15,
    color: colors.textHi,
    borderWidth: 1,
    borderColor: colors.neutral800,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  unit: {
    fontFamily: font.regular,
    fontSize: 12,
    color: colors.textLow,
  },
  preview: {
    fontFamily: font.regular,
    fontSize: 12,
    color: colors.accent400,
    marginBottom: 14,
  },
  previewBad: {
    fontFamily: font.regular,
    fontSize: 12,
    color: colors.textLow,
    marginBottom: 14,
  },
});
