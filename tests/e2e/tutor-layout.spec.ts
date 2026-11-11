// T1a Task 15: the reader's right panel is 정보 or 튜터 (spec 8.1, 8.10): its mode and each mode's width, ⌥⌘I and its names, the
// narrow windows (the tutor narrows to 320 before it folds, the pane shown last wins) and the toolbar's smallest width.
import path from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { FIXTURES, dragAlong, importPaths, ipcCalls, launch, mainWindow, menuSnapshot, openItem, readerToolbarMin, runMenuCommand, type MenuNode } from './helpers';

const PAPER = path.join(FIXTURES, 'paper-100.pdf');
const SAMPLE = path.join(FIXTURES, 'sample.pdf');
const MP4 = path.join(FIXTURES, 'sample-h264-aac.mp4');
/** The default of the reader's right panel is 튜터: these specs launch with no setting seeded (helpers.launch seeds 정보 for the others). */
const UNSET = { env: { LEARN_E2E_SETTINGS: '' } };

const dirs = (testInfo: { outputPath(...p: string[]): string }) => [testInfo.outputPath('library'), testInfo.outputPath('userdata')] as const;
const contentWidth = async (app: ElectronApplication, width: number) => (await mainWindow(app)).evaluate((w, width) => w.setContentSize(width, w.getContentSize()[1]!), width);
const shell = (page: Page, attr: 'data-sidebar' | 'data-inspector') => page.getByTestId('shell').getAttribute(attr);
const slotWidth = async (page: Page) => Math.round((await page.getByTestId('inspector-panel').boundingBox())?.width ?? 0);
const readerWidth = async (page: Page) => Math.round((await page.getByTestId('content').boundingBox())?.width ?? 0);
const modeOf = (page: Page) => page.getByTestId('inspector').getAttribute('data-mode');
const flatten = (nodes: readonly MenuNode[]): MenuNode[] => nodes.flatMap((n) => [n, ...flatten(n.submenu ?? [])]);
const menuLabel = async (app: ElectronApplication, id: string) => flatten(await menuSnapshot(app)).find((n) => n.id === id)?.label;
const storedPanes = (page: Page) => page.evaluate(async () => {
  const r = await window.learn.settings.get({ key: 'layout.panes' });
  return r.ok ? (r.data as Record<string, number> | null) : null;
});

/** A paper opened in the reader with its pages drawn. */
async function openPaper(page: Page): Promise<void> {
  await importPaths(page, [PAPER]);
  await openItem(page, 'paper-100');
  await expect(page.getByTestId('pdf-viewer')).toHaveAttribute('data-pages', /^[1-9]/);
}

test('a first reader opens on 튜터 with the consent card; ⌃⌘1 shows 정보 and the reader is 60 wider; the choice is remembered', async ({}, testInfo) => {
  let { app, page } = await launch(...dirs(testInfo), UNSET);
  try {
    await contentWidth(app, 1440);
    await openPaper(page);
    await expect(page.getByTestId('inspector')).toHaveAttribute('data-mode', 'tutor');
    const tabs = page.getByRole('tablist', { name: '오른쪽 패널' });
    await expect(tabs.getByRole('tab', { name: '튜터' })).toHaveAttribute('aria-selected', 'true');
    await expect(tabs.getByRole('tab', { name: '정보' })).toHaveAttribute('aria-selected', 'false');
    await expect(tabs.getByRole('tab', { name: '정보' })).toHaveAttribute('title', /^정보 /);
    await expect(page.getByTestId('tutor-consent')).toBeVisible();
    await expect(page.getByTestId('translation-section')).toHaveCount(0);
    expect(await slotWidth(page)).toBe(380);
    const tutorReader = await readerWidth(page);

    await runMenuCommand(app, 'view.inspectorInfo');
    await expect(page.getByTestId('inspector')).toHaveAttribute('data-mode', 'info');
    await expect(page.getByTestId('translation-section')).toBeVisible();
    await expect(tabs.getByRole('tab', { name: '정보' })).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => slotWidth(page)).toBe(320);
    await expect.poll(() => readerWidth(page)).toBe(tutorReader + 60);
    // The same menu item the other way, and back: the choice goes with the item that was run last.
    await runMenuCommand(app, 'view.inspectorTutor');
    await expect(page.getByTestId('tutor-consent')).toBeVisible();
    await expect.poll(() => readerWidth(page)).toBe(tutorReader);
    await runMenuCommand(app, 'view.inspectorInfo');
    await expect(page.getByTestId('translation-section')).toBeVisible();
    await expect.poll(async () => (await page.evaluate(() => window.learn.settings.get({ key: 'reader.inspectorMode' }))) as { ok: true; data: string }).toMatchObject({ data: 'info' });
    await app.close();

    ({ app, page } = await launch(...dirs(testInfo), UNSET));
    // The reader tab comes back with the window: waited for, not looked for once.
    await expect(page.getByTestId('pdf-viewer')).toHaveAttribute('data-pages', /^[1-9]/);
    await expect(page.getByTestId('inspector')).toHaveAttribute('data-mode', 'info'); // remembered
    await expect(page.getByTestId('translation-section')).toBeVisible();
  } finally {
    await app.close();
  }
});

