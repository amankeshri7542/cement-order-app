// Where the public site lives and whether search engines may index it. Both are server settings,
// not NEXT_PUBLIC_* values, which would be compiled into public JavaScript.
export const siteName = 'Shiv Cement Store';
/** The short name in the header, footer and app (decision 52). The full name stays on legal text. */
export const shortName = 'Shiv Cement';

/**
 * Search engines stay out until the owner sets SITE_INDEXING=on on a real https address, so a
 * staging copy or a preview can never end up in a search result.
 */
export function siteConfig(env: Record<string, string | undefined>) {
  const siteUrl = (env.SITE_URL || 'http://localhost:3003').replace(/\/+$/, '');
  return { siteUrl, indexingOn: env.SITE_INDEXING === 'on' && siteUrl.startsWith('https://') };
}
export const { siteUrl, indexingOn } = siteConfig(process.env);
export const pageUrl = (path: string) => `${siteUrl}${path}`;
