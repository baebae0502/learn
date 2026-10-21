// Layout B shell (design-spec 2.1, 2.3): fixed sidebar top, shared width, resize/collapse/persist, auto-fold.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { Channels } from '../../packages/domain/src/ipc-channels';
import { FIXTURES, importPaths, launch, mainWindow, openItem, runMenuCommand } from './helpers';

const PDF = path.join(FIXTURES, 'sample.pdf');
const MP4 = path.join(FIXTURES, 'sample-h264-aac.mp4');

const box = async (page: Page, testId: string) => {
  const b = await page.getByTestId(testId).first().boundingBox();
  if (!b) throw new Error(`${testId} has no box`);
  return b;
};
const sidebarWidth = async (page: Page) => Math.round((await box(page, 'sidebar')).width);
const dirs = (testInfo: { outputPath(...p: string[]): string }) => [testInfo.outputPath('library'), testInfo.outputPath('userdata')] as const;
const zoom = (app: ElectronApplication, f: number) => app.evaluate(({ BrowserWindow }, f) => BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(f), f);
/** The stored layout.panes setting (null while nothing was ever saved), read after the 300 ms save debounce. */
const savedPanes = async (page: Page): Promise<unknown> => {
  await page.waitForTimeout(600);
  return page.evaluate(async () => {
    const r = await window.learn.settings.get({ key: 'layout.panes' });
    if (!r.ok) throw new Error(`settings.get failed: ${r.code}`);
    return r.data;
  });
};
/** Replace one IPC handler in main with a canned reply (then reload the window to boot against it). */
const stubHandler = (app: ElectronApplication, channel: string, reply: unknown) =>
  app.evaluate(({ ipcMain }, [channel, reply]) => {
    ipcMain.removeHandler(channel as string);
    ipcMain.handle(channel as string, () => reply);
  }, [channel, reply] as const);

test('layout B: full-height 240 px sidebar, 52 px bars, navigator from y 88', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    expect(await sidebarWidth(page)).toBe(240);
    expect((await box(page, 'sidebar')).height).toBe(await page.evaluate(() => innerHeight));
    expect((await box(page, 'sidebar-top')).height).toBe(52);
    expect(await box(page, 'toolbar')).toMatchObject({ x: 240, y: 0, height: 52 });
    expect(Math.round((await page.locator('.sidebar .section-label').boundingBox())!.y)).toBe(88);
    await expect(page.getByTestId('toolbar-title')).toHaveText('내 라이브러리');
    // The boundary line is the sidebar's last column: the toggle sits 12 and the row fill 8 inside it (mockup border-right).
    const right = async (testId: string) => {
      const b = await box(page, testId);
      return b.x + b.width;
    };
    expect(await right('sidebar-toggle')).toBe(240 - 13);
    expect(await right('nav-library')).toBe(240 - 9);
  } finally {
    await app.close();
  }
});

test('⌃⌘S hides and shows the sidebar; the toolbar takes the toggle while it is hidden', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await runMenuCommand(app, 'view.toggleSidebar');
    await expect.poll(() => sidebarWidth(page)).toBe(0);
    await expect(page.getByTestId('shell')).toHaveAttribute('data-sidebar', 'hidden');
    expect((await box(page, 'toolbar')).x).toBe(0);
    await page.getByTestId('toolbar-sidebar-toggle').click();
    await expect.poll(() => sidebarWidth(page)).toBe(240);
    await expect(page.getByTestId('toolbar-sidebar-toggle')).toHaveCount(0);
    await expect(page.getByTestId('sidebar-toggle')).toHaveAttribute('aria-expanded', 'true');
  } finally {
    await app.close();
  }
});

test('keyboard: the toggle that takes over keeps the focus; the resize handle is named after the sidebar', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await page.getByTestId('sidebar-toggle').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('shell')).toHaveAttribute('data-sidebar', 'hidden');
    await expect(page.getByTestId('toolbar-sidebar-toggle')).toBeFocused();
    await page.keyboard.press('Space');
    await expect(page.getByTestId('shell')).toHaveAttribute('data-sidebar', 'shown');
    await expect(page.getByTestId('sidebar-toggle')).toBeFocused();
    await expect(page.getByRole('separator')).toHaveAccessibleName('사이드바');
  } finally {
    await app.close();
  }
});

