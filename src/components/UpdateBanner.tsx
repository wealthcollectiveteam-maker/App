import { ArrowClockwiseIcon as ArrowClockwise, XIcon as X } from 'phosphor-react-native';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Skew } from '@/components/primitives';
import { selectUpdateReady, useUpdateStore } from '@/store/useUpdateStore';
import { colors, font } from '@/theme/tokens';

/**
 * "A new version is ready."
 *
 * IN FLOW, above the navigator, exactly like MockModeBanner — not floating
 * over the app. A floating banner would have to sit somewhere, and every
 * somewhere on this screen is a control: the header carries the tier badge,
 * the bottom is the tab bar plus the home indicator, and the middle is the
 * whole app. In flow it cannot cover a tab, a header, a save button or the
 * bar, at any scroll position, on any screen. It costs one strip of height
 * while an update is pending, and nothing at all when there is none.
 *
 * Dismissible, because an update is not urgent and a permanent strip would
 * be. Dismissal lasts until the next cold start (see useUpdateStore) — it
 * stops the nagging without letting the app go stale for ever.
 *
 * UPDATE only ever runs on this tap. Nothing here reloads on its own; see
 * lib/webUpdate.ts for why.
 *
 * It takes the top inset because it is the first thing in the flow and the
 * standalone status bar is translucent — without it the clock sits on top of
 * the text. The screen header below adds its own top inset regardless, so
 * while the banner is up there is a band of empty space beneath it. That is
 * cosmetic, it lasts until the tap or the dismiss, and closing it properly
 * means making AppHeader's inset conditional on what is above it — a change
 * to a layout that was just settled on device, for a strip that is normally
 * not on screen at all.
 */
export function UpdateBanner() {
  const insets = useSafeAreaInsets();
  const ready = useUpdateStore(selectUpdateReady);
  const apply = useUpdateStore((s) => s.apply);
  const dismiss = useUpdateStore((s) => s.dismiss);

  if (!ready) return null;

  return (
    <View style={[styles.host, { paddingTop: insets.top + 7 }]}>
      <ArrowClockwise size={13} color={colors.accent300} weight="bold" />
      <Text style={styles.text} numberOfLines={1}>
        A new version is ready
      </Text>
      <Skew
        label="UPDATE"
        filled
        size="sm"
        onPress={apply}
        accessibilityLabel="Update to the new version"
      />
      <Pressable
        onPress={dismiss}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Dismiss the update notice"
      >
        <X size={13} color={colors.neutral500} weight="bold" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 14,
    paddingVertical: 7,
    backgroundColor: colors.surfaceAlt,
    borderBottomWidth: 1,
    borderBottomColor: colors.accent700,
  },
  text: {
    flex: 1,
    fontFamily: font.medium,
    fontSize: 11.5,
    color: colors.neutral200,
    letterSpacing: 0.2,
  },
});
