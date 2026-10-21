// Window-wide drop overlay (design-spec 6 드롭 오버레이, 7.2): Finder → window, ⌥ = link, file counts.
// A real Finder drag (⌥ while dragging, the cursor badge) is a manual check on real hardware; these are synthetic drags.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { FIXTURES, closeSheet, expectWindow, importPaths, launch, mainWindow, openItem, runMenuCommand } from './helpers';

const PDF = path.join(FIXTURES, 'sample.pdf');
const IS_MAC = process.platform === 'darwin';

type Drag = 'dragenter' | 'dragover' | 'dragleave' | 'drop';
/** A synthetic Finder drag (types come from the files, like Chromium does for real drags). */
const drag = (page: Page, type: Drag, files: Array<[string, string]>, altKey = false) =>
  page.evaluate(
    ({ type, files, altKey }) => {
      const dt = new DataTransfer();
      for (const [name, mime] of files) dt.items.add(new File(['x'], name, { type: mime }));
      document.body.dispatchEvent(new DragEvent(type, { dataTransfer: dt, altKey, bubbles: true, cancelable: true }));
    },
    { type, files, altKey },
  );

/** A file input holding real files: their File objects have a location on disk, as Finder's do (webUtils.getPathForFile). */
async function realFiles(page: Page, paths: string[]): Promise<void> {
  await page.evaluate(() => {
    document.getElementById('drop-source')?.remove();
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.multiple = true;
    picker.id = 'drop-source';
    picker.hidden = true;
    document.body.append(picker);
  });
  await page.locator('#drop-source').setInputFiles(paths);
}
/** dragenter, dragover and drop of the real files, ⌥ held or not. */
const dropReal = (page: Page, altKey = false) =>
  page.evaluate((altKey) => {
    const dt = new DataTransfer();
    for (const f of Array.from((document.getElementById('drop-source') as HTMLInputElement).files!)) dt.items.add(f);
    for (const type of ['dragenter', 'dragover', 'drop']) document.body.dispatchEvent(new DragEvent(type, { dataTransfer: dt, altKey, bubbles: true, cancelable: true }));
  }, altKey);
/** Two frames: whatever a handled event would have rendered is on screen by then. */
const twoFrames = (page: Page) => page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

const THREE: Array<[string, string]> = [
  ['a.pdf', 'application/pdf'],
  ['b.pdf', 'application/pdf'],
  ['c.mp4', 'video/mp4'],
];

test('dragging files in shows the window-wide overlay with counts; ⌥ switches to 외부 파일로 연결; leaving hides it', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await drag(page, 'dragenter', THREE);
    const overlay = page.getByTestId('drop-overlay');
    await expect(overlay).toHaveAttribute('data-mode', 'copy');
    await expect(overlay).toHaveAccessibleName('파일 놓기');
    await expect(page.getByTestId('drop-summary')).toHaveText('파일 3개(PDF 2 · 동영상 1)');
    await expect(page.getByTestId('drop-copy')).toHaveAttribute('data-on', '');
    await expect(page.getByTestId('drop-link')).not.toHaveAttribute('data-on');
    // The key that switches to linking, from the accelerator helpers: ⌥ on macOS, Alt elsewhere.
    await expect(page.getByTestId('drop-link').locator('.kbd')).toHaveText(IS_MAC ? '⌥' : 'Alt');
    expect(await overlay.boundingBox()).toMatchObject({ x: 0, y: 52 });
    // The sidebar top (traffic lights, toggle) stays above the overlay.
    expect(await page.evaluate(() => document.elementFromPoint(200, 26)?.closest('[data-testid="sidebar-top"]') !== null)).toBe(true);
    await drag(page, 'dragover', THREE, true);
    await expect(overlay).toHaveAttribute('data-mode', 'link');
    await expect(page.getByTestId('drop-link')).toHaveAttribute('data-on', '');
    await expect(page.getByTestId('drop-copy')).not.toHaveAttribute('data-on');
    await drag(page, 'dragover', THREE, false);
    await expect(overlay).toHaveAttribute('data-mode', 'copy');
    await drag(page, 'dragleave', THREE);
    await expect(overlay).toHaveCount(0);
    await drag(page, 'dragenter', [['notes.txt', 'text/plain']]);
    await expect(page.getByTestId('drop-summary')).toHaveText('파일 1개');
    await drag(page, 'drop', [['notes.txt', 'text/plain']]);
    await expect(overlay).toHaveCount(0);
    await expect(page.getByTestId('drop-failed')).toBeVisible(); // a synthetic file has no Finder path
  } finally {
    await app.close();
  }
});