test('⌃⌘S with the focus inside the sidebar hands it to the toolbar toggle', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await page.getByTestId('nav-library').focus();
    await expect(page.getByTestId('nav-library')).toBeFocused();
    await runMenuCommand(app, 'view.toggleSidebar');
    await expect(page.getByTestId('shell')).toHaveAttribute('data-sidebar', 'hidden');
    await expect(page.getByTestId('toolbar-sidebar-toggle')).toBeFocused();
    await runMenuCommand(app, 'view.toggleSidebar');
    await expect(page.getByTestId('shell')).toHaveAttribute('data-sidebar', 'shown');
    await expect(page.getByTestId('sidebar-toggle')).toBeFocused();
  } finally {
    await app.close();
  }
});

test('arrow keys on the separator: 5 % steps clamped at 360 and 180, one more step collapses (aria-valuenow follows)', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  const separator = page.getByRole('separator');
  const aria = async (name: 'aria-valuenow' | 'aria-valuemax') => Number(await separator.getAttribute(name));
  try {
    const groupWidth = await page.evaluate(() => innerWidth);
    const step = groupWidth * 0.05; // 72 px at 1440 (Linux), 51.2 on the 1024 px macOS runner
    const percent = (px: number) => (px / groupWidth) * 100;
    let expected = 240;
    const press = async (key: 'ArrowLeft' | 'ArrowRight') => {
      await page.keyboard.press(key);
      expected = Math.min(360, Math.max(180, expected + (key === 'ArrowRight' ? step : -step)));
      await expect.poll(async () => Math.abs((await sidebarWidth(page)) - expected)).toBeLessThanOrEqual(1);
      await expect.poll(async () => Math.abs((await aria('aria-valuenow')) - percent(expected))).toBeLessThan(0.1);
    };
    await separator.focus();
    expect(await aria('aria-valuenow')).toBeCloseTo(percent(240), 1);
    while (expected < 360) await press('ArrowRight');
    await press('ArrowRight'); // at the maximum: stays
    expect(await sidebarWidth(page)).toBe(360);
    expect(await aria('aria-valuenow')).toBe(await aria('aria-valuemax'));
    while (expected > 180) await press('ArrowLeft');
    expect(await sidebarWidth(page)).toBe(180); // a step below the minimum stops at it first
    // From the minimum, one more step collapses: the user's collapse (stored), and the focus leaves the vanishing handle.
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => sidebarWidth(page)).toBe(0);
    await expect(page.getByTestId('toolbar-sidebar-toggle')).toBeFocused();
    expect(await savedPanes(page)).toEqual({ sidebar: 180, sidebarCollapsed: 1 });
  } finally {
    await app.close();
  }
});

test('the separator resizes within 180–360, collapses past the minimum, and both survive a restart', async ({}, testInfo) => {
  const [lib, ud] = dirs(testInfo);
  let { app, page } = await launch(lib, ud);
  const drag = async (from: number, to: number) => {
    await page.mouse.move(from, 400);
    await page.mouse.down();
    await page.mouse.move(to, 400, { steps: 10 });
    await page.mouse.up();
  };
  try {
    await drag(240, 300);
    await expect.poll(() => sidebarWidth(page)).toBe(300);
    await drag(300, 520);
    await expect.poll(() => sidebarWidth(page)).toBe(360);
    await drag(360, 280);
    await expect.poll(() => sidebarWidth(page)).toBe(280);
    await page.waitForTimeout(600); // debounced layout.panes save (300 ms)
    await app.close();

    ({ app, page } = await launch(lib, ud));
    expect(await sidebarWidth(page)).toBe(280);
    await drag(280, 40);
    await expect.poll(() => sidebarWidth(page)).toBe(0);
    await page.waitForTimeout(600);
    await app.close();

    ({ app, page } = await launch(lib, ud));
    expect(await sidebarWidth(page)).toBe(0);
    await runMenuCommand(app, 'view.toggleSidebar');
    await expect.poll(() => sidebarWidth(page)).toBe(280); // the width is remembered while hidden
  } finally {
    await app.close();
  }
});

test('200 % zoom folds the sidebar away without sideways scrolling; it comes back at 100 % (not a user choice)', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await zoom(app, 2);
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThan(760); // 720 at 1440 px (Linux), 512 on the 1024 px macOS runner
    await expect.poll(() => sidebarWidth(page)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await savedPanes(page)).toBeNull(); // automatic folding is never stored (M-5)
    await zoom(app, 1);
    await expect.poll(() => sidebarWidth(page)).toBe(240);
    expect(await savedPanes(page)).toBeNull();
  } finally {
    await app.close();
  }
});

