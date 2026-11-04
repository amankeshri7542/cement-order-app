import type { MetadataRoute } from 'next';
import { indexingOn, siteUrl } from '../lib/site';

export default function robots(): MetadataRoute.Robots {
  if (!indexingOn) return { rules: { userAgent: '*', disallow: '/' } };
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // Personal pages and the account-deletion form are never useful in a search result.
      disallow: ['/account', '/cart', '/checkout', '/orders', '/quotes', '/delete-account'],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
