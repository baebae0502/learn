// Layout B shell (design-spec 2.1, 2.3): fixed sidebar top, shared width, resize/collapse/persist, auto-fold.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { layout } from '../../apps/desktop/src/renderer/src/design/tokens';
import { Channels } from '../../packages/domain/src/ipc-channels';
import { FIXTURES, closeSheet, expectDisabledReason, expectWindow, importFiles, importPaths, launch, mainWindow, menuSnapshot, openItem, runMenuCommand, type MenuNode } from './helpers';

const PDF = path.join(FIXTURES, 'sample.pdf');
const MP4 = path.join(FIXTURES, 'sample-h264-aac.mp4');

const box = async (page: Page, testId: string) => {
  const b = await page.getByTestId(testId).first().boundingBox();
  if (!b) throw new Error(`${testId} has no box`);
  return b;
};
const sidebarWidth = async (page: Page) => Math.round((await box(page, 'sidebar')).width);
const dirs = (testInfo: { outputPath(...p: string[]): string }) => [testInfo.outputPath('library'), testInfo.outputPath('userdata')] as const;
const zoom = async (app: ElectronApplication, f: number) => (await mainWindow(app)).evaluate((w, f) => w.webContents.setZoomFactor(f), f);
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
  const menuLabel = async () => (await menuSnapshot(app)).flatMap(function walk(n): MenuNode[] { return [n, ...(n.submenu ?? []).flatMap(walk)]; }).find((n) => n.id === 'view.toggleSidebar')?.label;
  try {
    // Mac pattern (design-spec 7.4): the menu item and the toggle name what a press does now.
    await expect.poll(menuLabel).toBe('사이드바 가리기');
    await expect(page.getByTestId('sidebar-toggle')).toHaveAccessibleName('사이드바 가리기');
    await runMenuCommand(app, 'view.toggleSidebar');
    await expect.poll(() => sidebarWidth(page)).toBe(0);
    await expect(page.getByTestId('shell')).toHaveAttribute('data-sidebar', 'hidden');
    expect((await box(page, 'toolbar')).x).toBe(0);
    await expect.poll(menuLabel).toBe('사이드바 보기');
    await expect(page.getByTestId('toolbar-sidebar-toggle')).toHaveAccessibleName('사이드바 보기');
    await page.getByTestId('toolbar-sidebar-toggle').click();
    await expect.poll(() => sidebarWidth(page)).toBe(240);
    await expect(page.getByTestId('toolbar-sidebar-toggle')).toHaveCount(0);
    await expect(page.getByTestId('sidebar-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect.poll(menuLabel).toBe('사이드바 가리기');
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

test('⌃⌘S with the keyboard focus inside the sidebar hands it to the toolbar toggle, with its ring and no tooltip', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  const tip = page.getByRole('tooltip');
  const ring = (id: string) => page.getByTestId(id).evaluate((el) => getComputedStyle(el).outlineStyle !== 'none');
  try {
    await page.getByTestId('nav-library').focus();
    await page.keyboard.press('ArrowDown'); // a keyboard user: the one row stays current
    await expect(page.getByTestId('nav-library')).toBeFocused();
    await runMenuCommand(app, 'view.toggleSidebar');
    await expect(page.getByTestId('shell')).toHaveAttribute('data-sidebar', 'hidden');
    await expect(page.getByTestId('toolbar-sidebar-toggle')).toBeFocused();
    // Mac run 39779536146 (critique m1): the rescued focus keeps its ring but pops no tooltip, as a menu shortcut
    // never does on the Mac, and none comes up later while the focus rests there.
    expect(await ring('toolbar-sidebar-toggle')).toBe(true);
    await page.waitForTimeout(900);
    await expect(tip).toHaveCount(0);
    await runMenuCommand(app, 'view.toggleSidebar');
    await expect(page.getByTestId('shell')).toHaveAttribute('data-sidebar', 'shown');
    await expect(page.getByTestId('sidebar-toggle')).toBeFocused();
    expect(await ring('sidebar-toggle')).toBe(true);
    await page.waitForTimeout(900);
    await expect(tip).toHaveCount(0);
    // The next navigation key lifts that: keyboard focus on a control shows its tooltip at once again.
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByTestId('sidebar-toggle')).toBeFocused();
    await expect(tip).toHaveText(/사이드바 가리기/);
  } finally {
    await app.close();
  }
});

test('the toggle\'s open tooltip goes with ⌃⌘S and never comes back, also once the focus is let go (m1, Linux evidence)', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  const tip = page.getByRole('tooltip');
  try {
    // Keyboard focus on the sidebar toggle: its tooltip is open (as the evidence harness starts).
    await page.getByTestId('launcher').focus();
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByTestId('sidebar-toggle')).toBeFocused();
    await expect(tip).toHaveText(/사이드바 가리기/);
    for (const state of ['hidden', 'shown']) {
      await runMenuCommand(app, 'view.toggleSidebar');
      await expect(page.getByTestId('shell')).toHaveAttribute('data-sidebar', state);
      await page.waitForTimeout(900);
      await expect(tip).toHaveCount(0);
    }
    // Before the fix, letting the focus go drew the toggle's old tooltip again here, and it stayed through the next
    // toggles (the trigger's state was left half-run by the vetoed open).
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.waitForTimeout(300);
    await expect(tip).toHaveCount(0);
    await page.mouse.click(700, 600);
    for (const state of ['hidden', 'shown']) {
      await runMenuCommand(app, 'view.toggleSidebar');
      await expect(page.getByTestId('shell')).toHaveAttribute('data-sidebar', state);
      await page.waitForTimeout(900);
      await expect(tip).toHaveCount(0);
    }
    // Tooltips still work: keyboard focus on the toggle opens its tooltip at once.
    await page.getByTestId('launcher').focus();
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByTestId('sidebar-toggle')).toBeFocused();
    await expect(tip).toHaveText(/사이드바 가리기/);
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
  // 1200 × 760 at (40, 40) where the screen has room (Xvfb 1920 × 1200); on a smaller one (the macOS runner's 1024 × 768,
  // Mac run 39779536146) bounds that fit its work area, above the window's minimum size, as the evidence restart does.
  const workArea = await s.app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea);
  const width = Math.max(layout.windowMinWidth, Math.min(1200, workArea.width - 80));
  const height = Math.max(layout.windowMinHeight, Math.min(760, workArea.height - 80));
  const bounds = { x: workArea.x + Math.min(40, Math.max(0, workArea.width - width)), y: workArea.y + Math.min(40, Math.max(0, workArea.height - height)), width, height };
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
  const { app, page } = await launch(...dirs(testInfo), { colorScheme: 'dark' });
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
    // Sidebar text over the material uses its own tokens (dark: tertiary lifted to 70 %, a selected count in primary).
    const sidebarText = await page.evaluate(() => ({
      label: getComputedStyle(document.querySelector('.sidebar .section-label')!).color,
      countSelected: getComputedStyle(document.querySelector('.sidebar')!).getPropertyValue('--sidebar-count-selected').trim(),
      rootTertiary: getComputedStyle(document.documentElement).getPropertyValue('--text-tertiary').trim(),
    }));
    expect(sidebarText.label).toBe('oklch(0.7 0.008 250)');
    expect(sidebarText.countSelected).not.toBe('');
    expect(sidebarText.rootTertiary).toContain('oklch(58% 0.008 250)'); // the opaque fallback outside the sidebar is unchanged
  } finally {
    await app.close();
  }
});

