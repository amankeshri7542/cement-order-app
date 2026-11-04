import path from 'node:path';
import type { NextConfig } from 'next';
const config: NextConfig = {
  devIndicators: false,
  distDir: process.env.NEXT_DIST_DIR || '.next',
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../..'),
  transpilePackages: ['@shiv/shared', '@shiv/design', '@shiv/i18n'],
  // Hosted demo only: serve the API on this origin, because the host's gateway answers CORS
  // preflights itself and never forwards them. Unset everywhere else.
  async rewrites() {
    const api = process.env.API_PROXY_ORIGIN;
    return api ? [{ source: '/api/v1/:path*', destination: `${api}/api/v1/:path*` }] : [];
  },
};
export default config;
