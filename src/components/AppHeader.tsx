import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Micro, Skew } from '@/components/primitives';
import { selectTierLabel, useAppStore } from '@/store/useAppStore';
import { colors, font, microTracking } from '@/theme/tokens';

/**
 * The developer scenario sheet, in dev builds only.
 *
 * `__DEV__` is a compile-time constant, so in a production bundle this
 * ternary collapses to `null` and the require() is dead code that Metro
 * never follows — DevScenarioSheet and everything it pulls in are absent
 * from the shipped binary. A `__DEV__` check inside the component would
 * have left the sheet in the bundle; this leaves nothing to reach.
 */
const DevMenu: React.ComponentType<{ children: React.ReactNode }> | null =
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  __DEV__ ? require('@/components/DevScenarioSheet').DevScenarioSheet : null;

/**
 * Persistent header: RANKED wordmark and the skewed tier badge. Home also
 * carries STREAK; the other tabs do not, so the day numeral stays the
 * loudest thing on screen.
 */
export function AppHeader({ showStreak = false }: { showStreak?: boolean }) {
  const insets = useSafeAreaInsets();
  const tierLabel = useAppStore(selectTierLabel);
  const flame = useAppStore((s) => s.flame);

  const wordmark = (
    <Text style={styles.wordmark} selectable={false}>
      RANKED
    </Text>
  );

  return (
    <View style={[styles.bar, { paddingTop: insets.top + 10 }]}>
      {DevMenu ? <DevMenu>{wordmark}</DevMenu> : wordmark}

      <View style={styles.right}>
        <Skew label={tierLabel} filled size="sm" />
        {showStreak &&
          // A streak of 00 reads like a counter that failed. Before the
          // first sealed day there is no streak to show, so the header says
          // what is actually true instead.
          (flame > 0 ? (
            <View style={styles.streak}>
              <Micro size={11} color={colors.textMid}>
                Streak
              </Micro>
              <Text
                style={styles.streakFigure}
                maxFontSizeMultiplier={1.4}
              >
                {String(flame).padStart(2, '0')}
              </Text>
            </View>
          ) : (
            <Micro size={10} color={colors.textLow}>
              Streak starts today
            </Micro>
          ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
    backgroundColor: colors.bg,
  },
  wordmark: {
    fontFamily: font.blackItalic,
    fontSize: 21,
    letterSpacing: 0.4,
    color: colors.textHi,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  streak: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  streakFigure: {
    fontFamily: font.black,
    fontSize: 15,
    letterSpacing: microTracking(15),
    color: colors.textHi,
    fontVariant: ['tabular-nums'],
  },
});
