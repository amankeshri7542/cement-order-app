import { defineConfig } from '@playwright/test';

// Review screenshots (Phase 11 before/after). Not part of CI or the QA suites: it starts its own
// servers on 4020 / 3021 / 3022 / 8090 against SHOTS_DATABASE_URL, a loopback database ending in
// _test that scripts/shots/prepare.mjs filled (the demo catalogue, or an empty new store).
//   SHOTS_DATABASE_URL=… SHOTS_SET=demo|empty SHOTS_DIR=docs/screenshots/p11/before \
//     npx playwright test --config=playwright.shots.config.ts
const database = process.env.SHOTS_DATABASE_URL;
if (
  !database ||
  !new URL(database).pathname.endsWith('_test') ||
  !['localhost', '127.0.0.1', '[::1]'].includes(new URL(database).hostname)
)
  throw new Error('Screenshots require a loopback SHOTS_DATABASE_URL ending in _test.');

const api = 'http://localhost:4020/api/v1';
export default defineConfig({
  testDir: './scripts/shots',
  testMatch: /.*\.shots\.ts$/,
  fullyParallel: false,
  workers: 1,
  timeout: 180000,
  expect: { timeout: 20000 },
  reporter: [['list']],
  use: { browserName: 'chromium', channel: 'chrome' },
  webServer: [
    {
      command: 'npm exec -w @shiv/api -- tsx --env-file=.env scripts/e2e-api.ts',
      url: `${api}/health`,
      timeout: 120000,
      env: {
        DATABASE_URL: database,
        NODE_ENV: 'test',
        PORT: '4020',
        OTP_PROVIDER: 'mock',
        OTP_HASH_SECRET: 'screenshots-only-secret-at-least-32-characters',
        CORS_ORIGINS: 'http://localhost:3021,http://localhost:3022,http://localhost:8090',
        R2_PUBLIC_URL: 'https://assets.example.invalid',
      },
    },
    {
      command: 'npm exec -w @shiv/admin -- next dev --port 3021',
      url: 'http://localhost:3021',
      timeout: 120000,
      env: {
        NEXT_PUBLIC_API_URL: api,
        NEXT_DIST_DIR: '.next-shots',
        NEXT_PUBLIC_ASSET_ORIGIN: 'https://assets.example.invalid',
      },
    },
    {
      command: 'npm exec -w @shiv/storefront -- next dev --port 3022 --hostname 127.0.0.1',
      url: 'http://localhost:3022',
      timeout: 120000,
      env: {
        NEXT_PUBLIC_API_URL: api,
        NEXT_DIST_DIR: '.next-shots',
        NEXT_PUBLIC_ASSET_ORIGIN: 'https://assets.example.invalid',
      },
    },
    {
      command: 'npm run web -w @shiv/mobile -- --port 8090 --clear',
      url: 'http://localhost:8090',
      timeout: 180000,
      env: {
        EXPO_PUBLIC_API_URL: api,
        EXPO_PUBLIC_ASSET_ORIGIN: 'https://assets.example.invalid',
        CI: '1',
      },
    },
  ],
});
