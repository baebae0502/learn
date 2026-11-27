import { defineConfig } from '@playwright/test';

// Evidence suites (screenshots, recordings, timings). Not part of `pnpm e2e`: run with
// `pnpm e2e:evidence` locally or via .github/workflows/macos-evidence.yml on macOS runners.
export default defineConfig({
  testDir: 'tests/evidence',
  testMatch: '**/*.evidence.ts',
  timeout: 180_000,
  // Whole-run cap below the workflow step limit (41 min since M8a) so a hang fails with a report. M5's worst case was 1548 s (typical
  // 805 s, tests/evidence/demo.evidence.ts DEMO_BUDGET_MS); M6's p1 and p1-perf suites add at most 333 s on a Mac runner
  // (m6-t10b job 131 s, m6-t11-perf job 202 s, setup included), times 1.5: 2048 s, kept at the planned 2160 s.
  // M8a: the Linux suite grew from 14.5 to 17.6 min (video-perf, m8a-shots); the step limit is 41 min (macos-evidence.yml), so 2400 s.
  globalTimeout: 2_400_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'evidence-results/report.json' }]],
  outputDir: 'evidence-results',
  use: { trace: 'retain-on-failure' },
});
