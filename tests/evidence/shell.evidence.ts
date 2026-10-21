// @evidence — M3 window chrome on macOS: traffic lights in the 52 px bar, sidebar vibrancy (light and dark, legible
// text on the measured material), active and inactive windows, hidden title bar, Korean menu bar with state labels and
// one 전체 화면, sheets, real accelerators and keys, tooltips, window state. Linux CI runs it with captures skipped.
//
// Every launch passes colorScheme: null, so the page follows the theme pref through nativeTheme as on a user's Mac
// (Playwright otherwise emulates a light page while the native material goes dark — Task 8 critique M1).
//
// Checks never stop the run: the tests share one session in serial mode, where any failed test (a soft assertion
// too) would skip every later one. So each check is recorded in m3-shell.json (`checks`) as it is measured, and the
// last test asserts them all with expect.soft. A check that throws is recorded with its error and the run goes on.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import {
  FIXTURES, KEY_CODE, NativeInputNotPermitted, bringAppToFront, closeSheet, expectDisabledReason, expectWindow, frontmostProcess, importFiles, importPaths,
  launch, mainWindow, menuItemEnabled, menuSnapshot, nativeKeyCode, nativeKeystroke, openItem, osascript, runMenuCommand, stubContextMenu, type LaunchOptions,
  type Session,
} from '../e2e/helpers';
import { composite, contrast, parseColor, type Rgba } from '../../apps/desktop/src/renderer/src/design/color';
import { colors, colorsVibrancySidebar, layout } from '../../apps/desktop/src/renderer/src/design/tokens';
import { themeHex } from '../../apps/desktop/src/renderer/src/design/tokens.generated';
import {
  EVIDENCE_ROOT, IS_MAC, allShots, captureOpenMenu, fullScreenShot, menuItemNames, nativeWindowShot, platformFonts, pngCentroid, pngPixels, tryExec,
  windowIdOf, windowShotById, writeJson,
} from './capture';
import { inkMass, regionStats } from './image-stats';
import { findMenuPanel, menuRows } from './menu-rows';
import { decodePng } from './png';

const TAG = { tag: '@evidence' };
const PDF = path.join(FIXTURES, 'sample.pdf');
const MP4 = path.join(FIXTURES, 'sample-h264-aac.mp4');
const MPEG4 = path.join(FIXTURES, 'sample-mpeg4part2.mp4');
const results: Record<string, unknown> = {};
/** Every check's verdict and the value it was judged on, in the order measured (asserted by the last test). */
const checks: Record<string, { ok: boolean; value: unknown }> = {};
const save = () => writeJson('m3-shell.json', { ...results, checks, platform: `${process.platform}-${process.arch}`, at: new Date().toISOString() }, 'M3 shell chrome measurements');

/** Record one check (judged later, never here). */
function check(name: string, ok: boolean, value: unknown): void {
  checks[name] = { ok, value };
}

