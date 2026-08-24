import { CheckIcon as Check } from 'phosphor-react-native';
import React, { useState } from 'react';
import {
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';

import { CHALLENGE } from '@/constants/challenge';
import { colors, font, microTracking, space } from '@/theme/tokens';

/** The signature slant. Everything skewed in the app uses this one angle. */
const SKEW = '-12deg';
const COUNTER_SKEW = '12deg';

/**
 * The parallelogram.
 *
 * The container slants; the inner label counter-skews by exactly the
 * opposite angle so the SHAPE leans and the TEXT stays upright. Slanted
 * text inside a slanted box reads as a rendering bug, not a style — the
 * counter-skew is the whole point of this component existing.
 */
export function Skew({
  label,
  onPress,
  filled = false,
  tone = 'accent',
  size = 'md',
  disabled = false,
  style,
  labelStyle,
  accessibilityLabel,
}: {
  label: string;
  onPress?: () => void;
  /** Filled = solid accent with dark text. Outlined = hairline + accent text. */
  filled?: boolean;
  tone?: 'accent' | 'muted';
  size?: 'sm' | 'md';
  disabled?: boolean;
  style?: ViewStyle;
  labelStyle?: TextStyle;
  accessibilityLabel?: string;
}) {
  const muted = tone === 'muted' || disabled;
  const background = filled
    ? muted
      ? colors.surfaceAlt
      : colors.accent
    : 'transparent';
  const border = filled
    ? 'transparent'
    : muted
      ? colors.line
      : colors.accent;
  const text = filled
    ? muted
      ? colors.textMid
      : colors.bg
    : muted
      ? colors.textLow
      : colors.textHi;

  const body = (
    <View
      style={[
        styles.skewBox,
        size === 'sm' ? styles.skewBoxSm : styles.skewBoxMd,
        { backgroundColor: background, borderColor: border },
        style,
      ]}
    >
      <View style={styles.counterSkew}>
        <Text
          style={[
            styles.skewLabel,
            size === 'sm' && styles.skewLabelSm,
            { color: text },
            labelStyle,
          ]}
        >
          {label}
        </Text>
      </View>
    </View>
  );

  if (!onPress) return body;
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      hitSlop={6}
      style={({ pressed }: any) => (pressed ? { opacity: 0.72 } : null)}
    >
      {body}
    </Pressable>
  );
}

/**
 * Primary action: SOLID accent with dark text. This reverses the old
 * outlined-only rule — blue is a fill now.
 */
