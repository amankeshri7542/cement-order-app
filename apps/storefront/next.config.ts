import path from 'node:path';
import type { NextConfig } from 'next';
import { PHASE_PRODUCTION_BUILD } from 'next/constants';
import { legacyRedirects } from './lib/redirects';

const config: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../..'),
  transpilePackages: ['@shiv/shared'],
  // Every visitor, not only the crawlers on Next's built-in list, gets the page's title,
  // description and links in <head> from the first byte (search tools, link previews and audits
  // read <head>). Material pages already wait for the material, so nothing is held back extra.
  htmlLimitedBots: /.*/,
  devIndicators: false,
  // Fixed when the site is built, even when it is not set: without this a server could read it at
  // run time, and a stray setting on a customer server would show placeholders and guide drafts.
  env: { NEXT_PUBLIC_CONTENT_REVIEW: process.env.NEXT_PUBLIC_CONTENT_REVIEW ?? '' },
  async redirects() {
    return legacyRedirects.map((redirect) => ({ ...redirect, permanent: true }));
  },
  // Hosted demo only: serve the API on this origin, because the host's gateway answers CORS
  // preflights itself and never forwards them. Unset everywhere else.
  async rewrites() {
    const api = process.env.API_PROXY_ORIGIN;
    return api ? [{ source: '/api/v1/:path*', destination: `${api}/api/v1/:path*` }] : [];
  },
  // The shared package still holds the app's Hindi words. This website has one language, so the
  // build removes every string in that script from its bundles (scripts: check-web-budgets fails
  // if any reaches a chunk).
  webpack(webpack) {
    webpack.module.rules.push({
      test: /[\\/]packages[\\/](shared|i18n)[\\/].*\.(js|ts)$/,
      enforce: 'pre',
      use: [path.join(__dirname, 'lib/build/strip-devanagari.cjs')],
    });
    return webpack;
  },
};

// Each page loads only its own CSS, so the film's styles stay on the home page. Builds use webpack
// (see package.json); the development server's bundler has no such option.
export default function nextConfig(phase: string): NextConfig {
  if (phase !== PHASE_PRODUCTION_BUILD) return config;
  const review = process.env.NEXT_PUBLIC_CONTENT_REVIEW === 'on';
  // Placeholders and unsigned guide drafts are for private review, and an indexed site is for
  // customers, so no build can be both.
  if (review && process.env.SITE_INDEXING === 'on')
    throw new Error('NEXT_PUBLIC_CONTENT_REVIEW=on and SITE_INDEXING=on cannot be the same build.');
  return {
    ...config,
    experimental: { cssChunking: false },
    // The unsigned guide files are not copied into a customer build at all.
    ...(review ? {} : { outputFileTracingExcludes: { '*': ['../../content/advisor/**/*'] } }),
  };
}
