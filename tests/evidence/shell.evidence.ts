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
  FIXTURES, KEY_CODE, NativeInputNotPermitted, bringAppToFront, bringFinderToFront, closeSheet, expectDisabledReason, expectWindow, frontmostProcess, importFiles, importPaths,
  launch, mainWindow, menuItemEnabled, menuSnapshot, nativeKeyCode, nativeKeystroke, openItem, osascript, restoreOpenDialog, runMenuCommand, stubContextMenu, stubOpenDialog,
  type LaunchOptions,
  type Session,
} from '../e2e/helpers';
import { COMMANDS } from '../../packages/domain/src/commands';
import { composite, contrast, parseColor, type Rgba } from '../../apps/desktop/src/renderer/src/design/color';
import { colors, colorsVibrancySidebar, layout } from '../../apps/desktop/src/renderer/src/design/tokens';
import { themeHex } from '../../apps/desktop/src/renderer/src/design/tokens.generated';
import {
  EVIDENCE_ROOT, IS_MAC, allShots, captureOpenMenu, cgWindowId, fullScreenShot, menuItemNames, movePointer, nativeWindowShot, outFile, platformFonts, pngCentroid, pngPixels,
  pressEscape, record, tryExec, windowIdOf, windowOnScreen, windowShotById, writeJson,
} from './capture';
import { switchDisplayForDemo } from './display-mac';
import { elementStats, inkMass, regionStats, selectionBand } from './image-stats';
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

/** The main window's chrome as its page draws it now: its window states, the dimmable parts' colours, boxes to measure. */
function mainChrome() {
  return s.page.evaluate(() => {
    const css = (sel: string) => getComputedStyle(document.querySelector(sel)!);
    const probe = document.createElement('span');
    document.body.append(probe);
    const token = (v: string) => ((probe.style.color = `var(${v})`), getComputedStyle(probe).color);
    const tokens = {
      inactive: token('--text-inactive'),
      inactiveSelected: token('--text-inactive-selected'),
      primary: token('--text-primary'),
      accentText: token('--accent-text'),
      chromeFill: token('--bg-chrome-inactive'),
      chromeLine: token('--separator-chrome-inactive'),
    };
    probe.remove();
    const box = (sel: string) => {
      const r = document.querySelector(sel)!.getBoundingClientRect();
      return { x0: Math.round(r.x), y0: Math.round(r.y), x1: Math.round(r.right), y1: Math.round(r.bottom) };
    };
    return {
      notKey: document.documentElement.hasAttribute('data-window-inactive'),
      notMain: document.documentElement.hasAttribute('data-window-not-main'),
      cursor: css('[data-testid="nav-library"]').boxShadow,
      title: css('[data-testid="toolbar-title"]').color,
      count: css('[data-testid="toolbar-count"]').color,
      toggle: css('[data-testid="sidebar-toggle"]').color,
      toggleOpacity: css('[data-testid="sidebar-toggle"] > .icon').opacity,
      section: css('.sidebar .section-label').color,
      rowIcon: css('[data-testid="nav-library"] > .icon').color,
      rowIconOpacity: css('[data-testid="nav-library"] > .icon').opacity,
      selectedRow: css('[data-testid="nav-library"]').color,
      toolbarFill: css('[data-testid="toolbar"]').backgroundColor,
      toolbarLine: css('[data-testid="toolbar"]').borderBottomColor,
      tokens,
      titleBox: box('[data-testid="toolbar-title"]'),
      selectedLabelBox: box('[data-testid="nav-library"] .label'),
    };
  });
}

/**
 * macOS: bring Finder to the front (the window becomes inactive), capture the main window without focusing it, read
 * the close button's colour and the current sidebar row's fill, then bring the app back.
 */
async function inactiveShot(name: string, description: string): Promise<Record<string, unknown>> {
  await bringFinderToFront();
  await expect(s.page.locator('html')).toHaveAttribute('data-window-inactive', '', { timeout: 5_000 });
  await sleep(500); // the material and the lights repaint as inactive
  const shot = await nativeWindowShot(s.app, name, description, { focus: false });
  const frontmostAtShot = frontmostProcess().name; // R2-5: read before the app comes back
  const closeButton = shot.file ? (await pngPixels(s.page, shot.file, [[25, 26]]))[0] ?? null : null;
  const navRow = await s.page.getByTestId('nav-library').evaluate((el) => getComputedStyle(el).backgroundColor);
  const chrome = await mainChrome();
  // The drawn title and the selected row's label, measured like Finder's (finderRef): ink and ratio on their surface;
  // the toolbar's own fill at (600, 26), where it is empty (polish Q2: 236 light, 20 dark).
  const img = shot.file ? decodePng(fs.readFileSync(path.join(EVIDENCE_ROOT, shot.file))) : null;
  const titleInk = img ? elementStats(img, chrome.titleBox) : null;
  const selectedInk = img ? elementStats(img, chrome.selectedLabelBox) : null;
  const toolbarPixel = shot.file ? (await pngPixels(s.page, shot.file, [[600, 26]]))[0] ?? null : null;
  await bringAppToFront(s.app);
  await expect(s.page.locator('html')).not.toHaveAttribute('data-window-inactive', '', { timeout: 5_000 });
  // N4-4: the sidebar's edge (its last column, below the rows) and the toolbar's hairline (its last row, mid-way), read
  // from the capture taken above. The geometry is read with the app back in front (it does not change with the
  // window's state); the points are CSS px, the capture is device px: scaled by the capture's own width over the
  // window's (1 on the runner, 2 on a Retina screen).
  const geometry = await s.page.evaluate(() => {
    const sb = document.querySelector('.sidebar')!.getBoundingClientRect();
    const tb = document.querySelector('[data-testid="toolbar"]')!.getBoundingClientRect();
    return {
      width: innerWidth,
      sidebarEdge: [sb.right - 1, sb.top + sb.height * 0.6] as [number, number],
      toolbarLine: [tb.left + tb.width / 2, tb.bottom - 1] as [number, number],
    };
  });
  const scale = img ? img.width / geometry.width : 1;
  const px = ([x, y]: readonly [number, number]) => [Math.round(x * scale), Math.round(y * scale)] as const;
  const points = { sidebarEdge: px(geometry.sidebarEdge), toolbarLine: px(geometry.toolbarLine) };
  const edgeRgb = shot.file ? await pngPixels(s.page, shot.file, [points.sidebarEdge, points.toolbarLine]) : null;
  const edges = { scale, points, sidebarEdge: edgeRgb?.[0] ?? null, toolbarLine: edgeRgb?.[1] ?? null };
  return { frontmostAtShot, closeButton, navRow, chrome, titleInk, selectedInk, toolbarPixel, edges };
}
/** Close-button red (#ff5f57) pixels in a capture's top-left corner, where the traffic lights are drawn. */
function redLightPixels(shot: string) {
  const img = decodePng(fs.readFileSync(path.join(EVIDENCE_ROOT, shot)));
  let n = 0;
  for (let y = 0; y < Math.min(70, img.height); y++) {
    for (let x = 0; x < Math.min(120, img.width); x++) {
      const i = (y * img.width + x) * 4;
      const [r, g, b] = [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!];
      if (r > 215 && g > 60 && g < 130 && b > 50 && b < 125) n++;
    }
  }
  return n;
}

/** The open tooltip's box (page coordinates) and its background, or null. */
const tooltipBox = (page: Page) =>
  page.evaluate(() => {
    const t = document.querySelector('[role="tooltip"]');
    if (!t) return null;
    const r = t.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height), bg: getComputedStyle(t).backgroundColor };
  });

/**
 * Keyboard focus on the sidebar toggle, whose tooltip opens on keyboard focus: Shift+Tab from the ⌘K launcher. Since
 * Task 9 the launcher sits between the toggle and the sidebar rows, so Shift+Tab from 내 라이브러리 lands on the
 * launcher (which has no tooltip; Mac run 39779536146). Returns whether the toggle has the focus.
 */