const errorText = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message.split('\n')[0]}` : String(e));

/** Run a carried check; a throw becomes a failed check with the error (codes and messages only, never a path). */
async function guard(name: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (e) {
    check(name, false, { error: errorText(e), notPermitted: e instanceof NativeInputNotPermitted });
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Records main's windowState and nativeMenu pushes in the page (diagnostics for the window-state checks). */
async function recordPushes(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __pushes: Array<[string, boolean, number]> };
    w.__pushes = [];
    window.learn.on('windowState', (e) => w.__pushes.push(['windowState.focused', e.focused, Math.round(performance.now())]));
    window.learn.on('nativeMenu', (e) => w.__pushes.push(['nativeMenu.open', e.open, Math.round(performance.now())]));
  });
}
/** The window as the page and main see it now, plus the last pushes. */
const windowFacts = async () => ({
  inactiveAttr: await s.page.evaluate(() => document.documentElement.hasAttribute('data-window-inactive')),
  tooltipBlock: await s.page.evaluate(() => document.documentElement.dataset['tooltipBlock'] ?? null),
  mainFocused: await (await mainWindow(s.app)).evaluate((w) => w.isFocused()),
  pushes: (await s.page.evaluate(() => (window as unknown as { __pushes?: Array<[string, boolean, number]> }).__pushes ?? [])).slice(-8),
});

/** The page follows the theme pref (nativeTheme), as for a user: no Playwright colour-scheme emulation (M1). */
const UNEMULATED: LaunchOptions = { colorScheme: null };

type Theme = 'light' | 'dark';
/** Switch the theme pref and wait until the page itself is in that theme (not only the native material). */
async function setTheme(page: Page, theme: Theme): Promise<void> {
  await page.evaluate((t) => window.learn.prefs.set({ theme: t }), theme);
  await expect.poll(() => page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(theme === 'dark');
  await page.waitForTimeout(300); // the native material and the frame repaint
}

const rgbOf = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const delta = (a: readonly number[], b: readonly number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i]!)));
const rgba = ([r, g, b]: readonly number[]): Rgba => ({ r: r! / 255, g: g! / 255, b: b! / 255, a: 1, clamped: false });
const ratio = (fg: string, bg: Rgba) => Math.round(contrast(parseColor(fg), bg) * 100) / 100;

/** Sidebar text on a measured vibrancy material (design-spec 8.3; tokens.test.ts checks the same roles on #404040). */
function sidebarContrast(theme: Theme, material: readonly number[]) {
  const m = rgba(material);
  const selected = composite(parseColor(colors.fillSelected[theme]), m);
  return {
    material,
    primary: ratio(colors.textPrimary[theme], m),
    tertiary: ratio(colorsVibrancySidebar.textTertiary[theme], m),
    countSelected: ratio(colorsVibrancySidebar.sidebarCountSelected[theme], selected),
    tertiaryBaseToken: ratio(colors.textTertiary[theme], m), // what the opaque fallback token would give here
  };
}

/**
 * macOS: bring Finder to the front (the window becomes inactive), capture the main window without focusing it, read
 * the close button's colour and the current sidebar row's fill, then bring the app back.
 */
async function inactiveShot(name: string, description: string): Promise<Record<string, unknown>> {
  osascript('tell application "Finder" to activate');
  const t0 = Date.now();
  while (frontmostProcess().name !== 'Finder' && Date.now() - t0 < 5_000) await sleep(200);
  await expect(s.page.locator('html')).toHaveAttribute('data-window-inactive', '', { timeout: 5_000 });
  await sleep(500); // the material and the lights repaint as inactive
  const shot = await nativeWindowShot(s.app, name, description, { focus: false });
  const frontmostAtShot = frontmostProcess().name; // R2-5: read before the app comes back
  const closeButton = shot.file ? (await pngPixels(s.page, shot.file, [[25, 26]]))[0] ?? null : null;
  const navRow = await s.page.getByTestId('nav-library').evaluate((el) => getComputedStyle(el).backgroundColor);
  const chrome = await s.page.evaluate(() => {
    const css = (sel: string) => getComputedStyle(document.querySelector(sel)!);
    return { cursor: css('[data-testid="nav-library"]').boxShadow, title: css('[data-testid="toolbar-title"]').color, rowIcon: css('[data-testid="nav-library"] > .icon').color };
  });
  await bringAppToFront(s.app);
  await expect(s.page.locator('html')).not.toHaveAttribute('data-window-inactive', '', { timeout: 5_000 });
  return { frontmostAtShot, closeButton, navRow, chrome };
}
/**
 * Rows of an open 보기 menu counted from its click capture (Task 8 R2-1): the panel is found from a seed in its top
 * padding (from System Events' frame of the open menu when it gave one), and every text row below the first one is a
 * full-screen row (보기 holds the sidebar item, a separator and the full-screen item(s) in E2E builds).
 */
function openMenuRowCount(shot: string | null, frame: { x: number; y: number } | null) {
  if (!shot) return null;
  const img = decodePng(fs.readFileSync(path.join(EVIDENCE_ROOT, shot)));
  // The frame System Events reports belongs to the frontmost app's menu; when it is no panel (run 39640208719: another
  // app was in front), the fixed seed under the 보기 title is used.
  const fromFrame = frame && frame.x >= 0 && frame.y < img.height - 40 ? findMenuPanel(img, { x: frame.x + 6, y: frame.y + 5 }) : null;
  const panel = fromFrame && fromFrame.y1 - fromFrame.y0 > 20 ? fromFrame : findMenuPanel(img, { x: 206, y: 30 });
  const m = menuRows(img, panel);
  return { panel: m.panel, rows: m.rows.length, separators: m.separators.length, fullScreenRows: Math.max(0, m.rows.length - 1) };
}

/** Grey: no channel stands out (the active close button is red #ff5f57). */
const isGrey = (rgb: readonly number[] | null) => rgb !== null && Math.max(...rgb) - Math.min(...rgb) <= 24;
/** The main session's profile: every test here, including the restart in the last one, uses this one folder. */
let tmp = '';
let s: Session;
const windowWidth = async (app: ElectronApplication) => (await mainWindow(app)).evaluate((w) => w.getBounds().width);
const windowCount = (app: ElectronApplication) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
const padding = (page: Page) =>
  page.getByTestId('toolbar').evaluate((el) => ({ left: parseFloat(getComputedStyle(el).paddingLeft), right: parseFloat(getComputedStyle(el).paddingRight) }));

/**
 * Open an item from the list and time it inside the page (performance.now()): `blankMs` until the content column has
 * something again (ViewerHost draws nothing for one IPC round trip), `readyMs` until `ready` is visible.
 */
async function timedOpen(page: Page, title: string, ready: string): Promise<{ blankMs: number | null; readyMs: number | null }> {
  return page.evaluate(
    async ({ title, ready }) => {
      const content = document.querySelector('[data-testid="content"]')!;
      const button = document.querySelector<HTMLElement>(`[data-testid="open-item"][data-title="${CSS.escape(title)}"]`)!;
      const visible = (sel: string) => {
        const el = document.querySelector(sel);
        const r = el?.getBoundingClientRect();
        return Boolean(r && r.width > 0 && r.height > 0);
      };
      const t0 = performance.now();
      button.click();
      let sawBlank = false;
      let blankMs: number | null = null;
      while (performance.now() - t0 < 15_000) {
        await new Promise((r) => requestAnimationFrame(r));
        const now = performance.now() - t0;
        const empty = content.childElementCount === 0;
        if (empty) sawBlank = true;
        else if (blankMs === null && (sawBlank || !content.querySelector('[data-testid="library-table"]'))) blankMs = Math.round(now);
        if (visible(ready)) return { blankMs, readyMs: Math.round(now) };
      }
      return { blankMs, readyMs: null };
    },
    { title, ready },
  );
}

/**
 * Close a sheet with a real key on macOS (System Events `key code`, sent to the sheet window) and report what
 * happened; elsewhere (or when macOS refuses System Events) Playwright's key closes it so the run goes on.
 */
async function closeSheetNatively(sheet: Page, code: number, fallback: 'Escape' | 'Enter'): Promise<{ native: boolean; closed: boolean; ms: number | null; focusedBefore: string | null; note?: string }> {
  if (!IS_MAC) {
    await closeSheet(sheet, fallback);
    return { native: false, closed: true, ms: null, focusedBefore: null, note: 'not darwin: Playwright key' };
  }
  let closedAt: number | null = null;
  const closedEvent = new Promise<true>((resolve) =>
    sheet.once('close', () => {
      closedAt = Date.now();
      resolve(true);
    }),
  );
  let note: string | undefined;
  let focusedBefore: string | null = null;
  let sentAt: number | null = null;
  try {
    const key = await nativeKeyCode(s.app, code, [], { window: 'sheet' });
    focusedBefore = key.focusedWindow ?? null;
    sentAt = key.sentAt;
  } catch (e) {
    note = errorText(e);
  }
  // Up to 5 s from the key. Only a close after the key was sent counts (review minor 7): a sheet that closed before
  // (or without) the key did not answer it.
  if (sentAt !== null && !sheet.isClosed()) await Promise.race([closedEvent, sleep(5_000)]);
  const at = closedAt as number | null;
  const closed = sentAt !== null && at !== null && at >= sentAt;
  if (!sheet.isClosed()) await closeSheet(sheet, fallback); // the run goes on; the check fails
  return { native: note === undefined, closed, ms: closed ? at! - sentAt! : null, focusedBefore, ...(note ? { note } : at !== null && !closed ? { note: 'closed before the key was sent' } : {}) };
}

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-m3-'));
  s = await launch(path.join(tmp, 'library'), path.join(tmp, 'userdata'), UNEMULATED);
  await recordPushes(s.page);
});
test.afterAll(async () => {
  await s?.app.close().catch(() => {});
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

test('M3 chrome: empty library — traffic lights centred in the 52 px bar inside the 84 px inset', TAG, async () => {
  const [, win] = await allShots(s.app, s.page, 'm3-01-empty', 'empty library, layout B, light');
  results['fonts'] = await platformFonts(s.page, '[data-testid="toolbar-title"]');
  // macOS has no window controls overlay: the toolbar ends 12 from the window edge (Linux adds the controls' width).
  const pad = await padding(s.page);
  results['toolbar'] = pad;
  if (IS_MAC) check('toolbar right padding 12 (no overlay env on macOS)', pad.right === 12, pad);
  if (IS_MAC && win?.file) {
    const red = await pngCentroid(s.page, win.file, { x: 0, y: 0, w: 120, h: 60 }, 'red');
    const green = await pngCentroid(s.page, win.file, { x: 0, y: 0, w: 120, h: 60 }, 'green');
    const px = red ? red.width / (await windowWidth(s.app)) : 1;
    // Geometric centres (pixel i covers [i, i + 1)): run 39618864364 measured the close button at (25.0, 26.0).
    results['trafficLights'] = { red, green, devicePixelsPerPoint: px, expect: { redCentre: [25, 26], greenRightEdgeBelow: 84 } };
    check('close button found', red !== null, red);
    if (red) check('close button centred in the 52 px bar (y 26 ± 1.5)', Math.abs(red.y / px - 26) <= 1.5, { y: red.y / px, x: red.x / px });
    if (green) check('lights inside the 84 px inset', green.x / px + 6 < 84, { greenX: green.x / px });
  }
  // n6: which faces the app's real font stack gets at 500 / 590 / 600 / 700, and how much ink each draws.
  await guard('font weight probe (n6)', async () => {
    const SAMPLES = ['sample', '라이브러리'] as const;
    const WEIGHTS = [500, 590, 600, 700] as const;
    await s.page.evaluate(
      ({ samples, weights }) => {
        const box = document.createElement('div');
        box.id = 'weight-probe';
        box.style.cssText = 'position:fixed;left:280px;top:120px;z-index:99;padding:8px;background:var(--bg-content);color:var(--text-primary)';
        samples.forEach((text, i) => {
          const line = document.createElement('div');
          for (const w of weights) {
            const span = document.createElement('span');
            span.id = `weight-probe-${i}-${w}`;
            span.textContent = text;
            span.style.cssText = `display:inline-block;margin:0 16px 6px 0;font:${w} 15px/20px var(--font-ui)`;
            line.append(span);
          }
          box.append(line);
        });
        document.body.append(box);
      },
      { samples: [...SAMPLES], weights: [...WEIGHTS] },
    );
    await s.page.evaluate(() => document.fonts.ready);
    const probe: Record<string, { faces: string[]; ink: number }> = {};
    for (const [i, text] of SAMPLES.entries()) {
      for (const w of WEIGHTS) {
        const sel = `#weight-probe-${i}-${w}`;
        const fonts = await platformFonts(s.page, sel);
        const ink = inkMass(decodePng(await s.page.locator(sel).screenshot()));
        probe[`${text}@${w}`] = { faces: fonts.fonts.map((f) => `${f.postScriptName ?? f.familyName}×${f.glyphCount}`), ink };
      }
    }
    await s.page.evaluate(() => document.getElementById('weight-probe')?.remove());
    results['fontWeightProbe'] = probe;
  });
  save();
});

