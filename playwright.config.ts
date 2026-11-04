import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
if (existsSync('apps/api/.env.test')) loadEnvFile('apps/api/.env.test');
const database = process.env.TEST_DATABASE_URL;
if (
  !database ||
  !new URL(database).pathname.endsWith('_test') ||
  !['localhost', '127.0.0.1', '[::1]'].includes(new URL(database).hostname)
)
  throw new Error('Browser tests require a loopback TEST_DATABASE_URL ending in _test.');
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 15000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: './tests/setup.ts',
  use: {
    browserName: 'chromium',
    channel: 'chrome',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'npm exec -w @shiv/api -- tsx --env-file=.env scripts/e2e-api.ts',
      url: 'http://localhost:4010/api/v1/health',
      timeout: 120000,
      env: {
        DATABASE_URL: database,
        NODE_ENV: 'test',
        PORT: '4010',
        OTP_PROVIDER: 'mock',
        OTP_HASH_SECRET: 'browser-tests-only-secret-at-least-32-characters',
        CORS_ORIGINS: 'http://localhost:3001,http://localhost:8082,http://localhost:3004',
        R2_PUBLIC_URL: 'https://assets.example.invalid',
      },
    },
    {
      command: 'npm exec -w @shiv/admin -- next dev --port 3001',
      url: 'http://localhost:3001',
      timeout: 120000,
      env: {
        NEXT_PUBLIC_API_URL: 'http://localhost:4010/api/v1',
        NEXT_DIST_DIR: '.next-e2e',
        NEXT_PUBLIC_ASSET_ORIGIN: 'https://assets.example.invalid',
      },
    },
    {
      command: 'npm exec -w @shiv/storefront -- next dev --port 3004 --hostname 127.0.0.1',
      url: 'http://localhost:3004',
      timeout: 120000,
      env: {
        NEXT_PUBLIC_API_URL: 'http://localhost:4010/api/v1',
        NEXT_DIST_DIR: '.next-e2e',
        NEXT_PUBLIC_ASSET_ORIGIN: 'https://assets.example.invalid',
      },
    },
    {
      command: 'npm run web -w @shiv/mobile -- --port 8082',
      url: 'http://localhost:8082',
      timeout: 120000,
      env: {
        EXPO_PUBLIC_API_URL: 'http://localhost:4010/api/v1',
        EXPO_PUBLIC_ASSET_ORIGIN: 'https://assets.example.invalid',
        CI: '1',
      },
    },
  ],
});
