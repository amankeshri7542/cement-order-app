import type { ExpoConfig, ConfigContext } from 'expo/config';
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Shiv Cement Store',
  slug: 'shiv-cement-store',
  // Local QA release builds reach the laptop's HTTP API over adb reverse; never production.
  plugins: [
    ...(config.plugins ?? []),
    ...(process.env.APP_VARIANT === 'local' ? ['./plugins/local-cleartext'] : []),
  ],
  android: {
    ...config.android,
    ...(process.env.GOOGLE_SERVICES_JSON
      ? { googleServicesFile: process.env.GOOGLE_SERVICES_JSON }
      : {}),
  },
});
