/**
 * NO PUSH ENTITLEMENT (Phase 38S, S2c).
 *
 * The daily reminder is a LOCAL notification, scheduled on the phone by
 * services/reminder.ts. Nothing in this app asks for a push token or
 * receives a remote notification, so the build has no use for APNs.
 *
 * expo-notifications' config plugin on SDK 54 (0.32.x) always writes
 * `aps-environment` into the entitlements, and Expo applies that plugin
 * automatically whenever the package is installed — leaving it out of
 * app.json does not remove it. The `enableRemoteNotifications: false`
 * option the current Expo docs describe does not exist in the 0.32.x
 * plugin (plugin/build/withNotificationsIOS.js reads only `mode`, `sounds`
 * and `enableBackgroundRemoteNotifications`). So this deletes the key after
 * the fact, and the App Store provisioning profile does not need Push.
 *
 * ORDER MATTERS: it must be FIRST in app.json's plugins. Mods registered
 * earlier run later, so first-listed is the last word on the entitlements.
 * Listed last, expo-notifications re-adds the key after this deletes it
 * (checked with `npx expo config --type introspect`;
 * scripts/entitlements.test.mjs holds it there).
 *
 * If push is ever added, delete this plugin; the entitlement comes back.
 */
const { withEntitlementsPlist } = require('expo/config-plugins');

module.exports = function withoutPushEntitlement(config) {
  return withEntitlementsPlist(config, (cfg) => {
    delete cfg.modResults['aps-environment'];
    return cfg;
  });
};
