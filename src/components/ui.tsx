import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';

import { colors, font, microTracking, radius, space } from '@/theme/tokens';

/** Section kicker: 10px, .14em, uppercase. */
export function Kicker({
  children,
  color = colors.textMid,
  style,
}: {
  children: React.ReactNode;
  color?: string;
  style?: TextStyle;
}) {
  return (
    <Text
      style={[
        {
          fontFamily: font.semibold,
          fontSize: 10,
          letterSpacing: microTracking(10),
          textTransform: 'uppercase',
          color,
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

/** Hairline rule. Flat now — the system's edges are straight, not faded. */
export function FadingDivider({ style }: { style?: ViewStyle }) {
  return (
    <View style={[{ height: 1, backgroundColor: colors.line }, style]} />
  );
}

/** Accent rule, used in the finish flow. */
export function AccentDivider({ style }: { style?: ViewStyle }) {
  return (
    <View style={[{ height: 1, backgroundColor: colors.accent }, style]} />
  );
}

/**
 * SECONDARY action: outlined, square, uppercase with wide tracking.
 * Primary actions are solid accent — see `PrimaryButton` in primitives.
 */
export function OutlineButton({
  label,
  onPress,
  tone = 'accent',
  style,
  small,
  disabled,
}: {
  label: string;
  onPress?: () => void;
  tone?: 'accent' | 'neutral' | 'ghost';
  style?: ViewStyle;
  small?: boolean;
  /** Dimmed and unpressable — for an action already in flight. */
  disabled?: boolean;
}) {
  const borderColor =
    tone === 'accent'
      ? colors.accent
      : tone === 'neutral'
        ? colors.line
        : 'transparent';
  const textColor =
    tone === 'accent'
      ? colors.textHi
      : tone === 'neutral'
        ? colors.textMid
        : colors.textLow;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed, hovered }: any) => [
        styles.button,
        small && styles.buttonSmall,
        { borderColor },
        disabled && { opacity: 0.5 },
        (hovered || pressed) &&
          tone === 'accent' && { backgroundColor: colors.accentTint },
        (hovered || pressed) &&
          tone !== 'accent' && { backgroundColor: colors.surfaceAlt },
        style,
      ]}
    >
      <Text
        style={[
          styles.buttonLabel,
          small && {
            fontSize: 10.5,
            letterSpacing: microTracking(10.5),
          },
          { color: textColor },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}

/**
 * Underlined text tabs. The active tab carries the accent rule; there is no
 * box. Same API as before so every call site keeps working.
 */
export function SegmentedControl({
  segments,
  value,
  onChange,
  style,
}: {
  segments: string[];
  value: string;
  onChange: (v: string) => void;
  style?: ViewStyle;
}) {
  return (
    <View style={[styles.segmented, style]}>
      {segments.map((s) => {
        const active = s === value;
        return (
          <Pressable
            key={s}
            onPress={() => onChange(s)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={styles.segment}
          >
            <Text
              style={[
                styles.segmentLabel,
                active && { color: colors.accent400 },
              ]}
            >
              {s}
            </Text>
            <View
              style={[
                styles.segmentRule,
                { backgroundColor: active ? colors.accent : 'transparent' },
              ]}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    paddingVertical: 12,
    backgroundColor: 'transparent',
  },
  buttonSmall: {
    minHeight: 32,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  buttonLabel: {
    fontFamily: font.semibold,
    fontSize: 12,
    letterSpacing: microTracking(12),
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    padding: space.cardPad,
  },
  segmented: {
    flexDirection: 'row',
    gap: 14,
    alignItems: 'flex-end',
  },
  segment: {
    minHeight: 32,
    justifyContent: 'flex-end',
    gap: 5,
  },
  segmentLabel: {
    fontFamily: font.semibold,
    fontSize: 10.5,
    letterSpacing: microTracking(10.5),
    textTransform: 'uppercase',
    color: colors.textLow,
  },
  segmentRule: {
    height: 2,
  },
});
