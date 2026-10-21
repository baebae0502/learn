// @evidence — M3 window chrome on macOS: traffic lights in the 52 px bar, sidebar vibrancy, hidden title bar,
// Korean menu bar, sheets under the toolbar, real accelerators and keys, window state. Linux CI runs it with captures
// skipped.
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
  launch, mainWindow, menuItemEnabled, menuSnapshot, nativeKeyCode, nativeKeystroke, openItem, runMenuCommand, stubContextMenu, type Session,
} from '../e2e/helpers';
import { themeHex } from '../../apps/desktop/src/renderer/src/design/tokens.generated';
import { IS_MAC, allShots, captureOpenMenu, fullScreenShot, nativeWindowShot, platformFonts, pngCentroid, pngPixels, writeJson } from './capture';

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
  const closedEvent = new Promise<true>((resolve) => sheet.once('close', () => resolve(true)));
  let note: string | undefined;
  let focusedBefore: string | null = null;
  let sentAt = 0;
  try {
    focusedBefore = (await nativeKeyCode(s.app, code, [], { window: 'sheet' })).focusedWindow ?? null;
    sentAt = Date.now();
  } catch (e) {
    note = errorText(e);
  }
  // Up to 5 s from the key (bringing the app to the front before it can take a few seconds on the runner).
  const ok = sheet.isClosed() || (note === undefined && (await Promise.race([closedEvent, sleep(5_000).then(() => false)])));
  const ms = ok && sentAt ? Date.now() - sentAt : null;
  if (!ok && !sheet.isClosed()) await closeSheet(sheet, fallback); // the run goes on; the check fails
  return { native: note === undefined, closed: ok, ms, focusedBefore, ...(note ? { note } : {}) };
}

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-m3-'));
  s = await launch(path.join(tmp, 'library'), path.join(tmp, 'userdata'));
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
    results['trafficLights'] = { red, green, devicePixelsPerPoint: px, expect: { redCentre: [24, 26], greenRightEdgeBelow: 84 } };
    check('close button found', red !== null, red);
    if (red) check('close button centred in the 52 px bar (y 26 ± 1.5)', Math.abs(red.y / px - 26) <= 1.5, { y: red.y / px, x: red.x / px });
    if (green) check('lights inside the 84 px inset', green.x / px + 6 < 84, { greenX: green.x / px });
  }
  save();
});

