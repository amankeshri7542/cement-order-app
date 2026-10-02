import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
if (existsSync('apps/api/.env.test')) loadEnvFile('apps/api/.env.test');
const database = process.env.TEST_DATABASE_URL;
if (!database || !new URL(database).pathname.endsWith('_test'))
  throw new Error('Browser tests require TEST_DATABASE_URL ending in _test.');
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
      command: 'npm run dev:api',
      url: 'http://localhost:4010/api/v1/health',
      timeout: 120000,
      env: {
        DATABASE_URL: database,
        NODE_ENV: 'test',
        PORT: '4010',
        OTP_PROVIDER: 'mock',
        OTP_HASH_SECRET: 'browser-tests-only-secret-at-least-32-characters',
        CORS_ORIGINS: 'http://localhost:3001,http://localhost:8082',
      },
    },
    {
      command: 'npm exec -w @shiv/admin -- next dev --port 3001',
      url: 'http://localhost:3001',
      timeout: 120000,
      env: { NEXT_PUBLIC_API_URL: 'http://localhost:4010/api/v1', NEXT_DIST_DIR: '.next-e2e' },
    },
    {
      command: 'npm exec -w @shiv/mobile -- expo start --web --port 8082',
      url: 'http://localhost:8082',
      timeout: 120000,
      env: { EXPO_PUBLIC_API_URL: 'http://localhost:4010/api/v1', CI: '1' },
    },
  ],
});
