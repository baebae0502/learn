// @mockups — renders the M1 design mockups on the macOS runner so the owner can see them
// with the real system fonts (SF Pro + Apple SD Gothic Neo) and macOS font smoothing.
// Same manifest and render core as `pnpm mockups:render` on Linux. Wired into the
// macOS evidence lane (playwright.evidence.config.ts, M0) with `--grep @mockups`.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { ALL } from '../../scripts/mockups/manifest.mjs';
import { renderMockups } from '../../scripts/mockups/render.mjs';

test('@mockups design mockups render on macOS with system fonts', async ({}, testInfo) => {
  // Linux renders through `pnpm mockups:render`, which starts its own 2880×1800 xvfb; the
  // evidence harness's 1440×900 xvfb cannot hold a 1440×900 @2x window.
  test.skip(process.platform !== 'darwin', 'macOS only; Linux uses pnpm mockups:render');
  test.setTimeout(15 * 60_000);
  const base = process.env['EVIDENCE_DIR'] ?? testInfo.outputPath();
  const outDir = path.join(base, 'mockups');
  const results = await renderMockups({ renders: ALL, outDir });
  writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ platform: process.platform, results }, null, 2));
  expect(results).toHaveLength(ALL.length);
  // `?font=system` (default) must resolve to the Apple system fonts, not the bundled fallback.
  // Component boards have no tab or toolbar title to probe, so they report no fonts.
  const systemRenders = results.filter((r) => !r.name.includes('pretendard') && !r.name.startsWith('components--'));
  expect(systemRenders.length).toBeGreaterThan(50);
  for (const r of systemRenders) {
    expect(r.fonts.join(' '), r.name).toMatch(/SF|Apple SD Gothic Neo|System Font/i);
  }
});
