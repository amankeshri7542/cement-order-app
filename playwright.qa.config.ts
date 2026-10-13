import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Run each engine in a separate invocation: global setup resets the shared disposable DB.
export default defineConfig({
  ...base,
  use: { ...base.use, channel: undefined },
  projects: [
    { name: 'chrome', use: { browserName: 'chromium', channel: 'chrome' } },
    { name: 'firefox', use: { browserName: 'firefox', channel: undefined } },
    { name: 'webkit', use: { browserName: 'webkit', channel: undefined } },
  ],
});
