import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Animated, Platform, StyleSheet, Text } from 'react-native';

import { CelebrationGround } from '@/components/CelebrationGround';
import { Kicker, OutlineButton } from '@/components/ui';
import { useAppStore } from '@/store/useAppStore';
import { colors, font } from '@/theme/tokens';

export default function CelebrationScreen() {
  const router = useRouter();
  const day = useAppStore((s) => s.day);
  const squadName = useAppStore((s) => s.squad.name);
  const sealDay = useAppStore((s) => s.sealDay);

  const [fade] = useState(() => new Animated.Value(0));
  const [pop] = useState(() => new Animated.Value(0.9));

  useEffect(() => {
    sealDay();
    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.spring(pop, { toValue: 1, speed: 14, bounciness: 8, useNativeDriver: true }),
    ]).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <CelebrationGround>
      <Animated.View
        style={[
          styles.center,
          { opacity: fade, transform: [{ scale: pop }] },
        ]}
      >
        <Kicker color={colors.accent200} style={{ letterSpacing: 3 }}>
          Day complete
        </Kicker>
        <Text style={styles.dayNumber}>{day}</Text>
        <Text style={styles.locked}>LOCKED IN.</Text>
        <Text style={styles.meta}>
          +120 XP · flame +1 · {squadName} notified
        </Text>
        <OutlineButton
          label="Keep going"
          onPress={() => router.back()}
          style={{ marginTop: 30, minWidth: 200 }}
        />
      </Animated.View>
    </CelebrationGround>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  dayNumber: {
    fontFamily: font.medium,
    fontSize: 96,
    lineHeight: 104,
    color: colors.text,
    marginTop: 18,
    ...(Platform.OS === 'web'
      ? ({ textShadow: `0 0 42px ${colors.accent500}` } as any)
      : null),
  },
  locked: {
    fontFamily: font.medium,
    fontSize: 20,
    letterSpacing: 3.2,
    color: colors.accent100,
    marginTop: 8,
  },
  meta: {
    fontFamily: font.regular,
    fontSize: 13,
    color: colors.accent300,
    marginTop: 12,
  },
});
