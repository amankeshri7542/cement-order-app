import { defineConfig } from 'vitest/config';

// Kit component tests (plan v4 B3a) run in jsdom; the real-browser checks (both themes, every
// size, 10,000 rows) are in tests/desk-kit.spec.ts.
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/kit/test-setup.ts'],
    css: { modules: { classNameStrategy: 'non-scoped' } },
  },
});