test('the segment is a tablist with one tab stop: a click and the arrow keys choose, and the library has none', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo), UNSET);
  try {
    await contentWidth(app, 1440);
    await importPaths(page, [PAPER]);
    await expect(page.getByTestId('inspector')).toHaveAttribute('data-mode', 'info'); // the library's panel is there ...
    await expect(page.getByTestId('inspector-modes')).toHaveCount(0); // ... with the info panel alone (J1)
    await openItem(page, 'paper-100');
    await expect(page.getByTestId('pdf-viewer')).toHaveAttribute('data-pages', /^[1-9]/);
    const info = page.getByRole('tab', { name: '정보' });
    const tutor = page.getByRole('tab', { name: '튜터' });
    await expect(tutor).toHaveAttribute('tabindex', '0');
    await expect(info).toHaveAttribute('tabindex', '-1');
    await info.click();
    await expect(page.getByTestId('inspector')).toHaveAttribute('data-mode', 'info');
    await expect(info).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('inspector')).toHaveAttribute('data-mode', 'tutor');
    await expect(tutor).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('inspector')).toHaveAttribute('data-mode', 'info');
    await page.keyboard.press('End');
    await expect(page.getByTestId('inspector')).toHaveAttribute('data-mode', 'tutor');
    // F6 lands on the selected tab (the other is reached with the arrows).
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('F6');
      if (await page.evaluate(() => document.activeElement?.closest('[data-pane]')?.getAttribute('data-pane') === 'inspector')) break;
    }
    await expect(tutor).toBeFocused();
  } finally {
    await app.close();
  }
});

test('each mode keeps its own width, which a restart keeps too', async ({}, testInfo) => {
  let { app, page } = await launch(...dirs(testInfo), UNSET);
  try {
    await contentWidth(app, 1440);
    await openPaper(page);
    const drag = async (by: number) => {
      const box = (await page.getByRole('separator', { name: '오른쪽 패널' }).boundingBox())!;
      const x = box.x + box.width / 2;
      await dragAlong(page, x, x - by, box.y + box.height / 2);
    };
    expect(await slotWidth(page)).toBe(380);
    await drag(60);
    await expect.poll(() => slotWidth(page)).toBeGreaterThanOrEqual(436);
    const tutorWide = await slotWidth(page);
    expect(tutorWide).toBeLessThanOrEqual(444);
    await runMenuCommand(app, 'view.inspectorInfo');
    await expect.poll(() => slotWidth(page)).toBe(320); // the info panel's own
    await drag(40);
    await expect.poll(() => slotWidth(page)).toBeGreaterThanOrEqual(356);
    const infoWide = await slotWidth(page);
    await runMenuCommand(app, 'view.inspectorTutor');
    await expect.poll(() => slotWidth(page)).toBe(tutorWide); // the tutor's own, as it was left
    await runMenuCommand(app, 'view.inspectorInfo');
    await expect.poll(() => slotWidth(page)).toBe(infoWide);
    await expect.poll(async () => (await storedPanes(page)) ?? {}).toMatchObject({ 'inspector.info': infoWide, 'inspector.tutor': tutorWide });
    await app.close();

    ({ app, page } = await launch(...dirs(testInfo), UNSET));
    await expect(page.getByTestId('pdf-viewer')).toHaveAttribute('data-pages', /^[1-9]/);
    await expect.poll(() => slotWidth(page)).toBe(infoWide); // 정보 was the mode at quit
    await runMenuCommand(app, 'view.inspectorTutor');
    await expect.poll(() => slotWidth(page)).toBe(tutorWide);
  } finally {
    await app.close();
  }
});

