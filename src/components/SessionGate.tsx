import { WarningCircleIcon as WarningCircle } from 'phosphor-react-native';
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Card, OutlineButton } from '@/components/ui';
import { useSessionStore } from '@/store/useSessionStore';
import { colors, font, space } from '@/theme/tokens';

/**
 * What covers the navigator while the session gate is deciding.
 *
 * Both of these render OVER the Stack, never instead of it: unmounting the
 * navigator would leave expo-router with nothing to redirect.
 */

/**
 * Restoring a session, or waiting for a redirect to land. Without this the
 * tabs would be visible for the frame between "signed out" and the jump to
 * the sign-in screen — and on a slow connection, for a lot longer.
 */
export function SessionLoadingScreen() {
  return (
    <View style={[styles.container, styles.centered]}>
      <ActivityIndicator color={colors.accent400} />
    </View>
  );
}

/**
 * The session is valid but the account could not be loaded — offline, or the
 * server refused a read. Showing the tabs here would be worse than showing
 * nothing: every screen reads the mirror, and an empty mirror looks exactly
 * like a fresh day 1 with a lost streak.
 */
export function SessionErrorScreen() {
  const error = useSessionStore((s) => s.error);
  const retry = useSessionStore((s) => s.retry);
  const signOut = useSessionStore((s) => s.signOut);

  return (
    <View style={[styles.container, styles.centered]}>
      <Card style={styles.card}>
        <WarningCircle size={34} color={colors.neutral500} />
        <Text style={styles.title}>Couldn{'’'}t load your challenge.</Text>
        <Text style={styles.body}>
          You{'’'}re signed in, but your data didn{'’'}t load. Check
          your connection and try again — nothing has been lost.
        </Text>
        {error ? <Text style={styles.detail}>{error}</Text> : null}
        <OutlineButton
          label="Retry"
          onPress={() => {
            retry().catch(() => {});
          }}
          style={{ marginTop: 16, alignSelf: 'stretch' }}
        />
        <OutlineButton
          label="Sign out"
          tone="neutral"
          small
          onPress={() => {
            signOut().catch(() => {});
          }}
          style={{ marginTop: 10, alignSelf: 'stretch' }}
        />
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: space.screenX,
  },
  centered: {
    justifyContent: 'center',
  },
  card: {
    alignItems: 'center',
    paddingVertical: 28,
  },
  title: {
    fontFamily: font.medium,
    fontSize: 17,
    color: colors.text,
    marginTop: 10,
    textAlign: 'center',
  },
  body: {
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 19,
    color: colors.neutral500,
    marginTop: 6,
    textAlign: 'center',
  },
  detail: {
    fontFamily: font.regular,
    fontSize: 11.5,
    lineHeight: 16,
    color: colors.neutral600,
    marginTop: 10,
    textAlign: 'center',
  },
});
