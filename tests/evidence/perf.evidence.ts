// @perf — cold start (process start → app-ready) and renderer bundle size (ADR-0004: "recorded in M3"). Budget 1.5 s
// on the reference Mac (quality spec); runner values are reported only. Linux CI fails only beyond 2× the budget.
// Also the time from the menu command to the ⌘/ sheet or the settings window on screen (T13M-n4): reported, and on
// Linux CI failing only beyond 2× its 250 ms target; and the order of a theme switch (T13R4-m1), reported only.
//
// Marks (epoch ms, main/perf.ts): processStart (performance.timeOrigin of the main process), ready (app 'ready'),
// firstPaint (the main window's first 'ready-to-show': its page has painted, the window code shows it then),
// windowShown (its first 'show'), and the renderer's app-ready data-at (the first render with a settled list, R-18).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { ROOT, closeSheet, expectWindow, launch, runMenuCommand } from '../e2e/helpers';
import { writeJson } from './capture';
import { coldFirstOpens, openTimer } from './open-latency';

interface Marks {
  processStart: number;
  ready: number;
  firstPaint: number;
  windowShown: number;
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const LAUNCHES = 5;
const BUDGET_MS = 1500;

test('cold start to app-ready, 5 launches, and the renderer bundle', { tag: '@perf' }, async () => {
  test.setTimeout(180_000);
  const runs: Array<Record<'wallIncludingPlaywright' | 'mainReady' | 'firstPaint' | 'windowShown' | 'appReady', number>> = [];
  for (let i = 0; i < LAUNCHES; i++) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-perf-'));
    try {
      const t0 = Date.now();
      const s = await launch(path.join(tmp, 'library'), path.join(tmp, 'userdata'));
      const wall = Date.now() - t0;
      try {
        const appReadyAt = Number(await s.page.getByTestId('app-ready').getAttribute('data-at'));
        const m = await s.app.evaluate(() => (globalThis as { __learnPerf?: Marks }).__learnPerf!);
        expect(m.ready * m.firstPaint * m.windowShown * appReadyAt, `every mark was reached: ${JSON.stringify({ ...m, appReadyAt })}`).toBeGreaterThan(0);
        runs.push({
          wallIncludingPlaywright: wall,
          mainReady: m.ready - m.processStart,
          firstPaint: m.firstPaint - m.processStart,
          windowShown: m.windowShown - m.processStart,
          appReady: appReadyAt - m.processStart,
        });
      } finally {
        await s.app.close();
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
  const assets = path.join(ROOT, 'apps/desktop/out/renderer/assets');
  const files = fs.readdirSync(assets).map((f) => ({ file: f, bytes: fs.statSync(path.join(assets, f)).size }));
  const sum = (re: RegExp) => files.filter((x) => re.test(x.file)).reduce((n, x) => n + x.bytes, 0);
  const of = (key: keyof (typeof runs)[number]) => median(runs.map((r) => r[key]));
  const result = {
    runs,
    medianMs: { appReady: of('appReady'), windowShown: of('windowShown'), firstPaint: of('firstPaint'), mainReady: of('mainReady'), wallIncludingPlaywright: of('wallIncludingPlaywright') },
    budgetMs: { coldStartToAppReady: BUDGET_MS, linuxCiLimit: 2 * BUDGET_MS },
    // The renderer as built (apps/desktop/out/renderer/assets): the app bundle, the PDF.js worker (loaded with the
    // first PDF), styles and the bundled Pretendard.
    bundleBytes: { js: sum(/\.js$/), pdfWorker: sum(/\.mjs$/), css: sum(/\.css$/), fonts: sum(/\.(woff2?|ttf|otf)$/) },
    bundleFiles: files,
    platform: `${process.platform}-${process.arch}`,
    ci: process.env['CI'] ?? null,
  };
  writeJson('perf.json', result, 'M3 cold start (process start → app-ready) and renderer bundle size');
  console.log('[measure] perf', JSON.stringify(result.medianMs), JSON.stringify(result.bundleBytes));
  if (process.platform === 'linux' && process.env['CI']) expect(result.medianMs.appReady).toBeLessThan(2 * BUDGET_MS);
});

const OPENS = 5;
/** Fresh app sessions per kind for the cold first open (critique mac2 m3). */
const COLD_SESSIONS = 3;

test('opening the ⌘/ sheet and the settings window: menu command → window shown, cold (a new session) and 5 times each', { tag: '@perf' }, async ({}, testInfo) => {
  test.setTimeout(240_000);
  const cold = await coldFirstOpens(testInfo.outputPath('cold'), COLD_SESSIONS);
  const s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const { click, elapsed } = await openTimer(s.app);
    const sheetMs: number[] = [];
    const settingsMs: number[] = [];
    for (let i = 0; i < OPENS; i++) {
      const sheet = await expectWindow(s.app, 'sheet', () => click('app.shortcuts'));
      sheetMs.push(await elapsed());
      await closeSheet(sheet, 'Escape');
      await s.page.waitForTimeout(300);
    }
    for (let i = 0; i < OPENS; i++) {
      const settings = await expectWindow(s.app, 'settings', () => click('app.settings'));
      settingsMs.push(await elapsed());
      await settings.close();
      await s.page.waitForTimeout(300);
    }
    const result = {
      runsMs: { sheet: sheetMs, settings: settingsMs },
      medianMs: { sheet: median(sheetMs), settings: median(settingsMs) },
      // The first open in a new session (report, not tune: checklist 7.1).
      coldFirstMs: { runs: cold, median: { sheet: median(cold.sheet), settings: median(cold.settings) } },
      // The first open of each is the first such window of the session; the target is the median.
      targetMs: 250,
      platform: `${process.platform}-${process.arch}`,
      ci: process.env['CI'] ?? null,
    };
    writeJson('open-latency.json', result, 'M3 menu command → ⌘/ sheet or settings window on screen (T13M-n4)');
    console.log('[measure] open latency', JSON.stringify(result.runsMs), JSON.stringify(result.medianMs), 'cold', JSON.stringify(result.coldFirstMs));
    // The plan's CI rule (re-review minor 3): runner values are reported; Linux CI fails only beyond 2× the target.
    if (process.platform === 'linux' && process.env['CI']) {
      expect(result.medianMs.sheet, 'the ⌘/ sheet: median open, ms').toBeLessThanOrEqual(2 * result.targetMs);
      expect(result.medianMs.settings, 'the settings window: median open, ms').toBeLessThanOrEqual(2 * result.targetMs);
    }
  } finally {
    await s.app.close();
  }
});

interface ThemeLogEntry {
  event: 'requested' | 'shown' | 'chrome' | 'source' | 'updated';
  window?: 'main' | 'settings' | null;
  reason?: string;
  theme?: string;
  at: number;
}

// T13R4-m1: a theme picked in the settings window. The pages lead (each says when it shows the change: after the next
// frame), each window's chrome follows its page, the app-wide native theme
// follows both, and nativeTheme's 'updated' comes last. Times from the click, per window; reported only.
test('theme switch order: click → each page shows it → its chrome → the native theme → nativeTheme updated', { tag: '@perf' }, async ({}, testInfo) => {
  test.setTimeout(120_000);
  const s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'), { colorScheme: null });
  try {
    const settings = await expectWindow(s.app, 'settings', () => runMenuCommand(s.app, 'app.settings'));
    await expect.poll(() => s.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.webContents.getURL().includes('window=settings') && w.isVisible()))).toBe(true);
    const switches: Array<Record<string, unknown>> = [];
    for (const theme of ['dark', 'light', 'dark'] as const) {
      await s.app.evaluate(() => void ((globalThis as { __learnThemeLog?: unknown[] }).__learnThemeLog = []));
      // The click, on the page's clock (epoch ms, as main's).
      const clickAt = await settings.evaluate((t) => {
        const at = performance.timeOrigin + performance.now();
        document.querySelector<HTMLElement>(`[data-testid="theme-tile-${t}"]`)!.click();
        return at;
      }, theme);
      await expect.poll(() => s.app.evaluate(() => ((globalThis as { __learnThemeLog?: ThemeLogEntry[] }).__learnThemeLog ?? []).some((e) => e.event === 'updated'))).toBe(true);
      await settings.waitForTimeout(400);
      const log = await s.app.evaluate(() => (globalThis as { __learnThemeLog?: ThemeLogEntry[] }).__learnThemeLog ?? []);
      const ms = (pick: (e: ThemeLogEntry) => boolean) => {
        const e = log.find(pick);
        return e ? Math.round(e.at - clickAt) : null;
      };
      switches.push({
        to: theme,
        msFromClick: {
          requested: ms((e) => e.event === 'requested'),
          shown: { settings: ms((e) => e.event === 'shown' && e.window === 'settings'), main: ms((e) => e.event === 'shown' && e.window === 'main') },
          chrome: { settings: ms((e) => e.event === 'chrome' && e.window === 'settings'), main: ms((e) => e.event === 'chrome' && e.window === 'main') },
          nativeApplied: ms((e) => e.event === 'source'),
          nativeThemeUpdated: ms((e) => e.event === 'updated'),
        },
        nativeAppliedBecause: log.find((e) => e.event === 'source')?.reason ?? null,
        log: log.map((e) => ({ ...e, at: Math.round(e.at - clickAt) })),
      });
    }
    const result = {
      switches,
      followMs: 250,
      platform: `${process.platform}-${process.arch}`,
      ci: process.env['CI'] ?? null,
    };
    writeJson('theme-switch.json', result, 'M3 theme switch: click → each page shows it → its chrome → native theme → nativeTheme updated (T13R4-m1)');
    console.log('[measure] theme switch', JSON.stringify(switches.map((w) => ({ to: w['to'], ...(w['msFromClick'] as object), because: w['nativeAppliedBecause'] }))));
  } finally {
    await s.app.close();
  }
});
