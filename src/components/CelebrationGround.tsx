import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { colors } from '@/theme/tokens';

/** Full-screen deep-blue celebration ground with a radial glow at 50%/32%. */
export function CelebrationGround({ children }: { children: React.ReactNode }) {
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.celebrationGround }]}>
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="glow" cx="50%" cy="32%" r="70%">
            <Stop offset="0" stopColor={colors.celebrationGlow} stopOpacity={1} />
            <Stop offset="1" stopColor={colors.celebrationGround} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#glow)" />
      </Svg>
      {children}
    </View>
  );
}