test('M3 chrome: library light/dark and vibrancy on/off', TAG, async () => {
  await importPaths(s.page, [PDF, MP4, MPEG4]);
  await expect(s.page.getByTestId('item-row')).toHaveCount(3);
  const [, light] = await allShots(s.app, s.page, 'm3-02-library-light', 'library, light');
  await s.page.evaluate(() => window.learn.prefs.set({ theme: 'dark' }));
  await s.page.waitForTimeout(500);
  await allShots(s.app, s.page, 'm3-03-library-dark', 'library, dark');
  await s.page.evaluate(() => window.learn.prefs.set({ theme: 'light' }));
  await s.page.waitForTimeout(500);
  if (IS_MAC && light?.file) {
    // A second, throwaway profile (R-5): `tmp` must keep pointing at the main session for the restart test below.
    // The main window is hidden meanwhile: both windows open at the same place, and Chromium stops drawing an occluded
    // window, whose capture is then the bare window background (run 39617644850: a blank opaque capture).
    const main = await mainWindow(s.app);
    await main.evaluate((w) => w.hide());
    const opaqueDir = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-m3-opaque-'));
    try {
      const opaque = await launch(path.join(opaqueDir, 'library'), path.join(opaqueDir, 'userdata'), { env: { LEARN_VIBRANCY: '0' } });
      try {
        await importPaths(opaque.page, [PDF, MP4, MPEG4]);
        await expect(opaque.page.getByTestId('item-row')).toHaveCount(3);
        await expect.poll(() => opaque.page.evaluate(() => document.visibilityState)).toBe('visible');
        await opaque.page.waitForTimeout(500);
        const shot = await nativeWindowShot(opaque.app, 'm3-02-library-light-opaque', 'library, light, LEARN_VIBRANCY=0');
        if (shot.file) {
          const points = [[120, 500], [700, 500]] as const; // sidebar, content (points; runner is 1x)
          const [withVib, without] = [await pngPixels(s.page, light.file, points), await pngPixels(s.page, shot.file, points)];
          const delta = (a: readonly number[], b: readonly number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i]!)));
          const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
          const token = { sidebar: rgb(themeHex.light.bgSidebar), content: rgb(themeHex.light.bgContent) };
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
  await runMenuCommand(s.app, 'view.toggleSidebar');
  await expect(s.page.getByTestId('shell')).toHaveAttribute('data-sidebar', 'hidden');
  await allShots(s.app, s.page, 'm3-04-collapsed', 'sidebar hidden: traffic lights over the toolbar, 84 px inset');
  const folded = await padding(s.page);
  results['collapsedToolbar'] = folded;
  check(`collapsed toolbar left padding ${IS_MAC ? 84 : 12}`, folded.left === (IS_MAC ? 84 : 12), folded);
  await runMenuCommand(s.app, 'view.toggleSidebar');
  await expect(s.page.getByTestId('shell')).toHaveAttribute('data-sidebar', 'shown');

  // f. Reader open latency (report only): from the click to the reader or notice, timed in the page.
  const latency: Record<string, unknown> = {};
  latency['pdf'] = await timedOpen(s.page, 'sample', '[data-testid="pdf-canvas"]');
  await expect(s.page.getByTestId('pdf-canvas')).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
  await allShots(s.app, s.page, 'm3-05-pdf', 'PDF in the new chrome');
  await runMenuCommand(s.app, 'nav.back');
  latency['unplayable'] = await timedOpen(s.page, 'sample-mpeg4part2', '[data-testid="video-error"]');
  await expect(s.page.getByTestId('video-error')).toBeVisible();
  await allShots(s.app, s.page, 'm3-06-codec', 'unplayable video notice');
  await runMenuCommand(s.app, 'nav.back');
  results['openLatencyMs'] = latency;
  save();

  // b. Real ↩ on the duplicate sheet runs its default button, 건너뛰기: the sheet closes, nothing is added, the import ends.
  const rows = s.page.getByTestId('item-row');
  const dup = await expectWindow(s.app, 'sheet', () => importFiles(s, [PDF]));
  await s.page.waitForTimeout(800); // sheet slide-in
  await fullScreenShot('m3-07-sheet-duplicate', 'duplicate sheet attached under the toolbar');
  await guard('real ↩ on the duplicate sheet skips', async () => {
    const r = await closeSheetNatively(dup, KEY_CODE.return, 'Escape');
    await expect.poll(() => menuItemEnabled(s.app, 'file.importManaged'), { timeout: 5_000 }).toBe(true);
    const outcome = { ...r, rows: await rows.count(), libraryShown: await s.page.getByTestId('library-table').isVisible() };
    results['sheetReturn'] = outcome;
    check('real ↩ on the duplicate sheet skips', IS_MAC ? r.native && r.closed && outcome.rows === 3 && outcome.libraryShown : outcome.rows === 3, outcome);
  });
  // b. Real esc closes the shortcut sheet.
  const keys = await expectWindow(s.app, 'sheet', () => runMenuCommand(s.app, 'app.shortcuts'));
  await s.page.waitForTimeout(800);
  await fullScreenShot('m3-08-sheet-shortcuts', '⌘/ shortcut sheet');
  await guard('real esc closes the shortcut sheet', async () => {
    const r = await closeSheetNatively(keys, KEY_CODE.escape, 'Escape');
    await expect.poll(() => menuItemEnabled(s.app, 'app.shortcuts'), { timeout: 5_000 }).toBe(true);
    results['sheetEscape'] = r;
    check('real esc closes the shortcut sheet', IS_MAC ? r.native && r.closed : r.closed, r);
  });
  save();
});

test('M3 chrome: Korean menu bar and the open 보기 menu', TAG, async () => {
  results['menu'] = (await menuSnapshot(s.app)).map((m) => m.label);
  if (IS_MAC) results['menuView'] = await captureOpenMenu(s.app, 'Electron', 5, 'm3-09-menu-view', '보기 menu open');
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
    await nativeWindowShot(s.app, 'm3-10-soft-disabled-focus', 'PDF page 1: 이전 쪽 disabled with a reason, keyboard focus ring');
    const after = await ring();
    results['softDisabledFocus'] = { before, afterWindowShot: after };
    check('soft-disabled focus ring at full strength', before.focusVisible && before.outline.startsWith('solid') && before.opacity === '1' && after.focusVisible, { before, after });
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
    const fatal = await launch(lib, path.join(dir, 'userdata'));
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
  await bringAppToFront(s.app).catch(() => {});
  save();
});

test('M3 chrome: window bounds survive a restart on macOS', TAG, async () => {
  const lib = path.join(tmp, 'library');
  const ud = path.join(tmp, 'userdata');
  // Bounds that fit the display's work area (run 39617644850 asked for 1000 wide at x 40 on the 1024-wide runner, and
  // the restore moved it to x 24 to keep it on screen); what is restored is compared with the bounds before closing.
  const workArea = await s.app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea);
  const bounds = { x: workArea.x + 40, y: workArea.y + 40, width: Math.min(1000, workArea.width - 80), height: Math.min(640, workArea.height - 80) };
  await (await mainWindow(s.app)).evaluate((w, b) => w.setBounds(b), bounds);
  await s.page.waitForTimeout(1500);
  const beforeClose = await (await mainWindow(s.app)).evaluate((w) => w.getBounds());
  await s.app.close();
  s = await launch(lib, ud);
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