test('M3 chrome: library light/dark, active and inactive, and vibrancy on/off', TAG, async () => {
  await importPaths(s.page, [PDF, MP4, MPEG4]);
  await expect(s.page.getByTestId('item-row')).toHaveCount(3);
  // A keyboard user in the sidebar: the current row has the accent fill while the window is active.
  await s.page.getByTestId('nav-library').focus();
  await s.page.keyboard.press('ArrowDown');
  const navRow = () => s.page.getByTestId('nav-library').evaluate((el) => getComputedStyle(el).backgroundColor);
  const [, light] = await allShots(s.app, s.page, 'm3-02-library-light', 'library, light (sidebar list focused: accent selection)');
  const activeRow = await navRow();
  const inactive: Record<string, unknown> = {};
  if (IS_MAC) {
    await guard('inactive window: grey lights, neutral selection, no keyboard cursor (light)', async () => {
      inactive['light'] = await inactiveShot('m3-02b-library-light-inactive', 'library, light, window inactive (Finder in front)');
      const v = inactive['light'] as { closeButton: number[] | null; navRow: string; chrome: { cursor: string } };
      check('inactive window: grey lights, neutral selection, no keyboard cursor (light)', isGrey(v.closeButton) && v.navRow !== activeRow && v.chrome.cursor === 'none', { ...v, activeRow });
    });
  }

  await setTheme(s.page, 'dark');
  const [darkPage, dark] = await allShots(s.app, s.page, 'm3-03-library-dark', 'library, dark');
  // The page itself is dark (not a light page over a dark material, as runs 39617644850 / 39618864364 captured).
  if (darkPage?.file) {
    const [content] = await pngPixels(s.page, darkPage.file, [[700, 500]]);
    const v = { content, darkToken: rgbOf(themeHex.dark.bgContent), lightToken: rgbOf(themeHex.light.bgContent) };
    results['darkPage'] = v;
    check('the dark capture is a dark page (content = dark --bg-content)', delta(content!, v.darkToken) <= 2 && delta(content!, v.lightToken) > 2, v);
  }
  if (IS_MAC && light?.file && dark?.file) {
    // Sidebar text on the material the runner actually draws (an empty sidebar spot, below the list).
    const [lightMaterial] = await pngPixels(s.page, light.file, [[120, 500]]);
    const [darkMaterial] = await pngPixels(s.page, dark.file, [[120, 500]]);
    const v = { light: sidebarContrast('light', lightMaterial!), dark: sidebarContrast('dark', darkMaterial!) };
    results['sidebarContrast'] = v;
    for (const theme of ['light', 'dark'] as const) {
      const c = v[theme];
      check(`sidebar text on the measured ${theme} material (8.3)`, c.primary >= 4.5 && c.tertiary >= 3 && c.countSelected >= 4.5, c);
    }
    await guard('inactive window: grey lights, neutral selection, no keyboard cursor (dark)', async () => {
      inactive['dark'] = await inactiveShot('m3-03b-library-dark-inactive', 'library, dark, window inactive (Finder in front)');
      const v2 = inactive['dark'] as { closeButton: number[] | null; navRow: string; chrome: { cursor: string } };
      check('inactive window: grey lights, neutral selection, no keyboard cursor (dark)', isGrey(v2.closeButton) && v2.navRow !== (await navRow()) && v2.chrome.cursor === 'none', v2);
    });
    // R2-6b: a tooltip crossing the dark material (raised surface over the sidebar).
    await guard('tooltip over the dark material', async () => {
      // Keyboard focus opens it at once (a hover through Playwright opened none on the runner, run 39640208719).
      await s.page.getByTestId('nav-library').focus();
      await s.page.keyboard.press('Shift+Tab');
      await expect(s.page.getByRole('tooltip')).toHaveCount(1, { timeout: 3_000 }).catch(() => {});
      const shown = await s.page.getByRole('tooltip').count();
      await nativeWindowShot(s.app, 'm3-14-tooltip-dark', 'dark: the sidebar toggle tooltip over the material');
      results['tooltipDark'] = { shown };
      check('tooltip over the dark material is captured', shown === 1, results['tooltipDark']);
    });
  }
  results['inactive'] = { ...inactive, activeRowLight: activeRow };
  await setTheme(s.page, 'light');
  // Leave the sidebar and press the pointer (an empty spot of the content), as a mouse user would before the menu toggles
  // below (only a press counts as pointer input).
  await s.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await s.page.mouse.click(700, 600);

  if (IS_MAC && light?.file) {
    // A second, throwaway profile (R-5): `tmp` must keep pointing at the main session for the restart test below.
    // The main window is hidden meanwhile: both windows open at the same place, and Chromium stops drawing an occluded
    // window, whose capture is then the bare window background (run 39617644850: a blank opaque capture).
    const main = await mainWindow(s.app);
    await main.evaluate((w) => w.hide());
    const opaqueDir = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-m3-opaque-'));
    try {
      const opaque = await launch(path.join(opaqueDir, 'library'), path.join(opaqueDir, 'userdata'), { ...UNEMULATED, env: { LEARN_VIBRANCY: '0' } });
      try {
        await importPaths(opaque.page, [PDF, MP4, MPEG4]);
        await expect(opaque.page.getByTestId('item-row')).toHaveCount(3);
        await expect.poll(() => opaque.page.evaluate(() => document.visibilityState)).toBe('visible');
        await opaque.page.waitForTimeout(500);
        const shot = await nativeWindowShot(opaque.app, 'm3-02-library-light-opaque', 'library, light, LEARN_VIBRANCY=0');
        if (shot.file) {
          const points = [[120, 500], [700, 500]] as const; // sidebar, content (points; runner is 1x)
          const [withVib, without] = [await pngPixels(s.page, light.file, points), await pngPixels(s.page, shot.file, points)];
          const token = { sidebar: rgbOf(themeHex.light.bgSidebar), content: rgbOf(themeHex.light.bgContent) };
          const v = {
            sidebar: { vibrancy: withVib[0], opaque: without[0], token: token.sidebar },
            content: { vibrancy: withVib[1], opaque: without[1], token: token.content },
            sidebarDelta: delta(withVib[0]!, without[0]!),
            contentDelta: delta(withVib[1]!, without[1]!),
            // The opaque capture shows the page (its sidebar is the fallback token), not a bare window background.
            opaqueCaptureValid: delta(without[0]!, token.sidebar) <= 2 && delta(without[1]!, token.content) <= 2,
          };
          results['vibrancy'] = v;
          check('opaque comparison capture shows the page', v.opaqueCaptureValid, v);
          check('sidebar vibrancy visible (sidebarDelta > 2)', v.sidebarDelta > 2, v);
          check('content stays opaque under vibrancy (contentDelta ≤ 2)', v.contentDelta <= 2, v);
        }
      } finally {
        await opaque.app.close();
      }
    } finally {
      fs.rmSync(opaqueDir, { recursive: true, force: true });
      await main.evaluate((w) => w.show());
    }
  }
  save();
});

