import { BellSlashIcon as BellSlash } from 'phosphor-react-native';
import React, { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, StyleSheet, Text, View } from 'react-native';

import { OutlineButton } from '@/components/ui';
import {
  getNotificationPermissionStatus,
  type NotificationPermission,
} from '@/services/timerEffects';
import { colors, font, radius } from '@/theme/tokens';

/**
 * The REAL system notification grant, shown in Settings — the app-side
 * toggles below it are meaningless when iOS itself has notifications off.
 * One shared iOS permission covers timer alerts and (post-B4b) pings, so a
 * silent denial would kill both. Re-checks on foreground so it clears the
 * moment the user flips the switch in system Settings.
 */
export function NotificationPermissionBanner() {
  const [status, setStatus] = useState<NotificationPermission>('unavailable');

  const refresh = useCallback(() => {
    getNotificationPermissionStatus().then(setStatus).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  if (status === 'unavailable') return null;

  if (status === 'denied') {
    return (
      <View style={styles.denied}>
        <BellSlash size={15} color={colors.neutral300} />
        <Text style={styles.deniedText}>
          Notifications are off in iOS Settings — timer alerts and pings
          can{'\u2019'}t reach you.
        </Text>
        <OutlineButton
          label="Open Settings"
          small
          onPress={() => Linking.openSettings().catch(() => {})}
        />
      </View>
    );
  }

  return (
    <Text style={styles.statusLine}>
      {status === 'granted'
        ? 'System permission: granted'
        : 'System permission: not asked yet — starting a timer will ask'}
    </Text>
  );
}

const styles = StyleSheet.create({
  denied: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: colors.neutral600,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
  },
  deniedText: {
    flex: 1,
    fontFamily: font.regular,
    fontSize: 11.5,
    color: colors.neutral300,
    lineHeight: 15.5,
  },
  statusLine: {
    fontFamily: font.regular,
    fontSize: 11,
    color: colors.neutral500,
    marginBottom: 8,
    marginLeft: 2,
  },
});
