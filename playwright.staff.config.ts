import { defineConfig } from '@playwright/test';

// The Shiv Staff app on its Expo web build, against a real API and a real database. Its own database
// and ports, because the main browser suite may be running at the same time.
const database = `postgresql://shiv@127.0.0.1:${process.env.PGPORT_T ?? '55499'}/${process.env.STAFF_DB ?? 'shiv_staffapp_test'}`;
if (!new URL(database).pathname.endsWith('_test'))
  throw new Error('The staff app tests need a database ending in _test.');

export const staffE2E = {
  database,
  api: process.env.STAFF_API ?? 'http://localhost:4020/api/v1',
  web: 'http://localhost:8083',
  otpSecret: 'staff-app-browser-tests-only-secret-32-chars',
};

export default defineConfig({
  testDir: './apps/staff/e2e',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  reporter: [['list']],
  // Its own folder: Playwright empties this at the start of a run.
  outputDir: '.local/staff-e2e/results',
  use: {
    browserName: 'chromium',
    channel: 'chrome',
    baseURL: staffE2E.web,
    viewport: { width: 360, height: 640 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'npm exec -w @shiv/api -- tsx scripts/e2e-api.ts',
      url: `${staffE2E.api}/health`,
      timeout: 120000,
      reuseExistingServer: false,
      env: {
        DATABASE_URL: database,
        NODE_ENV: 'test',
        PORT: '4020',
        OTP_PROVIDER: 'mock',
        OTP_HASH_SECRET: staffE2E.otpSecret,
        CORS_ORIGINS: staffE2E.web,
        R2_PUBLIC_URL: 'https://assets.example.invalid',
      },
    },
    {
      command: 'node apps/staff/e2e/serve-web.mjs',
      url: staffE2E.web,
      timeout: 300000,
      reuseExistingServer: false,
      env: {
        EXPO_PUBLIC_API_URL: staffE2E.api,
        EXPO_PUBLIC_STAFF_TEST: '1',
        CI: '1',
      },
    },
  ],
});