const tooltip = (page: Page) => page.getByRole('tooltip');

test('a menu toggle pops no tooltip or ring on the toggle unless the keyboard was in use (Task 8 critique m1)', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    // Focus inside the sidebar without keyboard navigation (put there by code, as the Mac run found it): the toggle
    // from the menu lets it go instead of rescuing it onto the toolbar toggle with a ring and an open tooltip.
    await page.getByTestId('sidebar-toggle').focus();
    await expect(page.getByTestId('sidebar-toggle')).toBeFocused();
    await runMenuCommand(app, 'view.toggleSidebar');
    await expect(page.getByTestId('shell')).toHaveAttribute('data-sidebar', 'hidden');
    await page.waitForTimeout(300);
    await expect(tooltip(page)).toHaveCount(0);
    await expect(page.getByTestId('toolbar-sidebar-toggle')).not.toBeFocused(); // let go: nothing to ring
    await runMenuCommand(app, 'view.toggleSidebar');
    await expect(page.getByTestId('shell')).toHaveAttribute('data-sidebar', 'shown');
    await page.waitForTimeout(300);
    await expect(tooltip(page)).toHaveCount(0);

    // After a click (pointer), the same: the focus is let go, not rescued.
    await page.getByTestId('nav-library').click();
    await runMenuCommand(app, 'view.toggleSidebar');
    await expect(page.getByTestId('shell')).toHaveAttribute('data-sidebar', 'hidden');
    await page.waitForTimeout(300);
    await expect(page.getByTestId('toolbar-sidebar-toggle')).not.toBeFocused();
    await expect(tooltip(page)).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('an open tooltip closes when the window becomes inactive and does not come back', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await page.keyboard.press('Tab'); // keyboard focus on the first control, the sidebar toggle: its tooltip opens at once
    await expect(page.getByTestId('sidebar-toggle')).toBeFocused();
    await expect(tooltip(page)).toHaveText(/사이드바 가리기/);
    // Another window takes the focus (a sheet, another app): main's windowState push closes it.
    await app.evaluate(({ BrowserWindow }) => {
      const w = new BrowserWindow({ width: 300, height: 200, show: true });
      void w.loadURL('about:blank');
      w.focus();
      (globalThis as { __probeWindow?: unknown }).__probeWindow = w;
    });
    await expect(page.locator('html')).toHaveAttribute('data-window-inactive', '');
    await expect(tooltip(page)).toHaveCount(0);
    await app.evaluate(() => (globalThis as { __probeWindow?: { close(): void } }).__probeWindow?.close());
    await (await mainWindow(app)).evaluate((w) => w.focus());
    await expect(page.locator('html')).not.toHaveAttribute('data-window-inactive', '');
    await page.waitForTimeout(300);
    await expect(tooltip(page)).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('not key: no ring or cursor, neutral selection; not main as well: the chrome recedes; under a sheet it stays main (R3-2, R3-4, polish)', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  const row = page.getByTestId('nav-library');
  const looks = () =>
    page.evaluate(() => {
      const css = (sel: string) => getComputedStyle(document.querySelector(sel)!);
      return {
        cursor: css('[data-testid="nav-library"]').boxShadow,
        rowFill: css('[data-testid="nav-library"]').backgroundColor,
        title: css('[data-testid="toolbar-title"]').color,
        toggle: css('[data-testid="sidebar-toggle"]').color,
        toggleOpacity: css('[data-testid="sidebar-toggle"] > .icon').opacity,
        section: css('.sidebar .section-label').color,
        rowIcon: css('[data-testid="nav-library"] > .icon').color,
        rowIconOpacity: css('[data-testid="nav-library"] > .icon').opacity,
        selectedRowText: css('[data-testid="nav-library"]').color,
        toolbarFill: css('[data-testid="toolbar"]').backgroundColor,
        toolbarLine: css('[data-testid="toolbar"]').borderBottomColor,
        sidebarEdge: css('.sidebar').boxShadow,
        notKey: document.documentElement.hasAttribute('data-window-inactive'),
        notMain: document.documentElement.hasAttribute('data-window-not-main'),
      };
    });
  const token = (name: string) =>
    page.evaluate((v) => {
      const probe = document.createElement('span');
      document.body.append(probe);
      probe.style.color = `var(${v})`;
      const out = getComputedStyle(probe).color;
      probe.remove();
      return out;
    }, name);
  try {
    await importPaths(page, [PDF]);
    await row.focus();
    await page.keyboard.press('ArrowDown'); // keyboard cursor on the current row
    const active = await looks();
    expect(active).toMatchObject({ notKey: false, notMain: false, toggleOpacity: '1', rowIconOpacity: '1' });
    // The single-selection sidebar draws no cursor ring on its accent-filled row: the fill shows the focus (critic
    // T12-n1, design-spec 6).
    expect(active.cursor).toBe('none');
    const accent = await page.evaluate(() => {
      const probe = document.createElement('span');
      document.body.append(probe);
      probe.style.backgroundColor = 'var(--accent)';
      const out = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return out;
    });
    expect(active.rowFill).toBe(accent);

    // Another window takes the key: not key and not main.
    await app.evaluate(({ BrowserWindow }) => {
      const w = new BrowserWindow({ width: 300, height: 200, show: true });
      void w.loadURL('about:blank');
      w.focus();
      (globalThis as { __probeWindow?: unknown }).__probeWindow = w;
    });
    await expect(page.locator('html')).toHaveAttribute('data-window-not-main', '');
    const inactive = await token('--text-inactive');
    await expect.poll(async () => (await looks()).title).toBe(inactive); // colours may ease in
    const background = await looks();
    // Text dims to the translucent token; glyphs keep a solid colour and fade as a whole (N4-1).
    expect(background).toMatchObject({ notKey: true, notMain: true, cursor: 'none', title: inactive, section: inactive, toggleOpacity: '0.3', rowIconOpacity: '0.3' });
    expect(background.rowFill).not.toBe(active.rowFill); // the neutral selection
    expect(background.toggle).toBe(await token('--text-primary'));
    expect(background.rowIcon).toBe(await token('--accent-text'));
    expect(background.selectedRowText).toBe(await token('--text-inactive-selected')); // Finder dims the selected row too
    const platform = await page.evaluate(() => document.documentElement.getAttribute('data-platform'));
    if (platform === 'darwin') {
      // macOS: the toolbar takes the inactive material and its lines the inactive separator (polish Q2, N4-4; the Mac
      // run 39779536146 read rgb(236, 236, 236), the material).
      expect(background).toMatchObject({ toolbarFill: await token('--bg-chrome-inactive'), toolbarLine: await token('--separator-chrome-inactive') });
      expect(background.sidebarEdge).toBe(`${await token('--separator-chrome-inactive')} -1px 0px 0px 0px inset`);
    } else {
      // Linux and Windows keep their toolbar fill and lines (the controls overlay's colour is fixed).
      expect(background).toMatchObject({ toolbarFill: active.toolbarFill, toolbarLine: active.toolbarLine, sidebarEdge: active.sidebarEdge });
    }
    // macOS forced (on every platform): the toolbar takes the inactive material, and in dark the chrome lines turn black.
    await page.evaluate(() => document.documentElement.setAttribute('data-platform', 'darwin'));
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
      const mac = await looks();
      expect(mac.toolbarFill, theme).toBe(await token('--bg-chrome-inactive'));
      expect(mac.toolbarLine, theme).toBe(await token('--separator-chrome-inactive'));
      expect(mac.sidebarEdge, theme).toBe(`${await token('--separator-chrome-inactive')} -1px 0px 0px 0px inset`); // inset -1px 0 0
    }
    expect(await token('--separator-chrome-inactive')).toBe('oklch(0 0 0)'); // dark: black
    await page.evaluate((p) => {
      if (p === null) document.documentElement.removeAttribute('data-platform');
      else document.documentElement.setAttribute('data-platform', p);
      document.documentElement.removeAttribute('data-theme');
    }, platform);
    await expect(row).toBeFocused(); // the focus stayed where it was
    await app.evaluate(() => (globalThis as { __probeWindow?: { close(): void } }).__probeWindow?.close());
    await (await mainWindow(app)).evaluate((w) => w.focus());
    await expect(page.locator('html')).not.toHaveAttribute('data-window-inactive', '');
    await expect.poll(looks).toEqual(active); // ring, title and glyphs back as they were

    // One of our sheets takes the key: not key (no ring, neutral selection) but still main (chrome undimmed). The
    // chrome never dims on the way: not while the sheet is open, nor between its closing and the window being key.
    await page.evaluate(() => {
      const w = window as unknown as { __notMainSeen?: boolean; __notMainObserver?: MutationObserver };
      w.__notMainSeen = false;
      w.__notMainObserver = new MutationObserver(() => {
        if (document.documentElement.hasAttribute('data-window-not-main')) w.__notMainSeen = true;
      });
      w.__notMainObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-window-not-main'] });
    });
    const sheet = await expectWindow(app, 'sheet', () => importFiles({ app, page }, [PDF]));
    await expect(page.locator('html')).toHaveAttribute('data-window-inactive', '');
    await expect.poll(async () => (await looks()).cursor).toBe('none');
    const underSheet = await looks();
    expect(underSheet).toMatchObject({ notKey: true, notMain: false, cursor: 'none', title: active.title, section: active.section, rowIconOpacity: '1' });
    // The sheet holds the window, so the toggle's command is refused: it is disabled with the reason like 가져오기
    // beside it (critique n1), at the disabled strength, not the not-main fade.
    await expectDisabledReason(page.getByTestId('sidebar-toggle'), '진행 중인 작업이 끝나면 쓸 수 있습니다');
    await expectDisabledReason(page.getByTestId('import-menu'), '진행 중인 작업이 끝나면 쓸 수 있습니다');
    expect(underSheet.toggleOpacity).toBe('0.4'); // an icon button's glyph disabled with a reason (button.css)
    expect(underSheet.rowIcon).toBe(await token('--accent-text')); // the neutral selection's icon, not faded
    expect(underSheet.selectedRowText).toBe(await token('--text-primary'));
    await closeSheet(sheet, 'Escape');
    await expect(page.locator('html')).not.toHaveAttribute('data-window-inactive', '');
    await page.waitForTimeout(400); // past main's 250 ms re-read
    expect(await page.evaluate(() => (window as unknown as { __notMainSeen?: boolean }).__notMainSeen)).toBe(false);
  } finally {
    await app.close();
  }
});

