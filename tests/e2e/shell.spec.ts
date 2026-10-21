// Layout B shell (design-spec 2.1, 2.3): fixed sidebar top, shared width, resize/collapse/persist, auto-fold.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { FIXTURES, importPaths, launch, openItem, runMenuCommand } from './helpers';

const PDF = path.join(FIXTURES, 'sample.pdf');
const MP4 = path.join(FIXTURES, 'sample-h264-aac.mp4');

const box = async (page: Page, testId: string) => {
  const b = await page.getByTestId(testId).first().boundingBox();
  if (!b) throw new Error(`${testId} has no box`);
  return b;
};
const sidebarWidth = async (page: Page) => Math.round((await box(page, 'sidebar')).width);
const dirs = (testInfo: { outputPath(...p: string[]): string }) => [testInfo.outputPath('library'), testInfo.outputPath('userdata')] as const;

test('layout B: full-height 240 px sidebar, 52 px bars, navigator from y 88', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    expect(await sidebarWidth(page)).toBe(240);
    expect((await box(page, 'sidebar')).height).toBe(await page.evaluate(() => innerHeight));
    expect((await box(page, 'sidebar-top')).height).toBe(52);
    expect(await box(page, 'toolbar')).toMatchObject({ x: 240, y: 0, height: 52 });
    expect(Math.round((await page.locator('.sidebar .section-label').boundingBox())!.y)).toBe(88);
    await expect(page.getByTestId('toolbar-title')).toHaveText('내 라이브러리');
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
  const zoom = (f: number) => app.evaluate(({ BrowserWindow }, f) => BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(f), f);
  try {
    await zoom(2);
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThan(760); // 720 at 1440 px (Linux), 512 on the 1024 px macOS runner
    await expect.poll(() => sidebarWidth(page)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await zoom(1);
    await expect.poll(() => sidebarWidth(page)).toBe(240);
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
  } finally {
    await app.close();
  }
});
