import * as Sentry from '@sentry/react-native';
import type { ComponentType } from 'react';

// Crash and error reports for the Android/iOS app. Without EXPO_PUBLIC_SENTRY_DSN nothing is
// initialised and nothing leaves the phone. No personal data: no IP address, no request bodies.
const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
if (dsn)
  Sentry.init({
    dsn,
    environment: process.env.EXPO_PUBLIC_APP_ENV || 'development',
    sendDefaultPii: false,
    tracesSampleRate: 0.1,
  });

type Root = ComponentType<Record<string, unknown>>;
export function withMonitoring(App: Root): Root {
  return dsn ? Sentry.wrap(App) : App;
}
export function reportError(error: unknown) {
  if (dsn) Sentry.captureException(error);
}