export function PrimaryButton({
  label,
  onPress,
  disabled = false,
  style,
}: {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }: any) => [
        styles.primary,
        { backgroundColor: disabled ? colors.surfaceAlt : colors.accent },
        pressed && !disabled && { opacity: 0.82 },
        style,
      ]}
    >
      <Text
        style={[
          styles.primaryLabel,
          { color: disabled ? colors.textLow : colors.bg },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * N discrete segments with gaps. Filled = accent, empty = surfaceAlt.
 *
 * `total` is ALWAYS the owner's own task count — a squadmate's row uses
 * their day's count, never the viewer's. Nothing here may default to 6.
 */
export function SegmentBar({
  done,
  total,
  height = 4,
  gap = 4,
  style,
}: {
  done: number;
  total: number;
  height?: number;
  gap?: number;
  style?: ViewStyle;
}) {
  if (total <= 0) return null;
  const filled = Math.max(0, Math.min(done, total));
  return (
    <View
      style={[{ flexDirection: 'row', gap }, style]}
      accessibilityRole="progressbar"
      accessibilityLabel={`${filled} of ${total} done`}
    >
      {Array.from({ length: total }, (_, i) => (
        <View
          key={i}
          style={{
            flex: 1,
            height,
            backgroundColor: i < filled ? colors.accent : colors.surfaceAlt,
          }}
        />
      ))}
    </View>
  );
}

type WallCell = 'done' | 'today' | 'future';

const WALL_COLUMNS = 15;

/**
 * The Wall — one cell per challenge day, 15 across. Cell 75 carries its own
 * marker so the finish line is visible from day one.
 */
export function TheWall({
  day,
  doneDays,
  style,
}: {
  /** Today's day number, 1-based. */
  day: number;
  /** How many days are complete. Days before `doneDays` render filled. */
  doneDays: number;
  style?: ViewStyle;
}) {
  const [width, setWidth] = useState(0);
  const gap = 4;
  const cell =
    width > 0
      ? Math.max(6, (width - gap * (WALL_COLUMNS - 1)) / WALL_COLUMNS)
      : 0;

  const stateOf = (n: number): WallCell =>
    n <= doneDays ? 'done' : n === day ? 'today' : 'future';

  const onLayout = (e: LayoutChangeEvent) =>
    setWidth(e.nativeEvent.layout.width);

  return (
    <View style={style}>
      <View style={styles.wallHeader}>
        <Text style={styles.microLabel}>The Wall</Text>
        <Text style={styles.wallCount}>
          {day} / {CHALLENGE.days}
        </Text>
      </View>

      <View onLayout={onLayout} style={{ gap }}>
        {cell > 0 &&
          Array.from(
            { length: Math.ceil(CHALLENGE.days / WALL_COLUMNS) },
            (_, row) => (
              <View key={row} style={{ flexDirection: 'row', gap }}>
                {Array.from({ length: WALL_COLUMNS }, (_, col) => {
                  const n = row * WALL_COLUMNS + col + 1;
                  if (n > CHALLENGE.days) return null;
                  const state = stateOf(n);
                  const last = n === CHALLENGE.days;
                  return (
                    <View
                      key={n}
                      style={[
                        {
                          width: cell,
                          height: cell,
                          backgroundColor:
                            state === 'done'
                              ? colors.accent
                              : colors.surfaceAlt,
                        },
                        state === 'today' && {
                          borderWidth: 1,
                          borderColor: colors.textMid,
                          backgroundColor: 'transparent',
                        },
                        // Day 75 stays visible before it is reached.
                        last &&
                          state !== 'done' && {
                            backgroundColor: colors.textLow,
                          },
                      ]}
                    />
                  );
                })}
              </View>
            ),
          )}
      </View>

      <View style={styles.wallLegend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, { backgroundColor: colors.accent }]} />
          <Text style={styles.legendText}>Done</Text>
        </View>
        <View style={styles.legendItem}>
          <View
            style={[
              styles.legendSwatch,
              { borderWidth: 1, borderColor: colors.textMid },
            ]}
          />
          <Text style={styles.legendText}>Today</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={styles.legendDiamond} />
          <Text style={styles.legendText}>Day {CHALLENGE.days}</Text>
        </View>
      </View>
    </View>
  );
}

/** 45deg-rotated square with an upright numeral inside. */
export function DiamondBadge({
  value,
  label,
  earned,
  size = 54,
}: {
  value: number | string;
  label: string;
  earned: boolean;
  size?: number;
}) {
  const stroke = earned ? colors.accent : colors.textLow;
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 8 }}>
      <View
        style={{
          width: size,
          height: size,
          alignItems: 'center',
          justifyContent: 'center',
          transform: [{ rotate: '45deg' }],
          borderWidth: 1,
          borderColor: stroke,
        }}
      >
        {/* Counter-rotated so the numeral reads upright inside the diamond. */}
        <Text
          style={{
            transform: [{ rotate: '-45deg' }],
            fontFamily: font.bold,
            fontSize: 17,
            color: earned ? colors.accent : colors.textLow,
          }}
          maxFontSizeMultiplier={1.3}
        >
          {value}
        </Text>
      </View>
      <Text
        style={[
          styles.badgeLabel,
          { color: earned ? colors.textHi : colors.textLow },
        ]}
        maxFontSizeMultiplier={1.4}
      >
        {label}
      </Text>
    </View>
  );
}

/** Large figure over a tiny uppercase label. */
export function StatBox({
  value,
  label,
  tone = 'default',
  style,
}: {
  value: number | string;
  label: string;
  tone?: 'default' | 'accent';
  style?: ViewStyle;
}) {
  return (
    <View style={[styles.statBox, style]}>
      <Text
        style={[
          styles.statValue,
          tone === 'accent' && { color: colors.accent400 },
        ]}
        maxFontSizeMultiplier={1.4}
      >
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

/**
 * Square checkbox, label, right-aligned meta. Completed rows strike through
 * and drop to textMid. Presentational — the caller owns the completion call.
 */
export function TaskRow({
  label,
  done,
  meta,
  right,
  onPress,
}: {
  label: string;
  done: boolean;
  /** Right-aligned text meta (a completion time, "64 oz left"). */
  meta?: string;
  /** Right-aligned node (a skewed TIMER control), shown when there is no meta. */
  right?: React.ReactNode;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: done }}
      accessibilityLabel={label}
      style={styles.taskRow}
    >
      <View
        style={[
          styles.checkbox,
          done && { backgroundColor: colors.accent, borderColor: colors.accent },
        ]}
      >
        {done && <Check size={15} weight="bold" color={colors.bg} />}
      </View>
      <Text
        style={[
          styles.taskLabel,
          done && {
            textDecorationLine: 'line-through',
            color: colors.textMid,
          },
        ]}
      >
        {label}
      </Text>
      {meta ? <Text style={styles.taskMeta}>{meta}</Text> : right}
    </Pressable>
  );
}

