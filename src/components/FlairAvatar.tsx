import React from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { colors, font } from '@/theme/tokens';

/**
 * Avatar wrapped in a "flair ring": 90 degrees of accent arc per level,
 * drawn clockwise from 12 o'clock. Caps at a full ring.
 */
export function FlairAvatar({
  initials,
  level,
  size = 36,
}: {
  initials: string;
  level: number;
  size?: number;
}) {
  const ringWidth = size >= 50 ? 3 : 2;
  const r = (size - ringWidth) / 2;
  const c = 2 * Math.PI * r;
  const frac = Math.min((level * 90) / 360, 1);
  const inner = size - ringWidth * 2 - 4;

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
        // start arc at 12 o'clock
        transform={[{ rotate: '-90deg' }]}
      >
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={colors.neutral800}
          strokeWidth={ringWidth}
          fill="none"
        />
        {frac > 0 && (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={colors.accent500}
            strokeWidth={ringWidth}
            strokeDasharray={`${c * frac} ${c}`}
            strokeLinecap={frac < 1 ? 'round' : 'butt'}
            fill="none"
          />
        )}
      </Svg>
      <View
        style={{
          width: inner,
          height: inner,
          borderRadius: inner / 2,
          backgroundColor: colors.neutral900,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text
          style={{
            fontFamily: font.medium,
            fontSize: Math.max(10, inner * 0.34),
            color: colors.neutral300,
            letterSpacing: 0.5,
          }}
        >
          {initials}
        </Text>
      </View>
    </View>
  );
}