test('M3 chrome: collapsed sidebar, PDF, unplayable video, sheets (real ↩ and esc)', TAG, async () => {
  const tooltips = () => s.page.getByRole('tooltip').count();
  const afterToggles: number[] = [];
  await runMenuCommand(s.app, 'view.toggleSidebar');
  await expect(s.page.getByTestId('shell')).toHaveAttribute('data-sidebar', 'hidden');
  await s.page.waitForTimeout(300);
  afterToggles.push(await tooltips());
  await allShots(s.app, s.page, 'm3-04-collapsed', 'sidebar hidden: traffic lights over the toolbar, 84 px inset');
  const folded = await padding(s.page);
  results['collapsedToolbar'] = folded;
  check(`collapsed toolbar left padding ${IS_MAC ? 84 : 12}`, folded.left === (IS_MAC ? 84 : 12), folded);
  if (IS_MAC) {
    await setTheme(s.page, 'dark');
    await nativeWindowShot(s.app, 'm3-04b-collapsed-dark', 'sidebar hidden, dark');
    await setTheme(s.page, 'light');
  }
  await runMenuCommand(s.app, 'view.toggleSidebar');
  await expect(s.page.getByTestId('shell')).toHaveAttribute('data-sidebar', 'shown');
  await s.page.waitForTimeout(300);
  afterToggles.push(await tooltips());
  // m1: a menu toggle pops no tooltip on the toggle (the run before showed one through every later capture).
  results['tooltipsAfterMenuToggles'] = afterToggles;
  check('no tooltip after menu toggles of the sidebar', afterToggles.every((n) => n === 0), afterToggles);

  // f. Reader open latency (report only): from the click to the reader or notice, timed in the page.
  const latency: Record<string, unknown> = {};
  latency['pdf'] = await timedOpen(s.page, 'sample', '[data-testid="pdf-canvas"]');
  await expect(s.page.getByTestId('pdf-canvas')).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
  await allShots(s.app, s.page, 'm3-05-pdf', 'PDF in the new chrome');
  // n6: a Latin-only title at 600 — SF Semibold (as the Hangul beside it is SemiBold), not Bold?
  results['fontsLatinTitle'] = await platformFonts(s.page, '[data-testid="viewer-title"]');
  if (IS_MAC) {
    await setTheme(s.page, 'dark');
    await expect(s.page.getByTestId('pdf-canvas')).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
    await nativeWindowShot(s.app, 'm3-05b-pdf-dark', 'PDF, dark');
    await setTheme(s.page, 'light');
  }
  await runMenuCommand(s.app, 'nav.back');
  latency['unplayable'] = await timedOpen(s.page, 'sample-mpeg4part2', '[data-testid="video-error"]');
  await expect(s.page.getByTestId('video-error')).toBeVisible();
  await allShots(s.app, s.page, 'm3-06-codec', 'unplayable video notice');
  await runMenuCommand(s.app, 'nav.back');
  results['openLatencyMs'] = latency;
  save();

  // The sidebar list holds the keyboard focus, so its current row has the accent selection while the window is active.
  const navRow = s.page.getByTestId('nav-library');
  await navRow.focus();
  await s.page.keyboard.press('ArrowDown');
  const accentRow = await navRow.evaluate((el) => getComputedStyle(el).backgroundColor);
  /**
   * 38e3a9e: once a sheet has closed, the main window is active again within 500 ms (no data-window-inactive) and the
   * sidebar's current row is back to the accent selection. Measured from the sheet's close.
   */
  const activeAgain = async (which: string) => {
    const t0 = Date.now();
    let inactive = true;
    while (Date.now() - t0 < 2_000) {
      inactive = await s.page.evaluate(() => document.documentElement.hasAttribute('data-window-inactive'));
      if (!inactive) break;
      await sleep(25);
    }
    const ms = inactive ? null : Date.now() - t0;
    const row = await navRow.evaluate((el) => getComputedStyle(el).backgroundColor);
    const v = { ms, row, accentRow, ...(await windowFacts()) };
    check(`main window active again within 500 ms after the ${which} sheet, accent selection back (38e3a9e)`, ms !== null && ms <= 500 && row === accentRow, v);
    return v;
  };

  // b. Real ↩ on the duplicate sheet runs its default button, 건너뛰기: the sheet closes, nothing is added, the import ends.
  const rows = s.page.getByTestId('item-row');
  const dup = await expectWindow(s.app, 'sheet', () => importFiles(s, [PDF]));
  await s.page.waitForTimeout(800); // sheet slide-in
  await fullScreenShot('m3-07-sheet-duplicate', 'duplicate sheet (macOS centres it over the window and dims the parent)');
  await guard('real ↩ on the duplicate sheet skips', async () => {
    const r = await closeSheetNatively(dup, KEY_CODE.return, 'Escape');
    const again = await activeAgain('duplicate');
    await expect.poll(() => menuItemEnabled(s.app, 'file.importManaged'), { timeout: 5_000 }).toBe(true);
    const outcome = { ...r, rows: await rows.count(), libraryShown: await s.page.getByTestId('library-table').isVisible(), again };
    results['sheetReturn'] = outcome;
    check('real ↩ on the duplicate sheet skips', IS_MAC ? r.native && r.closed && outcome.rows === 3 && outcome.libraryShown : outcome.rows === 3, outcome);
  });
  // b. Real esc closes the shortcut sheet.
  await navRow.focus();
  const keys = await expectWindow(s.app, 'sheet', () => runMenuCommand(s.app, 'app.shortcuts'));
  await s.page.waitForTimeout(800);
  await fullScreenShot('m3-08-sheet-shortcuts', '⌘/ shortcut sheet');
  await guard('real esc closes the shortcut sheet', async () => {
    const r = await closeSheetNatively(keys, KEY_CODE.escape, 'Escape');
    const again = await activeAgain('shortcut');
    await expect.poll(() => menuItemEnabled(s.app, 'app.shortcuts'), { timeout: 5_000 }).toBe(true);
    results['sheetEscape'] = { ...r, again };
    check('real esc closes the shortcut sheet', IS_MAC ? r.native && r.closed : r.closed, r);
  });
  // R2-6a: a dark sheet (system dimming and the sheet's edge in dark).
  if (IS_MAC) {
    await guard('dark duplicate sheet captured', async () => {
      await setTheme(s.page, 'dark');
      const dark = await expectWindow(s.app, 'sheet', () => importFiles(s, [PDF]));
      await s.page.waitForTimeout(800);
      const shot = await fullScreenShot('m3-07b-sheet-duplicate-dark', 'duplicate sheet, dark');
      await closeSheet(dark, 'Escape');
      await expect.poll(() => menuItemEnabled(s.app, 'file.importManaged'), { timeout: 5_000 }).toBe(true);
      check('dark duplicate sheet captured', shot.file !== null, shot);
    });
    await setTheme(s.page, 'light');
  }
  await s.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  save();
});