test('a drop imports a copy; with ⌥ held it links the original', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await realFiles(page, [PDF]);
    await dropReal(page);
    await expect(page.getByTestId('import-done')).toHaveText(/자료 1개를 가져왔습니다/);
    await realFiles(page, [path.join(FIXTURES, 'sample-h264-aac.mp4')]);
    await dropReal(page, true);
    await expect(page.getByTestId('import-done').filter({ hasText: '연결했습니다' })).toHaveText(/자료 1개를 연결했습니다/);
    const modes = await page.evaluate(async () => {
      const r = await window.learn.library.list();
      return r.ok ? r.data.map((i) => i.storageMode).sort() : [];
    });
    expect(modes).toEqual(['linked', 'managed']);
    await expect(page.getByTestId('drop-overlay')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('no overlay while reading, and a drop there imports nothing', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await importPaths(page, [PDF]);
    await openItem(page, 'sample');
    await drag(page, 'dragenter', THREE);
    await drag(page, 'drop', THREE);
    await twoFrames(page);
    await expect(page.getByTestId('drop-overlay')).toHaveCount(0);
    await expect(page.getByTestId('drop-failed')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('a sheet holds the window: no overlay, and a drop is ignored (a window under a sheet takes no drops)', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const keys = await expectWindow(app, 'sheet', () => runMenuCommand(app, 'app.shortcuts'));
    await drag(page, 'dragenter', THREE);
    await drag(page, 'drop', THREE);
    await twoFrames(page);
    await expect(page.getByTestId('drop-overlay')).toHaveCount(0);
    await expect(page.getByTestId('drop-failed')).toHaveCount(0);
    await closeSheet(keys, 'Escape');
    // The sheet is gone: the window takes drops again.
    await drag(page, 'dragenter', THREE);
    await expect(page.getByTestId('drop-overlay')).toBeVisible();
  } finally {
    await app.close();
  }
});

test('in a window that is neither key nor main the ring, tile and current card stay at full strength; the text does not dim', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  const look = () =>
    page.evaluate(() => {
      const css = (sel: string) => getComputedStyle(document.querySelector(sel)!);
      return {
        frame: css('.drop-overlay .frame').boxShadow,
        tile: css('.drop-panel .glyph').backgroundColor,
        title: css('.drop-panel h2').color,
        summary: css('[data-testid="drop-summary"]').color,
        onCard: css('[data-testid="drop-copy"]').boxShadow,
        onIcon: css('[data-testid="drop-copy"] .icon').color,
        cardTitle: css('[data-testid="drop-link"] .dm-title').color,
        keycap: css('[data-testid="drop-link"] .kbd').color,
      };
    });
  const token = (name: string) =>
    page.evaluate((name) => {
      const probe = document.createElement('span');
      document.body.append(probe);
      probe.style.color = `var(${name})`;
      const out = getComputedStyle(probe).color;
      probe.remove();
      return out;
    }, name);
  try {
    await drag(page, 'dragenter', THREE);
    await expect(page.getByTestId('drop-overlay')).toBeVisible();
    const active = await look();
    expect(active.frame).not.toBe('none');
    expect(active.frame).toContain(await token('--focus'));
    expect(active.onCard).toContain(await token('--accent-ring'));
    expect(active.title).toBe(await token('--text-primary'));
    // A drag from Finder arrives while another app is active: not key, not main (forced here, as main sets them).
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-window-inactive', '');
      document.documentElement.setAttribute('data-window-not-main', '');
    });
    // The forced state is in effect: the chrome above the overlay has receded.
    await expect.poll(() => page.locator('.titlebar .tb-title .title').evaluate((e) => getComputedStyle(e).color)).toBe(await token('--text-inactive'));
    expect(await look()).toEqual(active);
  } finally {
    await app.close();
  }
});

test('a duplicate dropped on a background window: main brings the window forward before the duplicate sheet', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await importPaths(page, [PDF]);
    await realFiles(page, [PDF]);
    // Record each focus() on the main window with the number of sheets showing at that moment.
    await (await mainWindow(app)).evaluate((w) => {
      const log: number[] = [];
      (globalThis as { __focusLog?: number[] }).__focusLog = log;
      const focus = w.focus.bind(w);
      w.focus = () => {
        log.push(w.getChildWindows().filter((c) => c.isVisible()).length);
        focus();
      };
    });
    // Finder stays the active app after a drag: here another window has the key. Its page is awaited here, so the
    // sheet's is the next window.
    const probeOpened = app.waitForEvent('window');
    await app.evaluate(({ BrowserWindow }) => {
      const probe = new BrowserWindow({ width: 300, height: 200, show: true });
      void probe.loadURL('about:blank');
      probe.focus();
      (globalThis as { __probeWindow?: unknown }).__probeWindow = probe;
    });
    await probeOpened;
    await expect(page.locator('html')).toHaveAttribute('data-window-inactive', '');
    const sheet = await expectWindow(app, 'sheet', () => dropReal(page));
    expect((await app.evaluate(() => (globalThis as { __focusLog?: number[] }).__focusLog))?.[0]).toBe(0);
    await closeSheet(sheet, 'Escape');
    await app.evaluate(() => (globalThis as { __probeWindow?: { close(): void } }).__probeWindow?.close());
  } finally {
    await app.close();
  }
});
