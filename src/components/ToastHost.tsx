import React, { useEffect, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

import { useToastStore, type Toast } from '@/store/useToastStore';
import { colors, font, radius, shadows } from '@/theme/tokens';

function ToastPill({ toast }: { toast: Toast }) {
  const [anim] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [anim]);

  return (
    <Animated.View
      style={[
        styles.pill,
        {
          opacity: anim,
          transform: [
            {
              translateY: anim.interpolate({
                inputRange: [0, 1],
                outputRange: [16, 0],
              }),
            },
          ],
        },
      ]}
    >
      <Text style={styles.text}>{toast.message}</Text>
    </Animated.View>
  );
}

/** Toast pills floating above the tab bar. */
export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  return (
    <View pointerEvents="none" style={styles.host}>
      {toasts.map((t) => (
        <ToastPill key={t.id} toast={t} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 92,
    alignItems: 'center',
    gap: 8,
    zIndex: 100,
  },
  pill: {
    backgroundColor: colors.neutral900,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.pill,
    paddingHorizontal: 16,
    paddingVertical: 9,
    ...shadows.md,
  },
  text: {
    fontFamily: font.medium,
    fontSize: 12.5,
    color: colors.neutral200,
  },
});
