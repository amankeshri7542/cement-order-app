// Fail fast at server start instead of returning 500 on every request when a production build
// points at a non-HTTPS API or asset origin (proxy.ts enforces the same rule per request).
export function register() {
  if (process.env.NODE_ENV !== 'production') return;
  const origins = {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_ASSET_ORIGIN: process.env.NEXT_PUBLIC_ASSET_ORIGIN,
  };
  for (const [name, value] of Object.entries(origins)) {
    if (!value && name === 'NEXT_PUBLIC_ASSET_ORIGIN') continue;
    let url: URL | null = null;
    try {
      url = new URL(value || '');
    } catch {
      /* reported below */
    }
    if (!url || url.protocol !== 'https:' || url.username || url.password) {
      console.error(
        JSON.stringify({
          event: 'FRONTEND_STARTUP_FAILED',
          reason: `${name} must be an HTTPS URL without credentials in production builds.`,
        }),
      );
      // Exit so the host reports a failed deploy instead of a listening server that only errors.
      if (process.env.NEXT_RUNTIME === 'nodejs') process.exit(1);
      throw new Error(`${name} must be an HTTPS URL in production builds.`);
    }
  }
}
