import React from 'react';
import { Platform, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { CHALLENGE } from '@/constants/challenge';
import { colors, font } from '@/theme/tokens';

/**
 * 172px SVG progress ring: 8px stroke, neutral-900 track, accent progress
 * with round caps and a soft blue glow. Also serves as the timer's draining
 * ring via `fraction` + `children` (one ring component, reused everywhere).
 */
export function ProgressRing({
  day = 0,
  // Only a divisor for the day/total path, which every current caller
  // bypasses by passing `fraction`. It is the default length rather than a
  // bare 75 so there is no literal here to go stale — a caller that does use
  // day/total should pass the challenge's own length.
  total = CHALLENGE.defaultDays,
  size = 172,
  fraction,
  children,
}: {
  day?: number;
  total?: number;
  size?: number;
  /** Overrides day/total with an explicit 0–1 fill fraction. */
  fraction?: number;
  /** Overrides the default day-number center content. */
  children?: React.ReactNode;
}) {
  const stroke = 8;
  const r = (size - stroke) / 2 - 4;
  const c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(fraction ?? day / total, 1));

  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Svg
        width={size}
        height={size}
        style={{ position: 'absolute' }}
        transform={[{ rotate: '-90deg' }]}
      >
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={colors.neutral900}
          strokeWidth={stroke}
          fill="none"
        />
        {/* soft glow underlay */}
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={colors.accent500}
          strokeOpacity={0.28}
          strokeWidth={stroke + 7}
          strokeDasharray={`${c * frac} ${c}`}
          strokeLinecap="round"
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={colors.accent500}
          strokeWidth={stroke}
          strokeDasharray={`${c * frac} ${c}`}
          strokeLinecap="round"
          fill="none"
        />
      </Svg>
      {children ?? (
        <>
          <Text
            style={{
              fontFamily: font.medium,
              fontSize: 54,
              color: colors.text,
              lineHeight: 58,
              ...(Platform.OS === 'web'
                ? ({ textShadow: `0 0 24px ${colors.accent700}` } as any)
                : null),
            }}
          >
            {day}
          </Text>
          <Text
            style={{
              fontFamily: font.medium,
              fontSize: 11,
              letterSpacing: 2.64, // .24em
              color: colors.neutral500,
              textTransform: 'uppercase',
              marginTop: 2,
            }}
          >
            OF {total}
          </Text>
        </>
      )}
    </View>
  );
}
