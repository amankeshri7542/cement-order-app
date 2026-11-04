/**
 * Addresses of the shop's previous website that should land on the new pages, so old links and old
 * search results keep working. Empty until the list of old addresses is known (docs/MANUAL_TASKS.md).
 * Add `{ source: '/old-page', destination: '/about' }`; both must be paths on this site.
 */
export const legacyRedirects: { source: string; destination: string }[] = [];