test('M3 chrome: Korean menu bar, the 보기 menu in both sidebar states and in full screen, the 편집 menu, no tooltip under a menu', TAG, async () => {
  results['menu'] = (await menuSnapshot(s.app)).map((m) => m.label);
  if (!IS_MAC) return void save();
  const pid = s.app.process().pid!; // System Events by pid: unambiguous when several apps are called "Electron"
  const labelOf = async (id: string) =>
    (await menuSnapshot(s.app)).flatMap(function walk(n): Array<{ id: string | null; label: string; submenu: unknown }> {
      return [n, ...((n.submenu as typeof n[] | null) ?? []).flatMap(walk)];
    }).find((n) => n.id === id)?.label;
  /**
   * 보기 opened (click and keyboard captures). The verdict on the number of 전체 화면 rows comes from the open menu's
   * pixels (R2-1: the closed menu's System Events list missed AppKit's extra row); the names are recorded as well.
   */
  const viewMenu = async (prefix: string, what: string, expectedSidebar: string, expectedFullScreen: string) => {
    const closedNames = await menuItemNames(pid, 5);
    const captured = await captureOpenMenu(s.app, pid, 5, prefix, what);
    const counted = openMenuRowCount(captured.click.shot, captured.keyboard.open.frame);
    const v = {
      counted,
      openNames: captured.keyboard.open.names,
      openFrame: captured.keyboard.open.frame,
      closedNames,
      sidebarLabel: await labelOf('view.toggleSidebar'),
      fullScreenLabel: await labelOf('menu.view.fullScreen'),
    };
    check(
      `보기 ${prefix}: one 전체 화면 row in the open menu, "${expectedSidebar}" and "${expectedFullScreen}"`,
      counted?.fullScreenRows === 1 && v.sidebarLabel === expectedSidebar && v.fullScreenLabel === expectedFullScreen,
      v,
    );
    return { ...captured, ...v };
  };

  // A tooltip open by keyboard focus, then the 보기 menu opens over it: the tooltip closes (main's nativeMenu event).
  const startFacts = await windowFacts();
  results['menuTestStart'] = startFacts;
  if (startFacts.inactiveAttr || !startFacts.mainFocused) await bringAppToFront(s.app).catch(() => {});
  let tooltipBefore = -1;
  await guard('keyboard focus opens the toggle tooltip (before the menu)', async () => {
    await s.page.getByTestId('nav-library').focus();
    await s.page.keyboard.press('Shift+Tab'); // keyboard focus back onto the sidebar toggle: its tooltip opens at once
    await expect(s.page.getByTestId('sidebar-toggle')).toBeFocused({ timeout: 5_000 });
    await expect(s.page.getByRole('tooltip')).toHaveCount(1, { timeout: 5_000 }).catch(() => {});
    tooltipBefore = await s.page.getByRole('tooltip').count();
    const v = { tooltipBefore, ...(await windowFacts()) };
    check('keyboard focus opens the toggle tooltip (before the menu)', tooltipBefore === 1, v);
  });
  await guard('보기 (sidebar shown)', async () => {
    results['menuView'] = await viewMenu('m3-09-menu-view', '보기 menu open, sidebar shown', '사이드바 가리기', '전체 화면 시작');
  });
  await guard('a menu-bar menu closes an open tooltip', async () => {
    const menuPushes = (await s.page.evaluate(() => (window as unknown as { __pushes?: Array<[string, boolean, number]> }).__pushes ?? [])).filter(([k]) => k === 'nativeMenu.open');
    const v = { before: tooltipBefore, after: await s.page.getByRole('tooltip').count(), menuPushes, ...(await windowFacts()) };
    results['tooltipUnderMenu'] = v;
    check('a menu-bar menu closes an open tooltip', v.before === 1 && v.after === 0 && menuPushes.some(([, on]) => on), v);
  });
  await s.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

  await guard('보기 (sidebar hidden)', async () => {
    await runMenuCommand(s.app, 'view.toggleSidebar');
    await expect(s.page.getByTestId('shell')).toHaveAttribute('data-sidebar', 'hidden');
    results['menuViewHidden'] = await viewMenu('m3-09c-menu-view-hidden', '보기 menu open, sidebar hidden', '사이드바 보기', '전체 화면 시작');
  });
  if ((await s.page.getByTestId('shell').getAttribute('data-sidebar')) === 'hidden') await runMenuCommand(s.app, 'view.toggleSidebar');
  await expect(s.page.getByTestId('shell')).toHaveAttribute('data-sidebar', 'shown');

  // 보기 in full screen: the item says 전체 화면 종료 (a real ⌃⌘F in, and out again).
  await guard('보기 in full screen', async () => {
    const isFull = async () => (await mainWindow(s.app)).evaluate((w) => w.isFullScreen());
    await nativeKeystroke(s.app, 'f', ['control', 'command']);
    await expect.poll(isFull, { timeout: 10_000 }).toBe(true);
    await sleep(1500); // the full-screen animation ends before menus open (M0: no toggling during the transition)
    results['menuViewFullScreen'] = await viewMenu('m3-09f-menu-view-fullscreen', '보기 menu open in full screen', '사이드바 가리기', '전체 화면 종료');
    await nativeKeystroke(s.app, 'f', ['control', 'command']);
    await expect.poll(isFull, { timeout: 10_000 }).toBe(false);
    await sleep(1500);
  });
  if (await (await mainWindow(s.app)).evaluate((w) => w.isFullScreen())) {
    await (await mainWindow(s.app)).evaluate((w) => w.setFullScreen(false));
    await sleep(2000);
  }

  // n5: AppKit adds items to 편집 too (dictation, emoji); see what it shows.
  await guard('편집 and 파일 menus', async () => {
    results['menuEdit'] = { ...(await captureOpenMenu(s.app, pid, 4, 'm3-12-menu-edit', '편집 menu open')), names: await menuItemNames(pid, 4) };
    results['menuFile'] = { names: await menuItemNames(pid, 3) };
    check('파일 says 윈도우 닫기 (n4)', ((results['menuFile'] as { names: string[] | null }).names ?? []).includes('윈도우 닫기'), results['menuFile']);
  });
  save();
});

