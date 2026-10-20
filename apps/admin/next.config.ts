import path from 'node:path';
import type { NextConfig } from 'next';
const config: NextConfig = {
  devIndicators: false,
  distDir: process.env.NEXT_DIST_DIR || '.next',
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../..'),
  transpilePackages: ['@shiv/shared', '@shiv/design', '@shiv/i18n'],
};
export default config;
