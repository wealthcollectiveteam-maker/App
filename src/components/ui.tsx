import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { colors, font, radius, shadows, space } from '@/theme/tokens';

/** Section kicker: 10px, .14em, uppercase, accent. */
export function Kicker({
  children,
  color = colors.accent400,
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
          fontFamily: font.medium,
          fontSize: 10,
          letterSpacing: 1.4,
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

/** Nocturne signature: 1px rule fading to transparent at both ends. */
export function FadingDivider({ style }: { style?: ViewStyle }) {
  return (
    <View style={[{ height: 1, width: '100%' }, style]}>
      <Svg width="100%" height={1}>
        <Defs>
          <LinearGradient id="fade" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={colors.text} stopOpacity={0} />
            <Stop offset="0.5" stopColor={colors.text} stopOpacity={0.16} />
            <Stop offset="1" stopColor={colors.text} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height={1} fill="url(#fade)" />
      </Svg>
    </View>
  );
}

/** Accent-fade divider used in the finish flow. */
export function AccentDivider({ style }: { style?: ViewStyle }) {
  return (
    <View style={[{ height: 1, width: '100%' }, style]}>
      <Svg width="100%" height={1}>
        <Defs>
          <LinearGradient id="afade" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={colors.accent500} stopOpacity={0} />
            <Stop offset="0.5" stopColor={colors.accent500} stopOpacity={0.7} />
            <Stop offset="1" stopColor={colors.accent500} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height={1} fill="url(#afade)" />
      </Svg>
    </View>
  );
}

/**
 * Primary button style: outlined (1px accent border on transparent),
 * uppercase, .16em — accent is never a large filled area.
 */
export function OutlineButton({
  label,
  onPress,
  tone = 'accent',
  style,
  small,
}: {
  label: string;
  onPress?: () => void;
  tone?: 'accent' | 'neutral' | 'ghost';
  style?: ViewStyle;
  small?: boolean;
}) {
  const borderColor =
    tone === 'accent'
      ? colors.accent500
      : tone === 'neutral'
        ? colors.neutral700
        : 'transparent';
  const textColor =
    tone === 'accent'
      ? colors.accent300
      : tone === 'neutral'
        ? colors.neutral400
        : colors.neutral500;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed, hovered }: any) => [
        styles.button,
        small && styles.buttonSmall,
        { borderColor },
        (hovered || pressed) &&
          tone === 'accent' && {
            backgroundColor: colors.accentTint,
            borderColor: colors.accent400,
          },
        (hovered || pressed) &&
          tone !== 'accent' && { backgroundColor: 'rgba(233,233,237,0.05)' },
        style,
      ]}
    >
      <Text
        style={[
          styles.buttonLabel,
          small && { fontSize: 10.5 },
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
            style={[styles.segment, active && styles.segmentActive]}
          >
            <Text
              style={[
                styles.segmentLabel,
                active && { color: colors.accent200 },
              ]}
            >
              {s}
            </Text>
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
    fontFamily: font.medium,
    fontSize: 12,
    letterSpacing: 1.9, // .16em
    textTransform: 'uppercase',
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    padding: space.cardPad,
    ...shadows.sm,
  },
  segmented: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  segment: {
    flex: 1,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentActive: {
    backgroundColor: colors.accent900,
  },
  segmentLabel: {
    fontFamily: font.medium,
    fontSize: 10,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: colors.neutral500,
  },
});