async function keyboardToSidebarToggle(): Promise<boolean> {
  await s.page.getByTestId('launcher').focus();
  await s.page.keyboard.press('Shift+Tab');
  return s.page.getByTestId('sidebar-toggle').evaluate((el) => el === document.activeElement);
}

/**
 * macOS: whether System Events sees a sheet on our window titled `title` (AppKit's AXSheet: a panel or alert attached to
 * it). Null when System Events fails (no such window, or no access).
 */
async function hasSheet(pid: number, title: string): Promise<boolean | null> {
  const r = await tryExec('osascript', ['-e', `tell application "System Events" to tell (first process whose unix id is ${pid}) to return (exists sheet 1 of window ${JSON.stringify(title)})`], 10_000);
  const out = r.stdout.trim();
  return r.ok && (out === 'true' || out === 'false') ? out === 'true' : null;
}

/**
 * Whether a tooltip is drawn in a capture (R3-6: judge the pixels, not the DOM): the share of pixels inside its box
 * (inset 3, shifted by `offset` — 0 for a window shot, the content origin for a screen shot, and cut at `clipRight`)
 * that carry the tooltip's own background. Only used in dark, where nothing under it shares that colour.
 */
function tooltipInCapture(shot: string, box: { x: number; y: number; width: number; height: number; bg: string }, offset = { x: 0, y: 0 }, clipRight = Infinity) {
  const img = decodePng(fs.readFileSync(path.join(EVIDENCE_ROOT, shot)));
  const bg = parseColor(box.bg);
  const want = [bg.r, bg.g, bg.b].map((v) => Math.round(v * 255));
  const x0 = offset.x + box.x + 3;
  const x1 = Math.min(offset.x + box.x + box.width - 3, clipRight);
  let n = 0;
  let hits = 0;
  for (let y = offset.y + box.y + 3; y < offset.y + box.y + box.height - 3; y++) {
    for (let x = x0; x < x1; x++) {
      if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
      n++;
      const i = (y * img.width + x) * 4;
      if (Math.max(Math.abs(img.data[i]! - want[0]!), Math.abs(img.data[i + 1]! - want[1]!), Math.abs(img.data[i + 2]! - want[2]!)) <= 6) hits++;
    }
  }
  return { pixels: n, share: n ? Math.round((hits / n) * 100) / 100 : 0, bg: want };
}

/**
 * 보기's own registry items (명령 팔레트…, the sidebar toggle, 글자 크게 / 작게 / 기본 글자 크기 — ⌘+'s hidden ⌘= twin
 * is no row): every other text row in it is a full-screen row.
 */
const VIEW_REGISTRY_ROWS = COMMANDS.filter((c) => c.menu?.menu === 'view').length;
/**
 * Rows of an open 보기 menu counted from its click capture (Task 8 R2-1): the panel is found from a seed in its top
 * padding (from System Events' frame of the open menu when it gave one), and every text row past the registry's is a
 * full-screen row (보기 holds 명령 팔레트…, the sidebar item, separators and the full-screen item(s) in E2E builds).
 */
function openMenuRowCount(shot: string | null, frame: { x: number; y: number } | null) {
  if (!shot) return null;
  const img = decodePng(fs.readFileSync(path.join(EVIDENCE_ROOT, shot)));
  // The frame System Events reports belongs to the frontmost app's menu; when it is no panel (run 39640208719: another
  // app was in front), the fixed seed under the 보기 title is used.
  const fromFrame = frame && frame.x >= 0 && frame.y < img.height - 40 ? findMenuPanel(img, { x: frame.x + 6, y: frame.y + 5 }) : null;
  const panel = fromFrame && fromFrame.y1 - fromFrame.y0 > 20 ? fromFrame : findMenuPanel(img, { x: 206, y: 30 });
  const m = menuRows(img, panel);
  return { panel: m.panel, rows: m.rows.length, separators: m.separators.length, fullScreenRows: Math.max(0, m.rows.length - VIEW_REGISTRY_ROWS) };
}

interface InactiveChrome {
  notKey: boolean;
  notMain: boolean;
  cursor: string;
  title: string;
  count: string;
  toggle: string;
  toggleOpacity: string;
  section: string;
  rowIcon: string;
  rowIconOpacity: string;
  selectedRow: string;
  toolbarFill: string;
  toolbarLine: string;
  tokens: { inactive: string; inactiveSelected: string; primary: string; accentText: string; chromeFill: string; chromeLine: string };
}
/**
 * R3-2 and the polish round: not key and not main; text at --text-inactive (the selected row at
 * --text-inactive-selected); glyphs in their solid colour, faded as a whole (N4-1); on macOS the toolbar takes the
 * inactive material and its line the inactive separator (Q2, N4-4).
 */
const chromeDimmed = (c: InactiveChrome) =>
  c.notKey &&
  c.notMain &&
  [c.title, c.count, c.section].every((v) => v === c.tokens.inactive) &&
  c.selectedRow === c.tokens.inactiveSelected &&
  c.toggle === c.tokens.primary &&
  c.toggleOpacity === '0.3' &&
  c.rowIcon === c.tokens.accentText &&
  c.rowIconOpacity === '0.3' &&
  (!IS_MAC || (c.toolbarFill === c.tokens.chromeFill && c.toolbarLine === c.tokens.chromeLine));
/** The captured toolbar at (600, 26) is the inactive material: 236 light, 20 dark (± 2). */
const toolbarIsMaterial = (rgb: readonly number[] | null, theme: 'light' | 'dark') => rgb !== null && rgb.every((v) => Math.abs(v - (theme === 'light' ? 236 : 20)) <= 2);

/** Grey: no channel stands out (the active close button is red #ff5f57). */
const isGrey = (rgb: readonly number[] | null) => rgb !== null && Math.max(...rgb) - Math.min(...rgb) <= 24;
/**
 * Critic T12-m1: the open ⌘/ sheet's and its parent's content bounds, the sheet's natural height (its content without
 * scrolling) and the height the platform's room allows. macOS centres a sheet over its parent (16 kept above and
 * below); elsewhere it hangs 60 down (16 kept below). The body scrolls only beyond that.
 */
async function shortcutSheetFit(keys: Page) {
  const bounds = await s.app.evaluate(({ BrowserWindow }) => {
    const all = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
    const of = (kind: string) => all.find((w) => w.webContents.getURL().includes(`window=${kind}`))!.getContentBounds();
    return { sheet: of('sheet'), parent: of('main') };
  });
  const natural = await keys.evaluate(() => {
    const root = document.querySelector('[data-sheet-root]')!;
    const body = root.querySelector('.d-body');
    return Math.ceil(root.getBoundingClientRect().height + (body ? body.scrollHeight - body.clientHeight : 0));
  });
  const expected = Math.min(natural, Math.max(160, bounds.parent.height - (IS_MAC ? 2 * 16 : 60 + 16)));
  const centreOffset = bounds.sheet.y + bounds.sheet.height / 2 - (bounds.parent.y + bounds.parent.height / 2);
  return { ...bounds, natural, expected, scrolls: natural > bounds.sheet.height, centreOffset };
}

/**
 * Leaves full screen if the main window is in it: a real ⌃⌘F first (as a user would), then setFullScreen(false).
 * Bounded waits, never a throw (cleanup in a finally). Returns whether the window is out of full screen.
 */
