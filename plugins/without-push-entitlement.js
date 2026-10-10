// expo-notifications always adds the aps-environment (push) entitlement, and
// Expo applies its plugin automatically once the package is installed.
// StepPool only schedules local reminders, so after every other plugin has
// run, strip the entitlement so free Apple accounts can sign the app.
const fs = require('fs');
const { IOSConfig, withFinalizedMod } = require('expo/config-plugins');
const { stripPushEntitlement } = require('./strip-push-entitlement');

module.exports = function withoutPushEntitlement(config) {
  return withFinalizedMod(config, [
    'ios',
    async (config) => {
      const file = IOSConfig.Entitlements.getEntitlementsPath(config.modRequest.projectRoot);
      if (file && fs.existsSync(file)) {
        const xml = fs.readFileSync(file, 'utf8');
        const stripped = stripPushEntitlement(xml);
        if (stripped !== xml) fs.writeFileSync(file, stripped);
      }
      return config;
    },
  ]);
};
