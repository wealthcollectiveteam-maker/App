/**
 * TEMPORARY — PHASE 12B. DELETE THIS FILE once the tab bar layout is
 * confirmed on a real iPhone.
 *
 * Also delete, at the same time:
 *   - the guarded require + <LayoutDebugOverlay /> in src/app/(tabs)/_layout.tsx,
 *     and the <View style={{ flex: 1 }}> wrapper around <Tabs> that exists
 *     only to give that overlay something to be absolute inside
 *   - the `ref={...captureTabBar}` on the tab bar View there
 *   - the guarded require + the "Layout debug" row in src/app/settings/index.tsx
 *   - EXPO_PUBLIC_LAYOUT_DEBUG from .env and .env.example
 *
 * WHY IT EXISTS. The tab bar is wrong on a home-indicator iPhone in
 * standalone mode and right everywhere anyone working on it can look:
 * headless Chrome reports env(safe-area-inset-bottom) = 0, so the whole
 * failure mode is invisible off-device. Two phases were spent adjusting
 * numbers against a viewport that could not show the defect. This panel
 * exists so the phone can be asked directly instead.
 *
 * IT ONLY READS. Nothing here writes state, calls a service or touches the
 * challenge. Leaving it open changes nothing.
 *
 * HOW IT IS GATED. `__DEV__ || EXPO_PUBLIC_LAYOUT_DEBUG === '1'`, evaluated
 * at module scope by the two callers, so the require() is unreached in a
 * build made without the flag — the same shape as DevScenarioSheet.
 *
 * THE DEVIATION FROM THAT SHEET IS DELIBERATE. The scenario sheet is gated on
 * `__DEV__` alone, which would put this panel in every dev build and in no
 * shipped one — including the production web build that is the only place the
 * defect appears. A `__DEV__`-only gate would be a diagnostic that cannot
 * reach the thing it diagnoses. The extra flag is unset unless a build is made
 * with it explicitly, so a normal `npm run build:web` ships a bundle this file
 * is absent from.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, font } from '@/theme/tokens';

const IS_WEB = Platform.OS === 'web';

/**
 * The tab bar's own element, handed over by (tabs)/_layout.tsx. On web a
 * react-native-web ref IS the DOM node, so the panel measures the bar that is
 * actually on screen rather than recomputing what it thinks the bar should be
 * — which is the mistake that produced two wrong fixes.
 */
let tabBarNode: unknown = null;

export function captureTabBar(node: unknown) {
  tabBarNode = node;
}

/**
 * Open/closed, shared across navigators. Settings lives outside the (tabs)
 * navigator, so the row there cannot render the panel itself — the tab bar
 * would not be on screen to measure. It flips this and sends the user back to
 * the tabs, where the overlay is mounted beside the real bar.
 */
let open = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

export function openPanel() {
  open = true;
  emit();
}