test('⌥⌘I folds the one slot of both modes, and the menu names what it does', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo), UNSET);
  try {
    await contentWidth(app, 1440);
    await openPaper(page);
    const toggle = page.getByTestId('inspector-toggle');
    await expect(toggle).toHaveAccessibleName('오른쪽 패널 가리기');
    await expect.poll(() => menuLabel(app, 'view.toggleInspector')).toBe('오른쪽 패널 가리기');
    await runMenuCommand(app, 'view.toggleInspector');
    await expect.poll(() => shell(page, 'data-inspector')).toBe('hidden');
    await expect(toggle).toHaveAccessibleName('오른쪽 패널 보기');
    await expect.poll(() => menuLabel(app, 'view.toggleInspector')).toBe('오른쪽 패널 보기');
    // A mode picked while the slot is folded opens it, in that mode.
    await runMenuCommand(app, 'view.inspectorInfo');
    await expect.poll(() => shell(page, 'data-inspector')).toBe('shown');
    await expect(page.getByTestId('translation-section')).toBeVisible();
    await runMenuCommand(app, 'view.toggleInspector');
    await expect.poll(() => shell(page, 'data-inspector')).toBe('hidden');
    await runMenuCommand(app, 'view.inspectorTutor');
    await expect.poll(() => shell(page, 'data-inspector')).toBe('shown');
    await expect(page.getByTestId('tutor-consent')).toBeVisible();
    // ⌃⌘2 puts the focus in the tutor's panel, at its first control (F6's place).
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await runMenuCommand(app, 'view.inspectorTutor');
    await expect.poll(() => page.evaluate(() => document.activeElement?.closest('[data-pane]')?.getAttribute('data-pane') ?? null)).toBe('inspector');
    // The sidebar and the slot name their states apart.
    await expect.poll(() => menuLabel(app, 'view.inspectorTutor')).toBe('튜터 보기');
  } finally {
    await app.close();
  }
});

test('in a narrow window the tutor narrows to 320 before it folds, then the sidebar folds; the pane shown last wins; the chosen width comes back', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo), UNSET);
  try {
    // A 1024 screen cannot hold a window wider than itself: each step that needs more than the screen has is left out there.
    const screenWidth = await page.evaluate(() => screen.availWidth);
    const fits = (w: number) => w <= screenWidth;
    const size = async (w: number) => {
      await contentWidth(app, w);
      await expect.poll(() => page.evaluate(() => innerWidth)).toBe(w);
    };
    await size(Math.min(1100, screenWidth));
    await openPaper(page);
    await expect(page.getByTestId('tutor-consent')).toBeVisible();
    if (fits(1100)) {
      await size(1100);
      await expect.poll(() => slotWidth(page)).toBe(380);
    }
    if (fits(1060)) {
      await size(1060); // 240 + 380 + 440: the tutor is whole, the reader 440
      await expect.poll(() => slotWidth(page)).toBe(380);
      await expect.poll(() => readerWidth(page)).toBe(440);
    }
    if (fits(1030)) {
      await size(1030);
      await expect.poll(() => slotWidth(page)).toBe(350);
      await expect.poll(() => readerWidth(page)).toBe(440);
    }
    await size(1000); // 240 + 320 + 440: the narrowest the tutor goes
    await expect.poll(() => slotWidth(page)).toBe(320);
    await expect.poll(() => readerWidth(page)).toBe(440);
    expect(await shell(page, 'data-sidebar')).toBe('shown');
    await size(999);
    await expect.poll(() => shell(page, 'data-inspector')).toBe('hidden');
    expect(await shell(page, 'data-sidebar')).toBe('shown');

    await size(960); // the smallest window: the slot is folded and the reader has 720
    await expect.poll(() => shell(page, 'data-inspector')).toBe('hidden');
    await expect.poll(() => readerWidth(page)).toBe(720);
    // Shown on demand, it pushes the sidebar away (nothing is stored): the tutor whole, the reader 580.
    await runMenuCommand(app, 'view.toggleInspector');
    await expect.poll(() => shell(page, 'data-inspector')).toBe('shown');
    await expect.poll(() => shell(page, 'data-sidebar')).toBe('hidden');
    await expect.poll(() => slotWidth(page)).toBe(380);
    await expect.poll(() => readerWidth(page)).toBe(580);
    // The sidebar brought back later folds the tutor: the pane shown last wins.
    await runMenuCommand(app, 'view.toggleSidebar');
    await expect.poll(() => shell(page, 'data-sidebar')).toBe('shown');
    await expect.poll(() => shell(page, 'data-inspector')).toBe('hidden');
    // And the tutor again, later, takes the sidebar once more.
    await runMenuCommand(app, 'view.toggleInspector');
    await expect.poll(() => shell(page, 'data-inspector')).toBe('shown');
    await expect.poll(() => shell(page, 'data-sidebar')).toBe('hidden');
    // Nothing was stored by all that, and a wide window gives everything back.
    await size(Math.min(1300, screenWidth));
    if (fits(1300)) {
      await expect.poll(() => shell(page, 'data-sidebar')).toBe('shown');
      await expect.poll(() => shell(page, 'data-inspector')).toBe('shown');
      await expect.poll(() => slotWidth(page)).toBe(380);
    }
    const panes = (await storedPanes(page)) ?? {};
    expect(panes['sidebarCollapsed'] ?? 0).toBe(0);
    expect(panes['inspectorCollapsed'] ?? 0).toBe(0);
    expect(panes['inspector.tutor'] ?? 380).toBe(380);

    // 정보 mode is M4 as it was: it never narrows, it folds at once below 1000 (240 + 320 + 440).
    await runMenuCommand(app, 'view.inspectorInfo');
    await size(1000);
    await expect.poll(() => slotWidth(page)).toBe(320);
    await size(999);
    await expect.poll(() => shell(page, 'data-inspector')).toBe('hidden');
  } finally {
    await app.close();
  }
});