test('in a narrow window, showing the sidebar and folding it again is not a user collapse (nothing saved; full width shows it)', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await zoom(app, 2);
    await expect.poll(() => sidebarWidth(page)).toBe(0);
    await runMenuCommand(app, 'view.toggleSidebar'); // shown on demand
    await expect.poll(() => sidebarWidth(page)).toBe(240);
    await runMenuCommand(app, 'view.toggleSidebar'); // folded again: back to the automatic fold
    await expect.poll(() => sidebarWidth(page)).toBe(0);
    expect(await savedPanes(page)).toBeNull();
    await zoom(app, 1);
    await expect.poll(() => sidebarWidth(page)).toBe(240);
    expect(await savedPanes(page)).toBeNull();
  } finally {
    await app.close();
  }
});

test('layout B invariant: the sidebar top 88 px is pixel-identical in every view, and the width is shared', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  const top88 = async () => {
    await page.mouse.move(900, 700);
    return page.screenshot({ clip: { x: 0, y: 0, width: 240, height: 88 }, animations: 'disabled', caret: 'hide' });
  };
  try {
    const empty = await top88();
    await importPaths(page, [PDF, MP4]);
    await expect(page.getByTestId('item-row')).toHaveCount(2);
    const library = await top88();
    await openItem(page, 'sample');
    await expect(page.getByTestId('pdf-canvas')).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
    const pdf = await top88();
    const pdfWidth = await sidebarWidth(page);
    await runMenuCommand(app, 'nav.back');
    await openItem(page, 'sample-h264-aac');
    await expect(page.getByTestId('video')).toBeVisible();
    const video = await top88();
    for (const [name, shot] of [['library', library], ['pdf', pdf], ['video', video]] as const) expect(shot.equals(empty), name).toBe(true);
    expect(pdfWidth).toBe(240);
    expect(await sidebarWidth(page)).toBe(240);

    // Folded: the toolbar head that took the toggle over (x 0–44: inset, toggle, gap) is the same in every view too.
    const foldedHead = async () => {
      await page.mouse.move(900, 700);
      return page.screenshot({ clip: { x: 0, y: 0, width: 44, height: 52 }, animations: 'disabled', caret: 'hide' });
    };
    await runMenuCommand(app, 'view.toggleSidebar');
    await expect.poll(() => sidebarWidth(page)).toBe(0);
    const foldedVideo = await foldedHead();
    await runMenuCommand(app, 'nav.back');
    await expect(page.getByTestId('item-row')).toHaveCount(2);
    const foldedLibrary = await foldedHead();
    await openItem(page, 'sample');
    await expect(page.getByTestId('pdf-canvas')).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
    const foldedPdf = await foldedHead();
    for (const [name, shot] of [['library', foldedLibrary], ['pdf', foldedPdf]] as const) expect(shot.equals(foldedVideo), `folded ${name}`).toBe(true);
    // Shown again (from the PDF view): the sidebar top is still the one from the empty library.
    await runMenuCommand(app, 'view.toggleSidebar');
    await expect.poll(() => sidebarWidth(page)).toBe(240);
    expect((await top88()).equals(empty), 'shown again').toBe(true);
  } finally {
    await app.close();
  }
});

test('boot: a failed prefs read still opens the shell (defaults; the warning carries the code only)', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await stubHandler(app, Channels.prefs.get, { ok: false, code: 'INTERNAL', message: 'stubbed prefs failure', retryable: false });
    const warnings: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'warning') warnings.push(m.text());
    });
    await page.reload();
    await expect(page.getByTestId('app-ready')).toBeAttached();
    await expect(page.getByTestId('shell')).toBeVisible();
    await expect(page.getByTestId('toolbar-title')).toHaveText('내 라이브러리');
    expect(warnings).toContain('[prefs] reading prefs failed: INTERNAL');
    expect(warnings.join('\n')).not.toContain('stubbed prefs failure');
  } finally {
    await app.close();
  }
});