/** Square initials tile. The accent underline marks "this is you". */
export function InitialsTile({
  initials,
  active = false,
  size = 44,
}: {
  initials: string;
  active?: boolean;
  size?: number;
}) {
  return (
    <View>
      <View
        style={{
          width: size,
          height: size,
          backgroundColor: colors.surfaceAlt,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text
          style={{
            fontFamily: font.bold,
            fontSize: Math.max(10, size * 0.28),
            letterSpacing: 0.6,
            color: colors.textHi,
          }}
          maxFontSizeMultiplier={1.3}
        >
          {initials}
        </Text>
      </View>
      <View
        style={{
          height: 2,
          backgroundColor: active ? colors.accent : colors.line,
        }}
      />
    </View>
  );
}

/** Uppercase micro-label: Inter 600, wide tracking. */
export function Micro({
  children,
  color = colors.textMid,
  size = 11,
  style,
}: {
  children: React.ReactNode;
  color?: string;
  size?: number;
  style?: TextStyle;
}) {
  return (
    <Text
      style={[
        {
          fontFamily: font.semibold,
          fontSize: size,
          letterSpacing: microTracking(size),
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

/** Serif italic. Quotes and descriptors only — never a label or a button. */
export function Serif({
  children,
  size = 17,
  color = colors.textMid,
  style,
}: {
  children: React.ReactNode;
  size?: number;
  color?: string;
  style?: TextStyle;
}) {
  return (
    <Text
      style={[
        {
          fontFamily: font.serifItalic,
          fontSize: size,
          lineHeight: size * 1.4,
          color,
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

/** Card with an accent rule down its left edge. */
export function AccentCard({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  return (
    <View style={[styles.accentCard, style]}>
      <View style={styles.accentRule} />
      <View style={{ flex: 1, padding: space.cardPad }}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  skewBox: {
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ skewX: SKEW }],
  },
  skewBoxMd: {
    minHeight: 40,
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
  skewBoxSm: {
    minHeight: 30,
    paddingHorizontal: 14,
    paddingVertical: 5,
  },
  counterSkew: {
    transform: [{ skewX: COUNTER_SKEW }],
  },
  skewLabel: {
    fontFamily: font.semibold,
    fontSize: 12,
    letterSpacing: microTracking(12),
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  skewLabelSm: {
    fontSize: 10.5,
    letterSpacing: microTracking(10.5),
  },
  primary: {
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  primaryLabel: {
    fontFamily: font.blackItalic,
    fontSize: 18,
    letterSpacing: 1,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  microLabel: {
    fontFamily: font.semibold,
    fontSize: 11,
    letterSpacing: microTracking(11),
    textTransform: 'uppercase',
    color: colors.textMid,
  },
  wallHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  wallCount: {
    fontFamily: font.bold,
    fontSize: 13,
    letterSpacing: 0.5,
    color: colors.accent400,
    fontVariant: ['tabular-nums'],
  },
  wallLegend: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendSwatch: {
    width: 8,
    height: 8,
  },
  legendDiamond: {
    width: 8,
    height: 8,
    backgroundColor: colors.textLow,
    transform: [{ rotate: '45deg' }],
  },
  legendText: {
    fontFamily: font.semibold,
    fontSize: 10,
    letterSpacing: microTracking(10),
    textTransform: 'uppercase',
    color: colors.textLow,
  },
  badgeLabel: {
    fontFamily: font.semibold,
    fontSize: 9,
    letterSpacing: microTracking(9),
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  statBox: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 14,
    paddingVertical: 18,
  },
  statValue: {
    fontFamily: font.black,
    fontSize: 40,
    letterSpacing: -1.6,
    color: colors.textHi,
  },
  statLabel: {
    fontFamily: font.semibold,
    fontSize: 10,
    letterSpacing: microTracking(10),
    textTransform: 'uppercase',
    color: colors.textMid,
    marginTop: 8,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: 56,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderWidth: 1,
    borderColor: colors.textLow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  taskLabel: {
    flex: 1,
    fontFamily: font.medium,
    fontSize: 16,
    color: colors.textHi,
  },
  taskMeta: {
    fontFamily: font.semibold,
    fontSize: 11,
    letterSpacing: microTracking(11),
    textTransform: 'uppercase',
    color: colors.textMid,
  },
  accentCard: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
  },
  accentRule: {
    width: 2,
    backgroundColor: colors.accent,
  },
});
