import type { ConfigContext, ExpoConfig } from 'expo/config';

const environments = ['development', 'staging', 'production'];
/** Build switches that open a back door for testing. Never allowed outside a local build. */
const testSwitches = ['EXPO_PUBLIC_STAFF_PASTE', 'EXPO_PUBLIC_STAFF_TEST'];

export default ({ config }: ConfigContext): ExpoConfig => {
  const environment = process.env.EXPO_PUBLIC_APP_ENV || 'development';
  if (!environments.includes(environment))
    throw new Error('EXPO_PUBLIC_APP_ENV must be development, staging or production.');
  const local = process.env.APP_VARIANT === 'local';
  if (environment !== 'development') {
    if (local) throw new Error('APP_VARIANT=local is only allowed for development builds.');
    for (const name of testSwitches)
      if (process.env[name]) throw new Error(`${name} is only allowed for development builds.`);
    let url: URL;
    try {
      url = new URL(process.env.EXPO_PUBLIC_API_URL || '');
    } catch {
      throw new Error(`EXPO_PUBLIC_API_URL must be a configured HTTPS URL for ${environment}.`);
    }
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.port ||
      url.pathname !== '/api/v1' ||
      /(^|\.)(localhost|invalid|test|example)$|(^|\.)example\.(com|net|org)$/.test(url.hostname) ||
      /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)
    )
      throw new Error('EXPO_PUBLIC_API_URL must use a real HTTPS host and /api/v1.');
  }
  // A release build must not ask for what only a local one may use.
  if (!local && process.env.EXPO_PUBLIC_STAFF_PASTE)
    throw new Error('EXPO_PUBLIC_STAFF_PASTE needs APP_VARIANT=local.');
  return {
    ...config,
    name: 'Shiv Staff',
    slug: 'shiv-staff',
    extra: { ...config.extra, appEnv: environment },
    plugins: [
      ...(config.plugins ?? []),
      // Hanken Grotesk Medium is the only face and weight. Embedded at build time, so it draws on
      // the first frame; resolved here because npm workspaces hoist the package to the root.
      [
        'expo-font',
        {
          fonts: [
            require.resolve('@expo-google-fonts/hanken-grotesk/500Medium/HankenGrotesk_500Medium.ttf'),
          ],
        },
      ] as [string, unknown],
      // Local QA release builds reach the laptop's HTTP API over adb reverse; never production.
      ...(local ? ['./plugins/local-cleartext'] : []),
    ],
  };
};