test('boot: a render-time failure in the main window shows the fatal screen, not a blank window', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await stubHandler(app, Channels.library.list, { ok: true, data: 5 }); // not a list: the old library view throws while rendering
    await page.reload();
    await expect(page.getByTestId('app-ready')).toBeAttached();
    await expect(page.getByTestId('fatal-notice')).toContainText('화면을 표시하지 못했습니다');
    await expect(page.getByTestId('fatal-notice')).toContainText('앱을 다시 시작하세요');
    await expect(page.getByTestId('fatal-notice').locator('.file')).toHaveCount(0); // not a library failure: no backup line
    await expect(page.getByTestId('shell')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('frame: themed background (no white flash) that follows the theme; overlay room on Linux; drag regions', async ({}, testInfo) => {
  const ud = testInfo.outputPath('userdata');
  fs.mkdirSync(ud, { recursive: true });
  fs.writeFileSync(path.join(ud, 'preferences.json'), JSON.stringify({ theme: 'dark' }));
  const { app, page } = await launch(testInfo.outputPath('library'), ud);
  const bg = async () => (await mainWindow(app)).evaluate((w) => w.getBackgroundColor().toLowerCase());
  try {
    if (process.platform !== 'darwin') {
      expect(await bg()).toBe('#242527'); // windowBackground.dark before the first paint
      await page.evaluate(() => window.learn.prefs.set({ theme: 'light' }));
      await expect.poll(bg).toBe('#f6f7f8');
      const room = await page.evaluate(() => {
        const probe = document.createElement('div');
        probe.style.cssText = 'position:fixed;left:env(titlebar-area-x,0px);width:env(titlebar-area-width,100vw)';
        document.body.append(probe);
        const r = probe.getBoundingClientRect();
        probe.remove();
        return { controls: innerWidth - (r.left + r.width), padding: parseFloat(getComputedStyle(document.querySelector('[data-testid="toolbar"]')!).paddingRight) };
      });
      expect(room.controls).toBeGreaterThan(0);
      expect(room.padding).toBeCloseTo(12 + room.controls, 0);
    }
    const region = (sel: string) => page.locator(sel).first().evaluate((el) => getComputedStyle(el).getPropertyValue('-webkit-app-region') || getComputedStyle(el).getPropertyValue('app-region'));
    expect(await region('[data-testid="toolbar"]')).toBe('drag');
    expect(await region('[data-testid="sidebar-top"]')).toBe('drag');
    expect(await region('[data-testid="sidebar-toggle"]')).toBe('no-drag');
  } finally {
    await app.close();
  }
});

test('window bounds survive a restart (windowStatePersistence)', async ({}, testInfo) => {
  const [lib, ud] = dirs(testInfo);
  let s = await launch(lib, ud);
  const bounds = { x: 40, y: 40, width: 1200, height: 760 };
  await (await mainWindow(s.app)).evaluate((w, b) => w.setBounds(b), bounds);
  await s.page.waitForTimeout(1500);
  await s.app.close();
  s = await launch(lib, ud);
  try {
    const restored = await (await mainWindow(s.app)).evaluate((w) => w.getBounds());
    expect(restored.width).toBe(bounds.width);
    expect(restored.height).toBe(bounds.height);
    expect(Math.abs(restored.x - bounds.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(restored.y - bounds.y)).toBeLessThanOrEqual(30); // a macOS menu bar may push it down
  } finally {
    await s.app.close();
  }
});

test('full screen drops the traffic-light inset (data-fullscreen)', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await (await mainWindow(app)).evaluate((w) => w.setFullScreen(true));
    await expect(page.locator('html')).toHaveAttribute('data-fullscreen', '');
    await (await mainWindow(app)).evaluate((w) => w.setFullScreen(false));
    await expect(page.locator('html')).not.toHaveAttribute('data-fullscreen', '');
  } finally {
    await app.close();
  }
});

// R-4: checked on Linux before the one macOS run — an opaque ancestor would hide the vibrancy and Step 9-2 would
// wrongly turn it off. Linux has no vibrancy, so the main page is reloaded with the macOS flag.
test('vibrancy page (data-vibrancy=1): the sidebar and every ancestor are clear; the content column stays opaque', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    const url = new URL(page.url());
    url.searchParams.set('vibrancy', '1');
    await page.goto(url.toString());
    await expect(page.getByTestId('shell')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-vibrancy', '1');
    const seen = await page.evaluate(() => {
      const clear = (el: Element) => getComputedStyle(el).backgroundColor === 'rgba(0, 0, 0, 0)';
      const opaque: string[] = [];
      for (let el: Element | null = document.querySelector('.sidebar'); el; el = el.parentElement) if (!clear(el)) opaque.push(`${el.tagName.toLowerCase()}.${el.className}`);
      return { opaque, content: getComputedStyle(document.querySelector('.main-column')!).backgroundColor };
    });
    expect(seen.opaque).toEqual([]);
    expect(seen.content).not.toBe('rgba(0, 0, 0, 0)');
  } finally {
    await app.close();
  }
});
