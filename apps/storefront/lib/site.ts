// Where the public site lives and whether search engines may index it. Both are server settings,
// not NEXT_PUBLIC_* values, which would be compiled into public JavaScript.
export const siteName = 'Shiv Cement Store';
/** Set by proxy.ts when the address asks for a language (?lang=hi), so a link can choose it. */
export const languageHeader = 'x-shiv-lang';

/**
 * Search engines stay out until the owner sets SITE_INDEXING=on on a real https address, so a
 * staging copy or a preview can never end up in a search result.
 */
export function siteConfig(env: Record<string, string | undefined>) {
  // On Vercel the production address is known even before SITE_URL is set, so canonical links and
  // structured data never point at localhost there.
  const siteUrl = (
    env.SITE_URL ||
    (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : '') ||
    'http://localhost:3003'
  ).replace(/\/+$/, '');
  return { siteUrl, indexingOn: env.SITE_INDEXING === 'on' && siteUrl.startsWith('https://') };
}
export const { siteUrl, indexingOn } = siteConfig(process.env);
export const pageUrl = (path: string) => `${siteUrl}${path}`;
