import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/desktop/src/**/*.test.ts', 'tests/evidence/**/*.test.ts', 'scripts/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
  },
});