function useOpen() {
  const [value, setValue] = useState(open);
  useEffect(() => {
    const listener = () => setValue(open);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return value;
}

/**
 * env(safe-area-inset-bottom), read back as a number.
 *
 * getComputedStyle on a custom property returns the token as written
 * ("env(safe-area-inset-bottom)"), not a resolved length. So the property is
 * set AND consumed by a real length property, and the resolved value is read
 * off that instead. Both are reported: the raw token proves the property is
 * carrying what we think it is, the resolved px is the number that matters.
 */
function readEnvBottom(): { raw: string; resolved: string } {
  const probe = document.createElement('div');
  probe.style.position = 'fixed';
  probe.style.left = '0';
  probe.style.top = '0';
  probe.style.width = '0';
  probe.style.height = '0';
  probe.style.visibility = 'hidden';
  probe.style.pointerEvents = 'none';
  probe.style.setProperty('--sab', 'env(safe-area-inset-bottom)');
  probe.style.paddingBottom = 'var(--sab)';
  document.body.appendChild(probe);
  const style = window.getComputedStyle(probe);
  const raw = style.getPropertyValue('--sab').trim() || '(empty)';
  const resolved = style.paddingBottom;
  document.body.removeChild(probe);
  return { raw, resolved };
}

function num(value: number | null | undefined) {
  return value == null ? 'null' : String(Math.round(value * 100) / 100);
}

type Row = [string, string];

function collect(insets: {
  top: number;
  bottom: number;
  left: number;
  right: number;
}): Row[] {
  const rows: Row[] = [['platform', Platform.OS]];

  if (IS_WEB && typeof window !== 'undefined') {
    const nav = window.navigator as Navigator & { standalone?: boolean };
    rows.push([
      'display-mode: standalone',
      String(window.matchMedia?.('(display-mode: standalone)').matches),
    ]);
    rows.push([
      'navigator.standalone',
      nav.standalone === undefined ? 'undefined' : String(nav.standalone),
    ]);
    rows.push(['window.innerHeight', num(window.innerHeight)]);
    rows.push([
      'visualViewport.height',
      num(window.visualViewport ? window.visualViewport.height : null),
    ]);
    rows.push([
      'documentElement.clientHeight',
      num(document.documentElement.clientHeight),
    ]);
    const env = readEnvBottom();
    rows.push(['--sab raw token', env.raw]);
    rows.push(['env(safe-area-inset-bottom)', env.resolved]);
  }

  rows.push(['insets.top', num(insets.top)]);
  rows.push(['insets.bottom', num(insets.bottom)]);
  rows.push(['insets.left', num(insets.left)]);
  rows.push(['insets.right', num(insets.right)]);

  const node = tabBarNode as HTMLElement | null;
  if (IS_WEB && typeof window !== 'undefined' && node?.getBoundingClientRect) {
    const style = window.getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    rows.push(['tabbar paddingTop', style.paddingTop]);
    rows.push(['tabbar paddingBottom', style.paddingBottom]);
    rows.push(['tabbar marginBottom', style.marginBottom]);
    rows.push(['tabbar height', num(rect.height)]);
    rows.push(['tabbar rect.top', num(rect.top)]);
    rows.push(['tabbar rect.bottom', num(rect.bottom)]);
    // Zero means the bar ends exactly at the bottom of the viewport. Anything
    // else is the dead band, measured rather than described.
    rows.push([
      'innerHeight - rect.bottom',
      num(window.innerHeight - rect.bottom),
    ]);
    rows.push(['tabbar inline style', node.getAttribute('style') ?? '(none)']);
  } else {
    rows.push(['tabbar element', node ? 'captured' : 'NOT CAPTURED']);
  }

  return rows;
}

/**
 * Rendered by (tabs)/_layout.tsx over the tab screens and deliberately NOT
 * over the tab bar: the point is to photograph the numbers and the bar in one
 * screenshot.
 */
export function LayoutDebugOverlay() {
  const isOpen = useOpen();
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<Row[]>([]);

  const measure = useCallback(() => {
    setRows(collect(insets));
  }, [insets]);

  // A layout read taken in the same commit that mounted the panel can catch
  // the bar mid-relayout. A frame later it cannot.
  useEffect(() => {
    if (!isOpen) return;
    const id = setTimeout(measure, 150);
    return () => clearTimeout(id);
  }, [isOpen, measure]);

  if (!isOpen) return null;

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <View style={styles.panel}>
        <View style={styles.head}>
          <Text style={styles.title}>LAYOUT DEBUG — TEMPORARY</Text>
          <View style={styles.headButtons}>
            <Pressable onPress={measure} style={styles.button} hitSlop={8}>
              <Text style={styles.buttonLabel}>RE-READ</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                open = false;
                emit();
              }}
              style={styles.button}
              hitSlop={8}
            >
              <Text style={styles.buttonLabel}>CLOSE</Text>
            </Pressable>
          </View>
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: 10 }}>
          {rows.map(([label, value]) => (
            <Text key={label} style={styles.line} selectable>
              {label}: {value}
            </Text>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  panel: {
    maxHeight: '74%',
    margin: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.bg,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  headButtons: { flexDirection: 'row', gap: 8 },
  title: {
    fontFamily: font.bold,
    fontSize: 13,
    color: colors.accent400,
  },
  button: {
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  buttonLabel: {
    fontFamily: font.semibold,
    fontSize: 11,
    color: colors.textMid,
  },
  line: {
    fontFamily: IS_WEB ? 'monospace' : font.regular,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textHi,
  },
});