async function leaveFullScreen(win: Awaited<ReturnType<typeof mainWindow>>): Promise<boolean> {
  const isFull = () => win.evaluate((w) => w.isFullScreen()).catch(() => false);
  if (!(await isFull())) return true;
  await nativeKeystroke(s.app, 'f', ['control', 'command']).catch(() => {});
  await expect.poll(isFull, { timeout: 6_000 }).toBe(false).catch(() => {});
  if (await isFull()) {
    await win.evaluate((w) => w.setFullScreen(false)).catch(() => {});
    await expect.poll(isFull, { timeout: 6_000 }).toBe(false).catch(() => {});
  }
  await sleep(1500); // AppKit's restore, then ours
  return !(await isFull());
}

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
  // A test that timed out skips the rest of this serial file, the verdict included: write what was measured until then.
  try {
    save();
  } catch (e) {
    console.error(`[evidence] m3-shell.json could not be written: ${errorText(e)}`);
  }
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
    // R3-6: the strip itself, so the weights are seen, not only measured.
    const strip = outFile('m3-16-weight-probe.page.png');
    await s.page.locator('#weight-probe').screenshot({ path: strip.abs });
    record({ file: strip.rel, kind: 'page', description: 'n6 probe: "sample" and "라이브러리" at 500 / 590 / 600 / 700 in the app font stack' });
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
      const v = inactive['light'] as { closeButton: number[] | null; navRow: string; chrome: InactiveChrome };
      check('inactive window: grey lights, neutral selection, no keyboard cursor (light)', isGrey(v.closeButton) && v.navRow !== activeRow && v.chrome.cursor === 'none', { ...v, activeRow });
      check('not main: the chrome recedes — text tokens, glyphs faded whole, the material toolbar (light, R3-2, polish)', chromeDimmed(v.chrome), v.chrome);
      check('not main: the captured toolbar is the inactive material, 236 (light, polish Q2)', toolbarIsMaterial((inactive['light'] as { toolbarPixel: number[] | null }).toolbarPixel, 'light'), inactive['light']);
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
      const v2 = inactive['dark'] as { closeButton: number[] | null; navRow: string; chrome: InactiveChrome };
      check('inactive window: grey lights, neutral selection, no keyboard cursor (dark)', isGrey(v2.closeButton) && v2.navRow !== (await navRow()) && v2.chrome.cursor === 'none', v2);
      check('not main: the chrome recedes — text tokens, glyphs faded whole, the material toolbar (dark, R3-2, polish)', chromeDimmed(v2.chrome), v2.chrome);
      check('not main: the captured toolbar is the inactive material, 20 (dark, polish Q2)', toolbarIsMaterial((inactive['dark'] as { toolbarPixel: number[] | null }).toolbarPixel, 'dark'), inactive['dark']);
      // N4-4: --separator-chrome-inactive is black in dark (run 39653189858 read 51,54,56 before the polish round).
      const edges = (inactive['dark'] as { edges: { sidebarEdge: number[] | null; toolbarLine: number[] | null } }).edges;
      check('not main: the sidebar edge and the toolbar hairline are black in the capture (dark, N4-4)', [edges.sidebarEdge, edges.toolbarLine].every((c) => c !== null && Math.max(...c) <= 8), edges);
    });
    // R2-6b: a tooltip crossing the dark material (raised surface over the sidebar).
    await guard('tooltip over the dark material', async () => {
      // Keyboard focus opens it at once (a hover through Playwright opened none on the runner, run 39640208719). The
      // app is brought to the front first and the shot does not refocus: refocusing closed the tooltip before the
      // capture in run 39642950406 (a blur/focus push in between).
      await bringAppToFront(s.app);
      const toggleFocused = await keyboardToSidebarToggle();
      await expect(s.page.getByRole('tooltip')).toHaveCount(1, { timeout: 3_000 }).catch(() => {});
      await sleep(400); // the tooltip's fade-in
      const box = await tooltipBox(s.page);
      const shot = await nativeWindowShot(s.app, 'm3-14-tooltip-dark', 'dark: the sidebar toggle tooltip over the material', { focus: false });
      const drawn = box && shot.file ? tooltipInCapture(shot.file, box) : null;
      results['tooltipDark'] = { toggleFocused, box, drawn };
      check('tooltip over the dark material is in the capture (pixels, R3-6)', (drawn?.share ?? 0) >= 0.5, results['tooltipDark']);
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

// Task 9: the main window is active here (no sheet just closed), light, three items in the library.
test('M3 chrome: ⌘K palette from a real keystroke, 초성 ㄱㅈㅇ, light and dark', TAG, async () => {
  const palette = s.page.getByTestId('palette');
  await guard('⌘K opens the palette', async () => {
    let via = 'menu';
    if (IS_MAC) {
      await bringAppToFront(s.app).catch(() => {});
      try {
        await nativeKeystroke(s.app, 'k', ['command']);
        via = 'keystroke';
      } catch (e) {
        if (!(e instanceof NativeInputNotPermitted)) throw e;
        await runMenuCommand(s.app, 'app.palette');
      }
    } else {
      await runMenuCommand(s.app, 'app.palette');
    }
    await expect(palette).toBeVisible({ timeout: 5_000 });
    const focused = await s.page.getByTestId('palette-input').evaluate((el) => el === document.activeElement);
    results['palette'] = { via, focused };
    check('⌘K opens the palette with the focus in its field', focused && (!IS_MAC || via === 'keystroke'), results['palette']);
  });
  if (!(await palette.isVisible())) return void save();
  /** Key and main: active chrome, accent cursor row (a dimmed capture must fail here, not become the evidence). */
  const active = () =>
    s.page.evaluate(() => !document.documentElement.hasAttribute('data-window-inactive') && !document.documentElement.hasAttribute('data-window-not-main'));
  const activeBeforeShot = async (shot: string) => {
    await expect.poll(active, { timeout: 5_000 }).toBe(true).catch(() => {});
    const v = { active: await active(), paletteVisible: await palette.isVisible() };
    check(`palette: the window is key and main for ${shot} (review minor 4)`, v.active && v.paletteVisible, v);
  };
  // ㄱㅈㅇ: only 가져오기 (ㄱㅈ alone also finds 글자 크게 / 작게, Task 10).
  await guard('palette: 초성 ㄱㅈㅇ finds 파일 가져오기…', async () => {
    await s.page.keyboard.insertText('ㄱㅈㅇ');
    const cursor = s.page.locator('[data-testid="palette-item"][data-focused]');
    await expect(cursor).toHaveAttribute('data-command-id', 'file.importManaged', { timeout: 5_000 });
    const v = { cursor: await cursor.getAttribute('data-command-id'), mark: await cursor.locator('mark').textContent() };
    results['paletteQuery'] = v;
    check('palette: 초성 ㄱㅈㅇ puts the cursor on 파일 가져오기… with 가져오 marked', v.cursor === 'file.importManaged' && v.mark === '가져오', v);
  });
  await activeBeforeShot('m3-13');
  await allShots(s.app, s.page, 'm3-13-palette', 'command palette, 초성 ㄱㅈㅇ (light)');
  if (IS_MAC) {
    await setTheme(s.page, 'dark'); // waits until the page is dark and the material has repainted
    await activeBeforeShot('m3-13b');
    await nativeWindowShot(s.app, 'm3-13b-palette-dark', 'command palette, 초성 ㄱㅈㅇ (dark)');
    await setTheme(s.page, 'light');
  }
  await s.page.keyboard.press('Escape');
  await expect(palette).toBeHidden();
  save();
});

test('M3 chrome: collapsed sidebar, PDF, unplayable video, sheets (real ↩ and esc)', TAG, async () => {
  const tooltips = () => s.page.getByRole('tooltip').count();
  // The menu toggles below come after pointer input (Task 8 m1: no tooltip or ring unless the keyboard was in use). The
  // palette test before this one ended with real keys, so press the pointer on an empty spot of the content again: the
  // precondition this check assumes (Mac run 39779536146 measured [1, 1] without it, correctly for keyboard input).
  await s.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await s.page.mouse.click(700, 600);
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
  // Polish: the chrome must never dim around a sheet — not while it is open, nor between its closing and the window
  // becoming key again (main keeps the parent main until then).
  await s.page.evaluate(() => {
    const w = window as unknown as { __notMainSeen?: number[]; __notMainObserver?: MutationObserver };
    w.__notMainSeen = [];
    w.__notMainObserver?.disconnect();
    w.__notMainObserver = new MutationObserver(() => {
      if (document.documentElement.hasAttribute('data-window-not-main')) w.__notMainSeen!.push(Math.round(performance.now()));
    });
    w.__notMainObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-window-not-main'] });
  });
  const dup = await expectWindow(s.app, 'sheet', () => importFiles(s, [PDF]));
  await s.page.waitForTimeout(800); // sheet slide-in
  await fullScreenShot('m3-07-sheet-duplicate', 'duplicate sheet (macOS centres it over the window and dims the parent)');
  // R3-4: under one of our sheets the window is not key (no ring, neutral selection) but stays main (chrome undimmed).
  await guard('under a sheet the window stays main', async () => {
    await expect(s.page.locator('html')).toHaveAttribute('data-window-inactive', '', { timeout: 3_000 });
    const v = await s.page.evaluate(() => ({
      notKey: document.documentElement.hasAttribute('data-window-inactive'),
      notMain: document.documentElement.hasAttribute('data-window-not-main'),
      title: getComputedStyle(document.querySelector('[data-testid="toolbar-title"]')!).color,
      cursor: getComputedStyle(document.querySelector('[data-testid="nav-library"]')!).boxShadow,
    }));
    const primary = await s.page.evaluate(() => {
      const p = document.createElement('span');
      document.body.append(p);
      p.style.color = 'var(--text-primary)';
      const c = getComputedStyle(p).color;
      p.remove();
      return c;
    });
    results['underSheet'] = { ...v, primary };
    check('under a sheet the window stays main: not key, chrome undimmed (R3-4)', v.notKey && !v.notMain && v.title === primary && v.cursor === 'none', results['underSheet']);
  });
  await guard('real ↩ on the duplicate sheet skips', async () => {
    const r = await closeSheetNatively(dup, KEY_CODE.return, 'Escape');
    const again = await activeAgain('duplicate');
    await expect.poll(() => menuItemEnabled(s.app, 'file.importManaged'), { timeout: 5_000 }).toBe(true);
    const outcome = { ...r, rows: await rows.count(), libraryShown: await s.page.getByTestId('library-table').isVisible(), again };
    results['sheetReturn'] = outcome;
    check('real ↩ on the duplicate sheet skips', IS_MAC ? r.native && r.closed && outcome.rows === 3 && outcome.libraryShown : outcome.rows === 3, outcome);
  });
  await guard('no dimmed flash around the duplicate sheet', async () => {
    await sleep(500); // past main's 250 ms re-read
    const seen = await s.page.evaluate(() => (window as unknown as { __notMainSeen?: number[] }).__notMainSeen ?? null);
    await s.page.evaluate(() => (window as unknown as { __notMainObserver?: MutationObserver }).__notMainObserver?.disconnect());
    results['sheetNoFlash'] = { notMainAt: seen };
    check('the chrome never dims between a sheet opening, closing and the window being key again (polish)', Array.isArray(seen) && seen.length === 0, results['sheetNoFlash']);
  });
  // b. Real esc closes the shortcut sheet.
  await navRow.focus();
  const keys = await expectWindow(s.app, 'sheet', () => runMenuCommand(s.app, 'app.shortcuts'));
  await s.page.waitForTimeout(800);
  await fullScreenShot('m3-08-sheet-shortcuts', '⌘/ shortcut sheet');
  // Critic T12-m1: the sheet is as tall as its content up to the room its platform leaves. macOS centres a sheet over
  // its parent (16 kept above and below); elsewhere it hangs 60 down (16 kept below). The body scrolls only beyond that.
  await guard('the ⌘/ sheet is as tall as its content, up to the room the platform leaves (T12-m1)', async () => {
    const v = await shortcutSheetFit(keys);
    results['shortcutSheetBounds'] = v;
    check('the ⌘/ sheet is as tall as its content, up to the room the platform leaves (T12-m1)', v.sheet.height === v.expected, v);
  });
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
  // Four full-screen round trips, six open-menu captures: about 70 s, more when System Events stalls.
  test.setTimeout(300_000);
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
  const viewMenu = async (prefix: string, what: string, expectedSidebar: string, expectedFullScreen: string, focus = true) => {
    const closedNames = await menuItemNames(pid, 5);
    const captured = await captureOpenMenu(s.app, pid, 5, prefix, what, { focus });
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

  const startFacts = await windowFacts();
  results['menuTestStart'] = startFacts;
  await bringAppToFront(s.app).catch(() => {});
  await guard('보기 (sidebar shown)', async () => {
    results['menuView'] = await viewMenu('m3-09-menu-view', '보기 menu open, sidebar shown', '사이드바 가리기', '전체 화면 시작');
  });

  // R3-6: a tooltip open by keyboard focus, then 보기 opened by click over it: the tooltip must be gone from the capture
  // (pixels, in dark where nothing under it shares its colour), closed by the menu and not by a blur first.
  await guard('a menu-bar menu closes an open tooltip (pixels)', async () => {
    await setTheme(s.page, 'dark');
    await bringAppToFront(s.app);
    const toggleFocused = await keyboardToSidebarToggle(); // its tooltip opens at once
    await expect(s.page.getByRole('tooltip')).toHaveCount(1, { timeout: 5_000 }).catch(() => {});
    await sleep(400);
    const box = await tooltipBox(s.page);
    const openedAt = await s.page.evaluate(() => Math.round(performance.now()));
    const content = await (await mainWindow(s.app)).evaluate((w) => w.getContentBounds());
    const captured = await captureOpenMenu(s.app, pid, 5, 'm3-18-tooltip-under-menu-dark', '보기 opened by click over an open tooltip (dark)', { focus: false });
    const counted = openMenuRowCount(captured.click.shot, captured.keyboard.open.frame);
    const drawn = box && captured.click.shot ? tooltipInCapture(captured.click.shot, box, { x: content.x, y: content.y }, (counted?.panel.x0 ?? Infinity) - 20) : null;
    const pushes = await s.page.evaluate(() => (window as unknown as { __pushes?: Array<[string, boolean, number]> }).__pushes ?? []);
    const firstOpen = pushes.find(([k, on, t]) => k === 'nativeMenu.open' && on && t >= openedAt)?.[2] ?? Infinity;
    const blurBeforeMenu = pushes.some(([k, on, t]) => k === 'windowState.focused' && !on && t >= openedAt && t < firstOpen);
    const v = { toggleFocused, box, drawn, menuOpenedAt: firstOpen === Infinity ? null : firstOpen, blurBeforeMenu, ...(await windowFacts()) };
    results['tooltipUnderMenu'] = v;
    check('a menu-bar menu closes an open tooltip: none in the capture (pixels, R3-6)', box !== null && drawn !== null && drawn.pixels > 150 && drawn.share < 0.2 && firstOpen !== Infinity && !blurBeforeMenu, v);
    await s.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await setTheme(s.page, 'light');
  });

  await guard('보기 (sidebar hidden)', async () => {
    await runMenuCommand(s.app, 'view.toggleSidebar');
    await expect(s.page.getByTestId('shell')).toHaveAttribute('data-sidebar', 'hidden');
    results['menuViewHidden'] = await viewMenu('m3-09c-menu-view-hidden', '보기 menu open, sidebar hidden', '사이드바 보기', '전체 화면 시작');
  });
  if ((await s.page.getByTestId('shell').getAttribute('data-sidebar')) === 'hidden') await runMenuCommand(s.app, 'view.toggleSidebar');
  await expect(s.page.getByTestId('shell')).toHaveAttribute('data-sidebar', 'shown');

  // 보기 in full screen: the item says 전체 화면 종료 (a real ⌃⌘F in, and out again). R3-1: the round trip must bring the
  // window back to the frame it had, inside the work area (runs 39640208719 and 39642950406 came back 1440 wide, 416
  // pt off the left edge of the 1024-pt screen, and nothing checked it).
  const boundsNow = () =>
    s.app.evaluate(({ BrowserWindow, screen }) => {
      const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.webContents.getURL().includes('window=main'))!;
      const b = w.getBounds();
      return { bounds: b, workArea: screen.getDisplayMatching(b).workArea };
    });
  await guard('보기 in full screen', async () => {
    const isFull = async () => (await mainWindow(s.app)).evaluate((w) => w.isFullScreen());
    const before = await boundsNow();
    await nativeKeystroke(s.app, 'f', ['control', 'command']);
    await expect.poll(isFull, { timeout: 10_000 }).toBe(true);
    await sleep(1500); // the full-screen animation ends before menus open (M0: no toggling during the transition)
    results['menuViewFullScreen'] = await viewMenu('m3-09f-menu-view-fullscreen', '보기 menu open in full screen', '사이드바 가리기', '전체 화면 종료');
    // R3-5: full screen, sidebar hidden, nothing revealed at the top — the toolbar starts at the normal padding.
    await runMenuCommand(s.app, 'view.toggleSidebar');
    await expect(s.page.getByTestId('shell')).toHaveAttribute('data-sidebar', 'hidden');
    // The pointer leaves the top of the screen (the 보기 click above left it there, which keeps the menu bar and the
    // title strip with its lights revealed over the toolbar) for an empty spot of the content.
    const pointer = await movePointer(512, 620);
    await sleep(2500); // AppKit hides the menu bar and the strip after a moment
    const fsToolbar = await padding(s.page);
    const shot = await nativeWindowShot(s.app, 'm3-09h-fullscreen-sidebar-hidden', 'full screen, pointer away, sidebar hidden (no traffic lights, no 84 inset)', { focus: false });
    await fullScreenShot('m3-09h-fullscreen-sidebar-hidden', 'full screen, pointer away, sidebar hidden');
    const lights = shot.file ? redLightPixels(shot.file) : null;
    results['fullScreenHidden'] = { toolbar: fsToolbar, pointer, lights };
    check('full screen with the sidebar hidden: the toolbar starts at 12 (no lights to clear)', fsToolbar.left === 12, fsToolbar);
    check('full screen, pointer away: no traffic lights or title strip over the toolbar in the capture (R3-5)', lights === 0, results['fullScreenHidden']);
    await runMenuCommand(s.app, 'view.toggleSidebar');
    await expect(s.page.getByTestId('shell')).toHaveAttribute('data-sidebar', 'shown');
    await nativeKeystroke(s.app, 'f', ['control', 'command']);
    await expect.poll(isFull, { timeout: 10_000 }).toBe(false);
    await sleep(1500); // AppKit's restore, then ours
    const after = await boundsNow();
    await nativeWindowShot(s.app, 'm3-09g-after-fullscreen', 'after leaving full screen: the window back at its frame', { focus: false });
    await fullScreenShot('m3-09g-after-fullscreen', 'after leaving full screen');
    const b = after.bounds;
    const a = after.workArea;
    const inside = b.x >= a.x && b.y >= a.y && b.x + b.width <= a.x + a.width && b.y + b.height <= a.y + a.height;
    const same = JSON.stringify(before.bounds) === JSON.stringify(b);
    results['fullScreenRoundTrip'] = { before, after, same, inside };
    check('a full-screen round trip returns the window to its frame, inside the work area (R3-1)', same && inside, results['fullScreenRoundTrip']);
  });
  if (await (await mainWindow(s.app)).evaluate((w) => w.isFullScreen())) {
    await (await mainWindow(s.app)).evaluate((w) => w.setFullScreen(false));
    await sleep(2000);
  }
  // N4-3: the same round trip from a frame of the user's own (spec 2.1: back to the size and place it had before).
  await guard('full-screen round trip from a user frame', async () => {
    const isFull = async () => (await mainWindow(s.app)).evaluate((w) => w.isFullScreen());
    const restore = (await boundsNow()).bounds;
    await (await mainWindow(s.app)).evaluate((w) => w.setBounds({ x: 40, y: 65, width: 960, height: 604 }));
    await sleep(800); // past the 250 ms settle that notes the windowed frame
    const before = await boundsNow();
    await bringAppToFront(s.app);
    await nativeKeystroke(s.app, 'f', ['control', 'command']);
    await expect.poll(isFull, { timeout: 10_000 }).toBe(true);
    await sleep(1500);
    await nativeKeystroke(s.app, 'f', ['control', 'command']);
    await expect.poll(isFull, { timeout: 10_000 }).toBe(false);
    await sleep(1500);
    const after = await boundsNow();
    await fullScreenShot('m3-09i-after-fullscreen-user-frame', 'after a full-screen round trip from the frame (40,65,960×604)');
    const b = after.bounds;
    const a = after.workArea;
    const inside = b.x >= a.x && b.y >= a.y && b.x + b.width <= a.x + a.width && b.y + b.height <= a.y + a.height;
    const same = JSON.stringify(before.bounds) === JSON.stringify(b);
    results['fullScreenRoundTripUserFrame'] = { before, after, same, inside };
    check('a full-screen round trip from a user frame returns to it, inside the work area (N4-3)', same && inside && b.width === 960, results['fullScreenRoundTripUserFrame']);
    await (await mainWindow(s.app)).evaluate((w, r) => w.setBounds(r), restore);
    await sleep(800);
  });
  if (await (await mainWindow(s.app)).evaluate((w) => w.isFullScreen())) {
    await (await mainWindow(s.app)).evaluate((w) => w.setFullScreen(false));
    await sleep(2000);
  }
  // Task 8 polish minor 2: a zoomed window (the green button, 윈도우 › 확대/축소) is left to AppKit by the frame keeper:
  // ⌃⌘F twice brings it back zoomed, and un-zooming then gives back the frame it had before the zoom.
  await guard('a zoomed window comes back zoomed from full screen (polish minor 2)', async () => {
    const win = await mainWindow(s.app);
    const isFull = () => win.evaluate((w) => w.isFullScreen());
    const zoomed = () => win.evaluate((w) => w.isMaximized());
    const restore = (await boundsNow()).bounds;
    try {
      await win.evaluate((w) => w.setBounds({ x: 40, y: 65, width: 960, height: 604 })); // a user frame, smaller than the zoomed one
      await sleep(800);
      const userFrame = (await boundsNow()).bounds;
      await win.evaluate((w) => w.maximize()); // macOS: zoom
      await expect.poll(zoomed, { timeout: 5_000 }).toBe(true);
      await sleep(800);
      const before = { ...(await boundsNow()), zoomed: await zoomed() };
      await bringAppToFront(s.app);
      await nativeKeystroke(s.app, 'f', ['control', 'command']);
      await expect.poll(isFull, { timeout: 10_000 }).toBe(true);
      await sleep(1500);
      await nativeKeystroke(s.app, 'f', ['control', 'command']);
      await expect.poll(isFull, { timeout: 10_000 }).toBe(false);
      await sleep(1500);
      const after = { ...(await boundsNow()), zoomed: await zoomed() };
      await fullScreenShot('m3-09j-after-fullscreen-zoomed', 'after a full-screen round trip from a zoomed window: back zoomed');
      await win.evaluate((w) => w.unmaximize());
      await sleep(1000);
      const unzoomed = (await boundsNow()).bounds;
      const same = JSON.stringify(before.bounds) === JSON.stringify(after.bounds);
      results['fullScreenRoundTripZoomed'] = { userFrame, before, after, same, unzoomed };
      check('a zoomed window comes back zoomed from a full-screen round trip, at its zoomed frame (polish minor 2)', before.zoomed && after.zoomed && same, results['fullScreenRoundTripZoomed']);
      check('un-zooming after that round trip gives back the frame from before the zoom (polish minor 2)', JSON.stringify(unzoomed) === JSON.stringify(userFrame), results['fullScreenRoundTripZoomed']);
    } finally {
      // Whatever failed: out of full screen, not zoomed, back at the frame from before (bounded waits, never a throw).
      await leaveFullScreen(win);
      if (await zoomed().catch(() => false)) {
        await win.evaluate((w) => w.unmaximize()).catch(() => {});
        await sleep(800);
      }
      await win.evaluate((w, r) => w.setBounds(r), restore).catch(() => {});
      await sleep(800);
    }
  });

  // n5: AppKit adds items to 편집 too (dictation, emoji); see what it shows.
  await guard('편집 and 파일 menus', async () => {
    results['menuEdit'] = { ...(await captureOpenMenu(s.app, pid, 4, 'm3-12-menu-edit', '편집 menu open')), names: await menuItemNames(pid, 4) };
    results['menuFile'] = { names: await menuItemNames(pid, 3) };
    check('파일 says 윈도우 닫기 (n4)', ((results['menuFile'] as { names: string[] | null }).names ?? []).includes('윈도우 닫기'), results['menuFile']);
  });
  // R3-6: 윈도우 open — macOS 15 adds its own window items there; none of them may be a second full-screen command.
  await guard('윈도우 has no full-screen item', async () => {
    const captured = await captureOpenMenu(s.app, pid, 7, 'm3-17-menu-window', '윈도우 menu open');
    const names = [...(captured.keyboard.open.names ?? []), ...((await menuItemNames(pid, 7)) ?? [])];
    const fullScreen = names.filter((n) => /^(전체 화면( 시작| 종료)?|Enter Full Screen|Exit Full Screen|Toggle Full Screen)$/.test(n));
    results['menuWindow'] = { openNames: captured.keyboard.open.names, names: [...new Set(names)], fullScreen, shots: [captured.click.shot, captured.keyboard.shot] };
    check('윈도우 has no full-screen item (R3-6)', names.length > 0 && fullScreen.length === 0, results['menuWindow']);
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

// Task 10: ⌘, opens the settings window over the main window, which is then neither key nor main (design-spec 6 설정 창:
// grey traffic lights, neutral selection; no ring or keyboard cursor, R2-2; dimmed chrome, R2-3). Light, then dark.
test('M3 chrome: ⌘, settings window over the main window, light and dark', TAG, async () => {
  // Two themes, two real sheets, a full-screen round trip: about 60 s, more on a degraded path (AX, screencapture).
  test.setTimeout(300_000);
  const settingsWindow = () =>
    s.app.evaluateHandle(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.getURL().includes('window=settings'))!);
  for (const theme of ['light', 'dark'] as const) {
    const shotName = theme === 'light' ? 'm3-15-settings' : 'm3-15b-settings-dark';
    await guard(`${shotName}: the settings window over a main window that is neither key nor main`, async () => {
      await setTheme(s.page, theme);
      if (IS_MAC) await bringAppToFront(s.app).catch(() => {});
      let via = 'menu';
      const settings = await expectWindow(s.app, 'settings', async () => {
        if (!IS_MAC) return runMenuCommand(s.app, 'app.settings');
        try {
          await nativeKeystroke(s.app, ',', ['command']);
          via = 'keystroke';
        } catch (e) {
          if (!(e instanceof NativeInputNotPermitted)) throw e;
          await runMenuCommand(s.app, 'app.settings');
        }
      });
      try {
        await expect.poll(async () => (await settingsWindow()).evaluate((w) => w.isVisible()), { timeout: 5_000 }).toBe(true);
        await (await settingsWindow()).evaluate((w) => w.focus()); // key already after ⌘, on macOS; Xvfb has no window manager
        await expect(s.page.locator('html')).toHaveAttribute('data-window-not-main', '', { timeout: 5_000 }).catch(() => {});
        await s.page.waitForTimeout(600); // AppKit repaints the main window's lights and material as inactive
        const chrome = await mainChrome();
        const navRow = await s.page.getByTestId('nav-library').evaluate((el) => getComputedStyle(el).backgroundColor);
        const accent = await s.page.evaluate(() => {
          const p = document.createElement('span');
          document.body.append(p);
          p.style.color = 'var(--accent)';
          const c = getComputedStyle(p).color;
          p.remove();
          return c;
        });
        const page = await settings.evaluate(() => ({ title: document.title, width: innerWidth, notKey: document.documentElement.hasAttribute('data-window-inactive') }));
        const bounds = await (await mainWindow(s.app)).evaluate((w) => w.getBounds());
        const scale = await s.app.evaluate(({ screen }) => screen.getPrimaryDisplay().scaleFactor);
        const shot = await fullScreenShot(shotName, `⌘, settings window (${theme}) over the main window: grey lights, neutral selection, dimmed chrome`);
        // The main window's close button in the screen capture (its centre is 25, 26 in the window, Task 8).
        const closeButton = shot.file ? ((await pngPixels(s.page, shot.file, [[Math.round((bounds.x + 25) * scale), Math.round((bounds.y + 26) * scale)]]))[0] ?? null) : null;
        const v = { via, settings: page, chrome, navRow, accent, closeButton, bounds, scale, ...(await windowFacts()) };
        results[theme === 'light' ? 'settings' : 'settingsDark'] = v;
        check(`${shotName}: ⌘, opens the settings window, 600 wide, titled 설정, key${IS_MAC ? ' (a real keystroke)' : ''}`, page.width === 600 && page.title === '설정' && !page.notKey && (!IS_MAC || via === 'keystroke'), v);
        check(
          `${shotName}: the main window under it is neither key nor main — no ring or cursor, neutral selection, dimmed chrome${IS_MAC ? ', grey lights' : ''}`,
          chromeDimmed(chrome) && chrome.cursor === 'none' && navRow !== accent && (!IS_MAC || isGrey(closeButton)),
          v,
        );
      } finally {
        await settings.close();
        if (IS_MAC) await bringAppToFront(s.app).catch(() => {});
        else await (await mainWindow(s.app)).evaluate((w) => w.focus());
        await expect(s.page.locator('html')).not.toHaveAttribute('data-window-inactive', '', { timeout: 5_000 }).catch(() => {});
      }
    });
  }
  await setTheme(s.page, 'light');
  if (!IS_MAC) return void save();
  const pid = s.app.process().pid!;
  /** The settings window's page: key (no data-window-inactive) and main (no data-window-not-main). */
  const settingsState = (page: Page) =>
    page.evaluate(() => ({ notKey: document.documentElement.hasAttribute('data-window-inactive'), notMain: document.documentElement.hasAttribute('data-window-not-main') }));
  /** The app in front with the settings window key (not the main window: a sheet on 설정 must get the next esc). */
  const settingsToFront = () =>
    s.app
      .evaluate(({ app, BrowserWindow }) => {
        app.focus({ steal: true });
        BrowserWindow.getAllWindows()
          .find((w) => !w.isDestroyed() && w.webContents.getURL().includes('window=settings'))
          ?.focus();
      })
      .catch(() => {});
  const closeSettings = async (page: Page) => {
    await page.close().catch(() => {});
    await expect.poll(() => s.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.webContents.getURL().includes('window=settings'))), { timeout: 5_000 }).toBe(false).catch(() => {});
  };

  // Task 10 carry-forward: the settings window's own dialogs hang on it as sheets (asSheet): the folder panel, and the
  // restart confirmation once a folder is picked. Real AppKit panels, captured, then cancelled with a real esc, which
  // System Events sends to the key window (the sheet) without bringing the main window forward. Nothing is relaunched.
  await guard('settings sheets: the folder panel and the restart confirmation hang on the settings window (Task 10)', async () => {
    await bringAppToFront(s.app).catch(() => {});
    const settings = await expectWindow(s.app, 'settings', () => runMenuCommand(s.app, 'app.settings'));
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-m3-other-library-'));
    const before = await s.page.evaluate(() => window.learn.app.info().then((r) => (r.ok ? r.data.libraryRoot : null)));
    const outcome: Record<string, unknown> = { libraryRootBefore: before };
    try {
      await expect.poll(async () => (await settingsWindow()).evaluate((w) => w.isVisible()), { timeout: 5_000 }).toBe(true);
      // The real panel: importFiles earlier in this session stubbed the open dialog with a PDF (Mac run 39779536146:
      // 다른 폴더 선택… got the PDF, refused it as not a folder, and no panel showed).
      await restoreOpenDialog(s.app);
      outcome['realPanel'] = await s.app.evaluate(({ dialog }) => {
        const g = globalThis as { __learnRealOpenDialog?: typeof dialog.showOpenDialog };
        return g.__learnRealOpenDialog === undefined || dialog.showOpenDialog === g.__learnRealOpenDialog;
      });
      await sleep(600);
      /** One dialog through the 다른 폴더 선택… button: it must show as a sheet of 설정, and a real esc must cancel it. */
      const asSheet = async (name: string, what: string) => {
        await settings.getByTestId('library-choose').click();
        const t0 = Date.now();
        let shown = await hasSheet(pid, '설정');
        while (shown !== true && Date.now() - t0 < 8_000) {
          await sleep(250);
          shown = await hasSheet(pid, '설정');
        }
        const shownMs = shown ? Date.now() - t0 : null;
        await sleep(700); // the sheet's slide-in
        const under = await settingsState(settings);
        const shot = await fullScreenShot(name, what);
        const esc = await pressEscape();
        const t1 = Date.now();
        let gone = (await hasSheet(pid, '설정')) === false;
        while (!gone && Date.now() - t1 < 5_000) {
          await sleep(250);
          gone = (await hasSheet(pid, '설정')) === false;
        }
        // Review M1: a real panel can raise a system prompt (folder access through TCC, UserNotificationCenter,
        // CoreServicesUIAgent …) that takes the key, and the esc went to it. Name it, dismiss it once with a bounded
        // esc, put the key back on the settings window and try the sheet's esc once more, so the next step starts
        // from a known state.
        const front = (() => {
          try {
            return frontmostProcess();
          } catch {
            return null;
          }
        })();
        let foreignFront: string | null = null;
        if (front && front.pid !== pid) {
          foreignFront = front.name;
          await pressEscape(); // bounded (10 s): System Events sends it to that process, the frontmost
          await sleep(500);
          await settingsToFront();
          await sleep(500);
          if (!gone) {
            await pressEscape();
            const t2 = Date.now();
            while (!gone && Date.now() - t2 < 3_000) {
              await sleep(250);
              gone = (await hasSheet(pid, '설정')) === false;
            }
          }
        }
        // Back to an active settings window, as after any sheet (38e3a9e).
        await expect.poll(() => settingsState(settings).then((v) => !v.notKey && !v.notMain), { timeout: 2_000 }).toBe(true).catch(() => {});
        return {
          shown: shown === true,
          shownMs,
          underSheet: under,
          shot: shot.file,
          escape: esc.ok,
          gone,
          after: await settingsState(settings),
          frontmostAfterEsc: front?.name ?? null,
          ...(foreignFront ? { foreignFront, note: `${foreignFront} was in front after the esc: dismissed with one esc, the key put back on 설정` } : {}),
        };
      };
      outcome['folder'] = await asSheet('m3-15c-settings-folder-sheet', 'settings: the 다른 폴더 선택… panel as a sheet on the settings window');
      // The restart confirmation comes only after a folder is picked: the panel answers with an empty folder.
      await stubOpenDialog(s.app, [scratch]);
      outcome['restart'] = await asSheet('m3-15d-settings-restart-sheet', 'settings: the restart confirmation as a sheet on the settings window');
      outcome['relaunchRequested'] = await s.app.evaluate(() => (globalThis as { __learnRelaunchRequested?: boolean }).__learnRelaunchRequested ?? false);
      outcome['libraryRootAfter'] = await s.page.evaluate(() => window.learn.prefs.get().then((r) => (r.ok ? (r.data.libraryRoot ?? null) : 'error')));
      results['settingsSheets'] = outcome;
      for (const kind of ['folder', 'restart'] as const) {
        const v = outcome[kind] as { shown: boolean; underSheet: { notMain: boolean }; gone: boolean; after: { notKey: boolean; notMain: boolean } };
        check(
          `settings: the ${kind === 'folder' ? 'folder panel' : 'restart confirmation'} is a sheet on the settings window, which stays main under it; a real esc cancels it and the window is active again (Task 10)`,
          v.shown && !v.underSheet.notMain && v.gone && !v.after.notKey && !v.after.notMain,
          v,
        );
      }
      check('settings: cancelling both sheets relaunches nothing and keeps the library location (Task 10)', outcome['relaunchRequested'] === false && outcome['libraryRootAfter'] === null, outcome);
    } finally {
      await restoreOpenDialog(s.app).catch(() => {});
      // A sheet that esc did not dismiss would keep the settings window open: take it down with its window.
      if ((await hasSheet(pid, '설정')) === true) {
        await pressEscape();
        await sleep(500);
        if ((await hasSheet(pid, '설정')) === true) await (await settingsWindow()).evaluate((w) => w.destroy()).catch(() => {});
      }
      await closeSettings(settings);
      fs.rmSync(scratch, { recursive: true, force: true });
      await bringAppToFront(s.app).catch(() => {});
    }
  });

  // Task 10 carry-forward: ⌘, while the main window is in full screen. The settings window must open where the user is
  // (on the full-screen Space, over the main window), not on a desktop Space out of sight. Everything after the first
  // key is inside the try: whatever fails (the window never shows, a poll runs out mid-transition), the finally closes
  // the settings window, leaves full screen and waits for the main window back at its frame, so the later tests (the
  // restart, the tall ⌘/ parent) never start from a full-screen window. A failure is the check failing, with a note.
  await guard('⌘, in full screen (Task 10)', async () => {
    const NAME = '⌘, in full screen: the settings window opens visible on the full-screen Space, key, inside the screen, and the main window stays in full screen (Task 10)';
    const win = await mainWindow(s.app);
    const isFull = () => win.evaluate((w) => w.isFullScreen());
    const frame = await win.evaluate((w) => w.getBounds());
    const v: Record<string, unknown> = { frameBefore: frame };
    results['settingsInFullScreen'] = v;
    let stage = 'enter full screen';
    let settings: Page | null = null;
    /** The two windows as main sees them, whether the settings window is on screen in this Space, and a capture. */
    const observe = async () => {
      const facts = await s.app.evaluate(({ BrowserWindow, screen }) => {
        const all = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
        const of = (kind: string) => all.find((w) => w.webContents.getURL().includes(`window=${kind}`));
        const set = of('settings');
        const main = of('main');
        return {
          settings: set ? { bounds: set.getBounds(), visible: set.isVisible(), focused: set.isFocused() } : null,
          main: main ? { bounds: main.getBounds(), fullScreen: main.isFullScreen() } : null,
          display: screen.getPrimaryDisplay().bounds,
        };
      });
      const onScreen = facts.settings ? await windowOnScreen(await cgWindowId(s.app, 'settings')) : null;
      const shot = await fullScreenShot('m3-15e-settings-over-fullscreen', '⌘, while the main window is in full screen: the settings window over it');
      const b = facts.settings?.bounds;
      const d = facts.display;
      const inside = !!b && b.x >= d.x && b.y >= d.y && b.x + b.width <= d.x + d.width && b.y + b.height <= d.y + d.height;
      return { ...facts, onScreen, inside, shot: shot.file, frontmost: frontmostProcess().name };
    };
    try {
      await bringAppToFront(s.app);
      await nativeKeystroke(s.app, 'f', ['control', 'command']);
      await expect.poll(isFull, { timeout: 10_000 }).toBe(true);
      await sleep(1500);
      stage = '⌘, opens the settings window';
      let via = 'keystroke';
      settings = await expectWindow(s.app, 'settings', async () => {
        try {
          await nativeKeystroke(s.app, ',', ['command']);
        } catch (e) {
          if (!(e instanceof NativeInputNotPermitted)) throw e;
          via = 'menu';
          await runMenuCommand(s.app, 'app.settings');
        }
      });
      stage = 'the settings window over full screen';
      await sleep(1200); // a Space change, if AppKit makes one, ends
      const seen = await observe();
      Object.assign(v, { via, ...seen, page: await settingsState(settings) });
      check(NAME, via === 'keystroke' && seen.settings?.visible === true && seen.settings.focused && seen.onScreen === true && seen.inside && seen.main?.fullScreen === true, v);
    } catch (e) {
      // What there was to see when it failed (a settings window on another Space, or none): the facts and a capture.
      const seen = await observe().catch((err: unknown) => ({ observeError: errorText(err) }));
      Object.assign(v, { error: errorText(e), notPermitted: e instanceof NativeInputNotPermitted, note: `failed at: ${stage}`, ...seen });
      check(NAME, false, v);
    } finally {
      if (settings) await closeSettings(settings);
      // A settings window that showed after expectWindow gave up has no page handle here: close it by its window.
      await s.app
        .evaluate(({ BrowserWindow }) => {
          for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed() && w.webContents.getURL().includes('window=settings')) w.close();
        })
        .catch(() => {});
      await bringAppToFront(s.app).catch(() => {});
      const out = await leaveFullScreen(win);
      const backAtFrame = await expect
        .poll(() => win.evaluate((w) => JSON.stringify(w.getBounds())).catch(() => ''), { timeout: 5_000 })
        .toBe(JSON.stringify(frame))
        .then(() => true, () => false);
      v['cleanup'] = { outOfFullScreen: out, backAtFrame, frameAfter: await win.evaluate((w) => w.getBounds()).catch(() => null) };
    }
  });
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
  // R2-6e, R3-3, R3-6: Finder's own window as the reference for the inactive look — a window opened at Downloads (its
  // sidebar row selected), active and inactive, light and dark (the system appearance is switched on CI only).
  // Measured per element on Finder's fixed layout; a value is a solid colour only if ≥ 20 pixels sit at the extreme.
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
        toolbarFill: regionStats(img, { x0: 200, y0: 2, x1: w - 10, y1: 50 }).surface,
        title: elementStats(img, { x0: 230, y0: 12, x1: 340, y1: 38 }),
        toolbarGlyphs: elementStats(img, { x0: 580, y0: 12, x1: 628, y1: 38 }),
        sectionHeader: elementStats(img, { x0: 14, y0: 55, x1: 70, y1: 70 }),
        rowText: elementStats(img, { x0: 38, y0: 77, x1: 118, y1: 122 }),
        rowIcons: elementStats(img, { x0: 14, y0: 77, x1: 36, y1: 122 }),
        selectedRow: selectionBand(img, { x0: 8, y0: 52, x1: 150, y1: h - 10 }),
      };
    };
    const finderFront = async () => {
      await bringFinderToFront();
      await sleep(700);
    };
    const appFront = async () => {
      await bringAppToFront(s.app);
      await sleep(700);
    };
    const appearance = (dark: boolean) =>
      tryExec('osascript', ['-e', `tell application "System Events" to tell appearance preferences to set dark mode to ${dark}`], 20_000);
    osascript('tell application "Finder" to make new Finder window to (path to downloads folder)');
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

// Critic T12-m1 on a parent that matters: a 1440 × 900 Mac with the Dock leaves a window ≈ 806 tall, where the ⌘/
// sheet's content (≈ 743) fits under the darwin clamp (room − 2 × 16) and must not scroll. The runner's 1024 × 768
// screen allows a parent only as tall as its work area (≈ 684, measured too). For the 806 case the main screen is
// switched to the mode the demo records in (displayplacer, display-mac.ts) when the runner offers one, and put back
// right after. It runs last, so no other check measures the switched screen.
test("M3 chrome: the ⌘/ sheet in a parent as tall as a 1440 × 900 Mac's work area (T12-m1)", TAG, async () => {
  // A display switch and its restore (displayplacer calls of up to 30 s each, 10 s polls) around two sheets.
  test.setTimeout(300_000);
  test.skip(!IS_MAC, 'the darwin clamp: Linux runs its own formula in the sheets test above');
  const TALL = 806;
  const out: Record<string, unknown> = {};
  results['shortcutSheetTall'] = out;
  // Everything inside guards: a throw here must not skip the verdict below (serial mode).
  await guard('the ⌘/ sheet with a tall parent: setup (T12-m1)', async () => {
    const win = await mainWindow(s.app);
    const restore = await win.evaluate((w) => w.getBounds());
    /** The main window as tall as `TALL` or the work area allows, 1440 wide or the work area's width, at its top. */
    const tallest = async () => {
      const workArea = await s.app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea);
      const width = Math.min(1440, workArea.width);
      const height = Math.min(TALL, workArea.height);
      await win.evaluate((w, b) => w.setBounds(b), { x: workArea.x + Math.floor((workArea.width - width) / 2), y: workArea.y, width, height });
      await sleep(800);
      return { workArea, window: await win.evaluate((w) => w.getBounds()) };
    };
    const measure = async (label: string, what: string) => {
      await bringAppToFront(s.app).catch(() => {});
      const keys = await expectWindow(s.app, 'sheet', () => runMenuCommand(s.app, 'app.shortcuts'));
      try {
        await s.page.waitForTimeout(800); // the sheet's slide-in
        const fit = await shortcutSheetFit(keys);
        const shot = await fullScreenShot(`m3-08b-sheet-shortcuts-${label}`, what);
        return { ...fit, shot: shot.file };
      } finally {
        await closeSheet(keys, 'Escape');
        await expect.poll(() => menuItemEnabled(s.app, 'app.shortcuts'), { timeout: 5_000 }).toBe(true);
      }
    };
    await guard('the ⌘/ sheet in the tallest parent the runner screen allows (T12-m1)', async () => {
      const frame = await tallest();
      const fit = await measure('runner', `⌘/ sheet over the tallest main window the runner screen allows (${frame.window.height} pt)`);
      out['runner'] = { ...frame, fit };
      check('the ⌘/ sheet in the tallest parent the runner screen allows is as tall as the darwin room allows (T12-m1)', fit.sheet.height === fit.expected, out['runner']);
    });
    const display = await switchDisplayForDemo();
    out['display'] = display.result;
    try {
      if (display.result.status === 'switched' || display.result.status === 'current') {
        await guard(`the ⌘/ sheet in a ${TALL} pt parent (T12-m1)`, async () => {
          const frame = await tallest();
          const fit = await measure(String(TALL), `⌘/ sheet over a ${frame.window.height} pt main window (a 1440 × 900 Mac with the Dock leaves ≈ ${TALL})`);
          out['tall'] = { ...frame, fit };
          if (fit.parent.height < TALL) {
            out['tallNote'] = `the switched screen leaves only ${fit.parent.height} pt: the ${TALL} pt case stays a manual check`;
            check('the ⌘/ sheet in the tallest parent the switched screen allows is as tall as the darwin room allows (T12-m1)', fit.sheet.height === fit.expected, out['tall']);
          } else {
            // centreOffset is recorded, not judged: AppKit places the sheet (sheets.ts sets no offset).
            check(`the ⌘/ sheet in a ${TALL} pt parent shows its whole content, with no scrolling (T12-m1)`, fit.sheet.height === fit.expected && !fit.scrolls, out['tall']);
          }
        });
      } else {
        out['tallNote'] = `no display mode for a ${TALL} pt parent (${display.result.status}): the ${TALL} pt case stays a manual check`;
      }
    } finally {
      await display.restore();
      await win.evaluate((w, b) => w.setBounds(b), restore).catch(() => {});
      await sleep(800);
    }
  });
  save();
});

test('M3 chrome: verdict of every check above (m3-shell.json checks)', TAG, async () => {
  save();
  for (const [name, c] of Object.entries(checks)) expect.soft(c.ok, `${name}: ${JSON.stringify(c.value)}`).toBe(true);
});
