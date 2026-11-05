// Release builds block plain HTTP, which is right for production (the API is HTTPS).
// A local QA build (APP_VARIANT=local) talks to http://localhost:4000 through `adb reverse`,
// so this plugin allows cleartext for loopback hosts only. Any other host stays HTTPS-only.
// Expo loads config plugins with require(), so this file stays CommonJS.
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require('expo/config-plugins');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const xml = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false" />
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">localhost</domain>
    <domain includeSubdomains="false">127.0.0.1</domain>
  </domain-config>
</network-security-config>
`;

/** @type {import('expo/config-plugins').ConfigPlugin} */
const withLocalCleartext = (config) => {
  config = withDangerousMod(config, [
    'android',
    (modConfig) => {
      const dir = join(modConfig.modRequest.platformProjectRoot, 'app/src/main/res/xml');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'network_security_config.xml'), xml);
      return modConfig;
    },
  ]);
  return withAndroidManifest(config, (modConfig) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(modConfig.modResults);
    app.$['android:networkSecurityConfig'] = '@xml/network_security_config';
    return modConfig;
  });
};
module.exports = withLocalCleartext;