test('M3 chrome: a disabled shortcut does nothing; real ⌃⌘S and ⌘1 reach the native menu (System Events)', TAG, async () => {
  test.skip(!IS_MAC, 'OS-level keystrokes are macOS only');
  // a. In the library 라이브러리로 돌아가기 is disabled: a real ⌘1 runs nothing (no view change, no window, no error).
  await guard('disabled ⌘1 in the library is ignored', async () => {
    const appErrors: string[] = [];
    const onConsole = (m: { text(): string }) => {
      if (m.text().startsWith('[app]')) appErrors.push(m.text());
    };
    s.page.on('console', onConsole);
    try {
      const before = { windows: await windowCount(s.app), navBackEnabled: await menuItemEnabled(s.app, 'nav.back') };
      await nativeKeystroke(s.app, '1', ['command']);
      await sleep(1500);
      const after = {
        windows: await windowCount(s.app),
        libraryShown: await s.page.getByTestId('library-table').isVisible(),
        title: await s.page.getByTestId('toolbar-title').textContent(),
        appErrors,
      };
      results['disabledShortcut'] = { before, after };
      check('disabled ⌘1 in the library is ignored', !before.navBackEnabled && after.windows === before.windows && after.libraryShown && appErrors.length === 0, { before, after });
    } finally {
      s.page.off('console', onConsole);
    }
  });
  try {
    await nativeKeystroke(s.app, 's', ['control', 'command']);
    await expect(s.page.getByTestId('shell')).toHaveAttribute('data-sidebar', 'hidden');
    await nativeKeystroke(s.app, 's', ['control', 'command']);
    await expect(s.page.getByTestId('shell')).toHaveAttribute('data-sidebar', 'shown');
    await openItem(s.page, 'sample');
    await nativeKeystroke(s.app, '1', ['command']);
    await expect(s.page.getByTestId('library-table')).toBeVisible();
    results['nativeAccelerators'] = 'ok';
  } catch (e) {
    results['nativeAccelerators'] = e instanceof NativeInputNotPermitted ? `not permitted: ${e.message}` : `failed: ${errorText(e)}`;
    // Back to the library for the tests below, whatever failed.
    if (await menuItemEnabled(s.app, 'nav.back')) await runMenuCommand(s.app, 'nav.back');
    if ((await s.page.getByTestId('shell').getAttribute('data-sidebar')) === 'hidden') await runMenuCommand(s.app, 'view.toggleSidebar');
  }
  check('real ⌃⌘S and ⌘1 reach the native menu', results['nativeAccelerators'] === 'ok', results['nativeAccelerators']);
  save();
});

