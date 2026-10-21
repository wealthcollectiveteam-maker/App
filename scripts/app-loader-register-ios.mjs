/**
 * scripts/app-loader-register.mjs, as the iOS app sees the code (Phase 38S,
 * S1b): react-native's Platform.OS is 'ios'. Everything else is the same.
 *
 *   node --import ./scripts/app-loader-register-ios.mjs scripts/<test>.mjs
 */
process.env.APP_LOADER_OS = 'ios';
await import('./app-loader-register.mjs');
