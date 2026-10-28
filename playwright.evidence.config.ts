import { defineConfig } from '@playwright/test';

// Evidence suites (screenshots, recordings, timings). Not part of `pnpm e2e`: run with
// `pnpm e2e:evidence` locally or via .github/workflows/macos-evidence.yml on macOS runners.
export default defineConfig({
  testDir: 'tests/evidence',
  testMatch: '**/*.evidence.ts',
  timeout: 180_000,
  // Whole-run cap below the workflow step limit (25 min) so a hang fails with a report. Worst case 1410 s, typical 884 s.
  globalTimeout: 1_440_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'evidence-results/report.json' }]],
  outputDir: 'evidence-results',
  use: { trace: 'retain-on-failure' },
});