test('the window is named after its view: the library title, then the open item (R3-5)', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  const title = async () => (await mainWindow(app)).evaluate((w) => w.getTitle());
  try {
    await importPaths(page, [PDF]);
    await expect.poll(title).toBe(await page.getByTestId('toolbar-title').textContent());
    expect(await title()).toBe('내 라이브러리');
    await openItem(page, 'sample');
    await expect(page.getByTestId('viewer-title')).toHaveText('sample');
    await expect.poll(title).toBe('sample');
    await runMenuCommand(app, 'nav.back');
    await expect.poll(title).toBe('내 라이브러리');
  } finally {
    await app.close();
  }
});

test('in full screen there are no traffic lights: a hidden sidebar leaves the toolbar its normal 12 px start (R3-5)', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  const left = () => page.getByTestId('toolbar').evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft));
  try {
    await runMenuCommand(app, 'view.toggleSidebar');
    await expect(page.getByTestId('shell')).toHaveAttribute('data-sidebar', 'hidden');
    // As on macOS: windowed, the toolbar clears the lights (84); in full screen it starts at the normal padding.
    await page.evaluate(() => document.documentElement.setAttribute('data-platform', 'darwin'));
    expect(await left()).toBe(84);
    await page.evaluate(() => document.documentElement.setAttribute('data-fullscreen', ''));
    expect(await left()).toBe(12);
  } finally {
    await app.close();
  }
});
