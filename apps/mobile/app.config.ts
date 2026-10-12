import type { ExpoConfig, ConfigContext } from 'expo/config';
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Shiv Cement Store',
  slug: 'shiv-cement-store',
  // Local QA release builds reach the laptop's HTTP API over adb reverse; never production.
  plugins: [
    ...(config.plugins ?? []),
    ...(process.env.APP_VARIANT === 'local' ? ['./plugins/local-cleartext'] : []),
    // Uploads source maps so crash reports show real file and line numbers. Only release builds
    // with Sentry credentials (EAS/CI) load it; local builds need no Sentry account.
    ...(process.env.SENTRY_AUTH_TOKEN
      ? [
          [
            '@sentry/react-native/expo',
            { organization: process.env.SENTRY_ORG, project: process.env.SENTRY_PROJECT },
          ] as [string, unknown],
        ]
      : []),
  ],
  android: {
    ...config.android,
    ...(process.env.GOOGLE_SERVICES_JSON
      ? { googleServicesFile: process.env.GOOGLE_SERVICES_JSON }
      : {}),
  },
});
