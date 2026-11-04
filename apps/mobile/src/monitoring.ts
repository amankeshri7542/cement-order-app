import type { ComponentType } from 'react';

// Web build: crash reporting is native-only (see monitoring.native.ts), so the web bundle and
// its Content-Security-Policy stay unchanged.
type Root = ComponentType<Record<string, unknown>>;
export function withMonitoring(App: Root): Root {
  return App;
}
export function reportError(_error: unknown) {}
