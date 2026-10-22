// @perf — cold start (process start → app-ready) and renderer bundle size (ADR-0004: "recorded in M3"). Budget 1.5 s
// on the reference Mac (quality spec); runner values are reported only. Linux CI fails only beyond 2× the budget.
// Also the time from the menu command to the ⌘/ sheet or the settings window on screen (T13M-n4), reported only.
//
// Marks (epoch ms, main/perf.ts): processStart (performance.timeOrigin of the main process), ready (app 'ready'),
// firstPaint (the main window's first 'ready-to-show': its page has painted, the window code shows it then),
// windowShown (its first 'show'), and the renderer's app-ready data-at (the first render with a settled list, R-18).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { ROOT, closeSheet, expectWindow, launch } from '../e2e/helpers';
import { writeJson } from './capture';

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

test('opening the ⌘/ sheet and the settings window: menu command → window shown, 5 times each', { tag: '@perf' }, async ({}, testInfo) => {
  test.setTimeout(120_000);
  const s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    // t0 when the menu item is clicked in main, shown at the window's 'show' (both main-process clocks).
    await s.app.evaluate(({ app }) => {
      const g = globalThis as { __learnOpen?: { t0: number; shown?: number } };
      app.on('browser-window-created', (_event, win) => {
        win.once('show', () => {
          if (g.__learnOpen && g.__learnOpen.shown === undefined) g.__learnOpen.shown = Date.now();
        });
      });
    });
    const click = (id: string) =>
      s.app.evaluate(({ BrowserWindow, Menu }, id) => {
        (globalThis as { __learnOpen?: { t0: number } }).__learnOpen = { t0: Date.now() };
        Menu.getApplicationMenu()!.getMenuItemById(id)!.click(undefined, BrowserWindow.getFocusedWindow() ?? undefined);
      }, id);
    const elapsed = async () => {
      await expect.poll(() => s.app.evaluate(() => (globalThis as { __learnOpen?: { shown?: number } }).__learnOpen?.shown ?? 0)).toBeGreaterThan(0);
      return s.app.evaluate(() => {
        const o = (globalThis as { __learnOpen?: { t0: number; shown?: number } }).__learnOpen!;
        return o.shown! - o.t0;
      });
    };
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
      // The first open of each is the first such window of the session; the target is the median.
      targetMs: 250,
      platform: `${process.platform}-${process.arch}`,
      ci: process.env['CI'] ?? null,
    };
    writeJson('open-latency.json', result, 'M3 menu command → ⌘/ sheet or settings window on screen (T13M-n4)');
    console.log('[measure] open latency', JSON.stringify(result.runsMs), JSON.stringify(result.medianMs));
  } finally {
    await s.app.close();
  }
});
