import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

import { colors } from '@/theme/tokens';

/**
 * The HTML shell wrapped around EVERY statically-exported route. It runs in
 * Node at export time only — never in the browser — so it holds no state and
 * no hooks.
 *
 * Three jobs, none of which Expo's default shell does:
 *
 * 1. ADD TO HOME SCREEN. The manifest link plus the apple-* meta tags are
 *    what turn a bookmark into something that opens full-screen with the
 *    right icon. iOS 16.4+ reads the manifest; older iOS reads only the
 *    apple-* tags, so both are here.
 *
 * 2. NO WHITE FLASH. Expo's reset styles the layout but never the colour, so
 *    the browser paints its default white until the JS bundle mounts — on a
 *    near-black app that reads as a broken load. `background-color` on both
 *    html and body (and the standalone status bar via theme-color) makes the
 *    first paint the app's own ground.
 *
 * 3. VIEWPORT. `viewport-fit=cover` so the safe-area insets react-native-web
 *    reads are real on a notched phone; `user-scalable=no` because a
 *    double-tap zoom on a tab bar is a misfire, not a gesture.
 *
 * 4. THE BOTTOM INSET, IN CSS. react-native-safe-area-context does not read
 *    env() on web. It appends a hidden probe div, gives it
 *    `padding: env(safe-area-inset-*)`, measures the computed padding once on
 *    mount, and after that only updates when a CSS TRANSITION on that padding
 *    fires. Its documented initial value on web is zero, for SSR. So the
 *    first paint always believes there is no home indicator, and if the real
 *    value is already in place before the probe is inserted there is no
 *    transition to notice — the app can believe that for ever.
 *
 *    A tab bar that believes bottom = 0 puts its labels inside the home
 *    indicator's gesture area, where iOS eats the taps. So the bar's bottom
 *    padding is taken straight from the browser here instead. It overrides
 *    rather than adds, so it can never double up with the JS value.
 *
 * The colours come from the token file like everywhere else. `manifest.json`
 * in `public/` repeats them as literals because JSON cannot import — if the
 * ground colour ever changes, `npm run build:web` fails until that file is
 * updated to match (see scripts/build-web.mjs).
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"
        />

        <title>Ranked Fitness</title>
        <meta
          name="description"
          content="A squad of friends runs the same challenge. Everyone sees who showed up; nobody sees anyone else's private data."
        />

        {/* Add to Home Screen */}
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content={colors.bg} />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <meta name="apple-mobile-web-app-title" content="Ranked" />
        <meta name="mobile-web-app-capable" content="yes" />
        {/* The favicon link is Expo's own, generated from app.json's
            web.favicon — do not add a second one here. */}
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />

        {/* Disables body scrolling on web so ScrollView components work as
            they do on native. Expo's own reset; keep it above ours. */}
        <ScrollViewStyleReset />

        <style dangerouslySetInnerHTML={{ __html: backgroundStyle }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

const backgroundStyle = `
html, body, #root {
  background-color: ${colors.bg};
  color-scheme: dark;
}

/* Marked by the tab bar with a safeBottom dataSet entry. max() keeps the
   10px floor on a device with no home indicator, where env() resolves to 0.
   The !important is because react-native-web writes the JS value inline. */
[data-safe-bottom] {
  padding-bottom: 10px;
  padding-bottom: max(10px, env(safe-area-inset-bottom)) !important;
}
`;
