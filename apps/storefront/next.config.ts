import path from 'node:path';
import type { NextConfig } from 'next';
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
  async redirects() {
    return legacyRedirects.map((redirect) => ({ ...redirect, permanent: true }));
  },
  // Hosted demo only: serve the API on this origin, because the host's gateway answers CORS
  // preflights itself and never forwards them. Unset everywhere else.
  async rewrites() {
    const api = process.env.API_PROXY_ORIGIN;
    return api ? [{ source: '/api/v1/:path*', destination: `${api}/api/v1/:path*` }] : [];
  },
};
export default config;