test('나중에 is for the run: every PDF tab shows the off state, and 튜터 켜기… brings the card back in every tab (R21)', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo), UNSET);
  try {
    await contentWidth(app, 1280);
    await importPaths(page, [PAPER, SAMPLE]);
    await openItem(page, 'paper-100');
    await expect(page.getByTestId('pdf-viewer')).toHaveAttribute('data-pages', /^[1-9]/);
    await expect(page.getByTestId('tutor-consent')).toBeVisible(); // positive control: a tab starts on the card
    await page.getByTestId('tutor-consent-later').click();
    await expect(page.getByTestId('tutor-off')).toBeVisible();
    await page.locator('[data-testid="tab"][data-item-id="library"]').click();
    await expect(page.getByTestId('library-table')).toBeVisible();
    await expect(page.getByTestId('inspector-modes')).toHaveCount(0);
    await expect(page.getByTestId('tutor-panel')).toHaveCount(0);
    expect((await ipcCalls(app))['tutor:view'] ?? 0).toBe(0);
    await openItem(page, 'sample');
    await expect(page.getByTestId('pdf-viewer')).toHaveAttribute('data-pages', /^[1-9]/);
    await expect(page.getByTestId('tutor-off')).toBeVisible(); // a second tab: the run's choice, not the card again
    await expect(page.getByTestId('tutor-consent')).toHaveCount(0);
    await page.getByTestId('tutor-turn-on').click();
    await expect(page.getByTestId('tutor-consent')).toBeVisible();
    await page.locator('[data-testid="tab"]:not([data-item-id="library"])').first().click();
    await expect(page.getByTestId('tutor-consent')).toBeVisible(); // and in the first tab too
  } finally {
    await app.close();
  }
});

test('a tutor shown on demand pushes the sidebar away only beside a PDF: a video tab has the sidebar back (960)', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo), UNSET);
  try {
    await contentWidth(app, 960);
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(960);
    await importPaths(page, [PAPER, MP4]);
    await openItem(page, 'paper-100');
    await expect(page.getByTestId('pdf-viewer')).toHaveAttribute('data-pages', /^[1-9]/);
    await runMenuCommand(app, 'view.toggleInspector');
    await expect.poll(() => shell(page, 'data-inspector')).toBe('shown');
    await expect.poll(() => shell(page, 'data-sidebar')).toBe('hidden');
    await expect.poll(() => menuLabel(app, 'view.toggleSidebar')).toBe('사이드바 보기');
    await page.locator('[data-testid="tab"][data-item-id="library"]').click();
    await openItem(page, 'sample-h264-aac');
    await expect(page.getByTestId('pdf-viewer')).toHaveCount(0);
    await expect.poll(() => page.locator('[data-testid="tab"][aria-selected="true"]').getAttribute('data-item-id')).not.toBe('library');
    await expect.poll(() => shell(page, 'data-inspector')).toBeNull(); // no right panel in a video tab
    await expect.poll(() => shell(page, 'data-sidebar')).toBe('shown');
    await expect.poll(() => menuLabel(app, 'view.toggleSidebar')).toBe('사이드바 가리기');
    // Back on the PDF tab the tutor is still shown on demand and pushes the sidebar again.
    await page.locator('[data-testid="tab"]:has-text("paper-100")').click();
    await expect.poll(() => shell(page, 'data-inspector')).toBe('shown');
    await expect.poll(() => shell(page, 'data-sidebar')).toBe('hidden');
  } finally {
    await app.close();
  }
});

test('the reader toolbar\'s smallest width, at 13, 14 and 15 pt (what READER_CONTENT_MIN must hold)', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo), UNSET);
  try {
    await contentWidth(app, 1440);
    await openPaper(page);
    const measured = await readerToolbarMin(page);
    console.log('[measure] reader-toolbar-min', JSON.stringify(measured));
    testInfo.annotations.push({ type: 'measure', description: `reader-toolbar-min ${JSON.stringify(measured)}` });
    for (const m of measured) {
      expect(m.withoutCount, `${m.pt} pt, without the page count`).toBeGreaterThan(300);
      expect(m.withCount, `${m.pt} pt, with the page count`).toBeGreaterThanOrEqual(m.withoutCount);
    }
  } finally {
    await app.close();
  }
});
