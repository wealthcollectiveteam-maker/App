import { WarningIcon as Warning } from 'phosphor-react-native';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isLiveBackend, mockReason } from '@/services';
import { colors, font } from '@/theme/tokens';

/**
 * Launch-critical, not a dev nicety.
 *
 * When EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY are missing, the app falls back
 * to MockDataService and otherwise behaves EXACTLY like a working build:
 * tasks tick off, the squad fills in, streaks climb — all of it invented,
 * none of it saved. A TestFlight build shipped with a bad .env would look
 * completely normal right up to the relaunch that loses 75 days.
 *
 * So the fallback announces itself, on every screen, permanently. It renders
 * IN FLOW above the navigator rather than floating over it, so it can never
 * cover a header or a back button, and it is deliberately not dismissible:
 * the condition it reports does not change while the app is running.
 *
 * DEV BUILDS ONLY. A production build can no longer reach mock data at all —
 * EXPO_PUBLIC_USE_MOCK is ignored there and missing credentials raise
 * `configurationError`, which blocks the app outright (see services/index.ts).
 * The `__DEV__` guard makes that structural rather than incidental: this
 * banner cannot render in a shipped binary even if the selection logic is
 * changed later.
 */
export function MockModeBanner() {
  const insets = useSafeAreaInsets();

  if (!__DEV__ || isLiveBackend) return null;

  return (
    <View style={[styles.host, { paddingTop: insets.top + 4 }]}>
      <Warning size={13} color={colors.neutral200} weight="fill" />
      <Text style={styles.text} numberOfLines={1}>
        {mockReason === 'forced'
          ? 'Mock data (EXPO_PUBLIC_USE_MOCK) — nothing is saved'
          : 'Mock data — Supabase keys missing, nothing is saved'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 14,
    paddingBottom: 5,
    backgroundColor: colors.neutral900,
    borderBottomWidth: 1,
    borderBottomColor: colors.neutral600,
  },
  text: {
    flex: 1,
    fontFamily: font.medium,
    fontSize: 10.5,
    color: colors.neutral200,
    letterSpacing: 0.2,
  },
});