test('M3 chrome: the focus ring on a control disabled with a reason is not dimmed', TAG, async () => {
  // c. PDF at page 1: 이전 쪽 is disabled with a reason, still focusable; the keyboard puts the focus on it.
  await guard('soft-disabled focus ring at full strength', async () => {
    await openItem(s.page, 'sample');
    await expect(s.page.getByTestId('pdf-page-indicator')).toHaveText('1 / 3쪽');
    const prev = s.page.getByTestId('pdf-prev');
    await s.page.getByTestId('pdf-next').focus();
    await s.page.keyboard.press('Shift+Tab');
    await expect(prev).toBeFocused();
    await expectDisabledReason(prev, '첫 쪽입니다');
    const ring = () =>
      prev.evaluate((el) => {
        const cs = getComputedStyle(el);
        return {
          focusVisible: el.hasAttribute('data-focus-visible'),
          outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`,
          opacity: cs.opacity,
          iconOpacity: getComputedStyle(el.querySelector('.icon') ?? el).opacity,
        };
      });
    const before = await ring();
    // R2-6c: the reason tooltip opens on keyboard focus (missing in run 39631541294 while the window was stuck inactive).
    await expect(s.page.getByRole('tooltip')).toHaveCount(1, { timeout: 3_000 }).catch(() => {});
    const reasonTooltip = await s.page.getByRole('tooltip').textContent().catch(() => null);
    await nativeWindowShot(s.app, 'm3-10-soft-disabled-focus', 'PDF page 1: 이전 쪽 disabled with a reason, keyboard focus ring and its reason tooltip');
    const after = await ring();
    results['softDisabledFocus'] = { before, afterWindowShot: after, reasonTooltip };
    check('soft-disabled focus ring at full strength', before.focusVisible && before.outline.startsWith('solid') && before.opacity === '1' && after.focusVisible, { before, after });
    check('the disabled reason shows as a tooltip (m3-10)', reasonTooltip?.includes('첫 쪽입니다') ?? false, { reasonTooltip });
  });
  if (await menuItemEnabled(s.app, 'nav.back')) await runMenuCommand(s.app, 'nav.back');
  await expect(s.page.getByTestId('library-table')).toBeVisible();
  save();
});

test('M3 chrome: the fatal screen keeps a drag strip under the traffic lights', TAG, async () => {
  // d. The tour's fatal state (an unreadable database and one pre-update backup) in a throwaway profile.
  await guard('fatal screen top strip drags the window', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-m3-fatal-'));
    const lib = path.join(dir, 'library');
    fs.mkdirSync(lib, { recursive: true });
    fs.writeFileSync(path.join(lib, 'library.sqlite'), 'not a database');
    fs.writeFileSync(path.join(lib, 'library.sqlite.pre-v2.bak'), '');
    const fatal = await launch(lib, path.join(dir, 'userdata'), UNEMULATED);
    try {
      await expect(fatal.page.getByTestId('fatal-notice')).toBeVisible();
      const strip = await fatal.page.evaluate(() => {
        const region = (el: Element | null) => (el ? getComputedStyle(el).getPropertyValue('-webkit-app-region') || getComputedStyle(el).getPropertyValue('app-region') : null);
        const drag = document.querySelector('.fatal-drag');
        const r = drag?.getBoundingClientRect();
        // Under the traffic lights (centre about 24, 26) and at the right end. The window's drag area is the union of
        // app-region: drag boxes minus no-drag boxes (stacking plays no part), so the point drags when it lies in the
        // strip and nothing there is no-drag; the topmost element is recorded for reference.
        const at = (x: number, y: number) => {
          const stack = document.elementsFromPoint(x, y);
          const top = stack[0];
          return {
            inStrip: Boolean(r && x >= r.left && x < r.right && y >= r.top && y < r.bottom),
            noDrag: stack.filter((el) => region(el) === 'no-drag').map((el) => `${el.tagName.toLowerCase()}.${el.className}`),
            top: top ? `${top.tagName.toLowerCase()}.${top.className}` : null,
          };
        };
        return { region: region(drag), box: r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null, underLights: at(24, 26), right: at(innerWidth - 40, 26) };
      });
      await nativeWindowShot(fatal.app, 'm3-11-fatal', 'library cannot be opened: fatal screen in the window chrome');
      results['fatal'] = strip;
      check(
        'fatal screen top strip drags the window',
        strip.region === 'drag' && strip.box?.y === 0 && strip.box.height === 52 && [strip.underLights, strip.right].every((p) => p.inStrip && p.noDrag.length === 0),
        strip,
      );
    } finally {
      await fatal.app.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  save();
});

test('M3 chrome: Finder에서 보기 brings Finder to the front', TAG, async () => {
  test.skip(!IS_MAC, 'Finder is macOS only (and Linux CI must not open a file manager)');
  // e. Through the registry, as a user does: the row's context menu (native popup driven by its own click()).
  await guard('Finder에서 보기 brings Finder to the front', async () => {
    await s.app.evaluate(({ shell }) => {
      const g = globalThis as { __learnReveals?: number };
      const reveal = shell.showItemInFolder.bind(shell);
      g.__learnReveals = 0;
      shell.showItemInFolder = (p: string) => {
        g.__learnReveals = (g.__learnReveals ?? 0) + 1;
        reveal(p);
      };
    });
    await stubContextMenu(s.app, 'Finder에서 보기');
    await bringAppToFront(s.app);
    await s.page.getByTestId('item-row').filter({ has: s.page.locator('[data-testid="open-item"][data-title="sample"]') }).click({ button: 'right' });
    const t0 = Date.now();
    let front = frontmostProcess();
    while (front.name !== 'Finder' && Date.now() - t0 < 5_000) {
      await sleep(250);
      front = frontmostProcess();
    }
    const value = {
      frontmost: front.name,
      ms: front.name === 'Finder' ? Date.now() - t0 : null,
      revealCalls: await s.app.evaluate(() => (globalThis as { __learnReveals?: number }).__learnReveals ?? 0),
      errorToast: await s.page.getByTestId('action-error').isVisible(),
    };
    results['finder'] = value;
    check('Finder에서 보기 brings Finder to the front', value.frontmost === 'Finder' && value.revealCalls === 1 && !value.errorToast, value);
  });
  // R2-6e: Finder's own window as the reference for the inactive look (R2-2, R2-3), active and inactive, light and
  // dark (the system appearance, switched on the throwaway CI machine only).
  await guard('Finder reference captured', async () => {
    const finderRef: Record<string, unknown> = {};
    const measure = async (name: string) => {
      const id = await windowIdOf('Finder');
      if (!id) return { error: 'no Finder window id' };
      const shot = await windowShotById(id, name, `Finder reference: ${name}`);
      if (!shot.file) return { error: shot.error ?? 'no capture' };
      const img = decodePng(fs.readFileSync(path.join(EVIDENCE_ROOT, shot.file)));
      const w = img.width;
      const h = img.height;
      return {
        file: shot.file,
        size: [w, h],
        titleBar: regionStats(img, { x0: 90, y0: 0, x1: w - 10, y1: Math.min(52, h) }),
        sidebar: regionStats(img, { x0: 0, y0: 60, x1: Math.min(Math.round(w * 0.25), 220), y1: h - 10 }),
      };
    };
    const finderFront = async () => {
      osascript('tell application "Finder" to activate');
      const t0 = Date.now();
      while (frontmostProcess().name !== 'Finder' && Date.now() - t0 < 5_000) await sleep(200);
      await sleep(700);
    };
    const appFront = async () => {
      await bringAppToFront(s.app);
      await sleep(700);
    };
    const appearance = (dark: boolean) =>
      tryExec('osascript', ['-e', `tell application "System Events" to tell appearance preferences to set dark mode to ${dark}`], 20_000);
    for (const dark of process.env['CI'] ? [false, true] : [false]) {
      const theme = dark ? 'dark' : 'light';
      if (dark) await appearance(true);
      await finderFront();
      finderRef[`${theme}-active`] = await measure(`ref-finder-${theme}-active`);
      await appFront();
      finderRef[`${theme}-inactive`] = await measure(`ref-finder-${theme}-inactive`);
      if (dark) await appearance(false);
    }
    results['finderRef'] = finderRef;
    check('Finder reference captured', Object.values(finderRef).every((v) => !(v as { error?: string }).error), finderRef);
  });
  await bringAppToFront(s.app).catch(() => {});
  save();
});

test('M3 chrome: window bounds survive a restart on macOS', TAG, async () => {
  const lib = path.join(tmp, 'library');
  const ud = path.join(tmp, 'userdata');
  // Bounds that fit the display's work area (run 39617644850 asked for 1000 wide at x 40 on the 1024-wide runner, and
  // the restore moved it to x 24 to keep it on screen) and respect the window's minimum size (run 39618864364 asked
  // for 944 wide, below the 960 minimum). What is restored is compared with the bounds right before closing.
  const workArea = await s.app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea);
  const width = Math.max(layout.windowMinWidth, Math.min(1000, workArea.width - 80));
  const height = Math.max(layout.windowMinHeight, Math.min(640, workArea.height - 80));
  const bounds = { x: workArea.x + Math.min(40, Math.max(0, workArea.width - width)), y: workArea.y + Math.min(40, Math.max(0, workArea.height - height)), width, height };
  await (await mainWindow(s.app)).evaluate((w, b) => w.setBounds(b), bounds);
  await s.page.waitForTimeout(1500);
  const beforeClose = await (await mainWindow(s.app)).evaluate((w) => w.getBounds());
  await s.app.close();
  s = await launch(lib, ud, UNEMULATED);
  await recordPushes(s.page);
  const restored = await (await mainWindow(s.app)).evaluate((w) => w.getBounds());
  results['windowState'] = { workArea, requested: bounds, beforeClose, restored };
  check(
    'window bounds restored after a restart',
    restored.width === beforeClose.width && restored.height === beforeClose.height && Math.abs(restored.x - beforeClose.x) <= 2 && Math.abs(restored.y - beforeClose.y) <= 2,
    results['windowState'],
  );
  check('window took the requested bounds before closing', beforeClose.width === bounds.width && beforeClose.height === bounds.height, results['windowState']);
  save();
});

test('M3 chrome: verdict of every check above (m3-shell.json checks)', TAG, async () => {
  save();
  for (const [name, c] of Object.entries(checks)) expect.soft(c.ok, `${name}: ${JSON.stringify(c.value)}`).toBe(true);
});
