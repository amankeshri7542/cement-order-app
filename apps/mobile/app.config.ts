import type { ExpoConfig, ConfigContext } from 'expo/config';
export default ({ config }: ConfigContext): ExpoConfig => {
  const environment = process.env.EXPO_PUBLIC_APP_ENV || 'development';
  if (!['development', 'staging', 'production'].includes(environment))
    throw new Error('EXPO_PUBLIC_APP_ENV must be development, staging or production.');
  // Release profiles use EAS environments; refuse sample URLs before a binary is built.
  if (environment !== 'development') {
    if (process.env.APP_VARIANT === 'local')
      throw new Error('APP_VARIANT=local is only allowed for development builds.');
    for (const key of ['EXPO_PUBLIC_API_URL', 'EXPO_PUBLIC_PRIVACY_URL']) {
      let url: URL;
      try {
        url = new URL(process.env[key] || '');
      } catch {
        throw new Error(`${key} must be a configured HTTPS URL for ${environment} builds.`);
      }
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.port ||
        !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(url.hostname) ||
        /(^|\.)(localhost|invalid|test|example)$|(^|\.)example\.(com|net|org)$/.test(
          url.hostname,
        ) ||
        (key === 'EXPO_PUBLIC_API_URL' && url.pathname !== '/api/v1')
      )
        throw new Error(
          `${key} must use a real HTTPS host${key === 'EXPO_PUBLIC_API_URL' ? ' and /api/v1' : ''}.`,
        );
    }
  }
  return {
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
  };
};
