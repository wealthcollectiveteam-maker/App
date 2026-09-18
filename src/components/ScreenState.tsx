import { WarningCircleIcon as WarningCircle } from 'phosphor-react-native';
import React, { useEffect, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

import { Card, OutlineButton } from '@/components/ui';
import { useAppStore } from '@/store/useAppStore';
import { colors, font, radius, space } from '@/theme/tokens';

function SkeletonBlock({
  height,
  width = '100%',
  pulse,
}: {
  height: number;
  width?: number | `${number}%`;
  pulse: Animated.Value;
}) {
  return (
    <Animated.View
      style={{
        height,
        width,
        borderRadius: radius.sm,
        backgroundColor: colors.surface,
        opacity: pulse,
      }}
    />
  );
}

function SkeletonScreen() {
  const [pulse] = useState(() => new Animated.Value(0.45));

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.45,
          duration: 700,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <View style={styles.container}>
      <SkeletonBlock height={26} width="40%" pulse={pulse} />
      <View style={{ height: 14 }} />
      <SkeletonBlock height={84} pulse={pulse} />
      <View style={{ height: 10 }} />
      <SkeletonBlock height={180} pulse={pulse} />
      <View style={{ height: 10 }} />
      <SkeletonBlock height={44} pulse={pulse} />
      <View style={{ height: 10 }} />
      <SkeletonBlock height={44} pulse={pulse} />
      <View style={{ height: 10 }} />
      <SkeletonBlock height={44} pulse={pulse} />
    </View>
  );
}

function ErrorScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={[styles.container, { justifyContent: 'center' }]}>
      <Card style={styles.errorCard}>
        <WarningCircle size={34} color={colors.neutral500} />
        <Text style={styles.errorTitle}>Couldn{'\u2019'}t load this.</Text>
        <Text style={styles.errorBody}>
          Check your connection and try again.
        </Text>
        <OutlineButton
          label="Retry"
          onPress={onRetry}
          style={{ marginTop: 16, alignSelf: 'stretch' }}
        />
      </Card>
    </View>
  );
}

/**
 * Wraps a tab screen's content with dev-forceable loading and error states
 * (switchable from the hidden dev menu for QA).
 */
export function ScreenState({ children }: { children: React.ReactNode }) {
  const screenState = useAppStore((s) => s.screenState);
  const setScreenState = useAppStore((s) => s.setScreenState);

  if (screenState === 'loading') return <SkeletonScreen />;
  if (screenState === 'error')
    return <ErrorScreen onRetry={() => setScreenState('ready')} />;
  return <>{children}</>;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: space.screenX,
    paddingTop: 14,
  },
  errorCard: {
    alignItems: 'center',
    paddingVertical: 28,
    marginBottom: 80,
  },
  errorTitle: {
    fontFamily: font.medium,
    fontSize: 17,
    color: colors.text,
    marginTop: 10,
  },
  errorBody: {
    fontFamily: font.regular,
    fontSize: 13,
    color: colors.neutral500,
    marginTop: 4,
  },
});
