// Window-wide drop overlay (design-spec 6 드롭 오버레이, 7.2): Finder → window, ⌥ = link, file counts.
// A real Finder drag (⌥ while dragging, the cursor badge) is a manual check on real hardware; these are synthetic drags.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { FIXTURES, closeSheet, drag, dropSource, expectWindow, importPaths, launch, mainWindow, openItem, runMenuCommand } from './helpers';

const PDF = path.join(FIXTURES, 'sample.pdf');
const IS_MAC = process.platform === 'darwin';

/** dragenter, dragover and drop of the real files in #drop-source, ⌥ held or not. */
async function dropReal(page: Page, altKey = false): Promise<void> {
  for (const type of ['dragenter', 'dragover', 'drop'] as const) await drag(page, type, 'source', { altKey });
}
/**
 * The held drag stops sending dragovers and `event` arrives (the window's blur, or a dragend): is the overlay gone two
 * frames later?
 */
const goneAfter = (page: Page, event: 'blur' | 'dragend') =>
  page.evaluate(async (event) => {
    clearInterval((window as unknown as { __learnDragRepeat?: ReturnType<typeof setInterval> }).__learnDragRepeat);
    if (event === 'blur') window.dispatchEvent(new FocusEvent('blur'));
    else document.body.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    return document.querySelector('[data-testid="drop-overlay"]') === null;
  }, event);
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
    // A line per sentence in the copy card (T11-n2): innerText keeps the break only where it is rendered (pre-line).
    expect(await page.getByTestId('drop-copy').locator('.dm-text').evaluate((e) => (e as HTMLElement).innerText)).toBe('라이브러리 폴더에 복사합니다.\n원본은 그대로 둡니다.');
    // The key that switches to linking, from the accelerator helpers: ⌥ on macOS, Alt elsewhere.
    await expect(page.getByTestId('drop-link').locator('.kbd')).toHaveText(IS_MAC ? '⌥' : 'Alt');
    expect(await overlay.boundingBox()).toMatchObject({ x: 0, y: 52 });
    // The sidebar top (traffic lights, toggle) stays above the overlay.
    expect(await page.evaluate(() => document.elementFromPoint(200, 26)?.closest('[data-testid="sidebar-top"]') !== null)).toBe(true);
    expect(await drag(page, 'dragover', THREE, { altKey: true })).toBe('link');
    await expect(overlay).toHaveAttribute('data-mode', 'link');
    await expect(page.getByTestId('drop-link')).toHaveAttribute('data-on', '');
    await expect(page.getByTestId('drop-copy')).not.toHaveAttribute('data-on');
    expect(await drag(page, 'dragover', THREE)).toBe('copy');
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
    await dropSource(page, [PDF]);
    await dropReal(page);
    await expect(page.getByTestId('import-done')).toHaveText(/자료 1개를 가져왔습니다/);
    await dropSource(page, [path.join(FIXTURES, 'sample-h264-aac.mp4')]);
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

// Critique T13R2-m1: while a drop's copies are being made into an empty library, the screen said "아직 자료가 없습니다"
// with disabled buttons. The copy is held in main (the importer's fs.copyFile waits) so the import stays open.
test('a first drop into an empty library says it is bringing N items in: no empty state, no buttons, until the rows', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await app.evaluate(() => {
      const fsp = process.getBuiltinModule('node:fs/promises');
      const copy = fsp.copyFile;
      const g = globalThis as { __learnReleaseCopy?: () => void };
      const held = new Promise<void>((resolve) => (g.__learnReleaseCopy = resolve));
      fsp.copyFile = (async (...args: Parameters<typeof copy>) => {
        await held;
        return copy(...args);
      }) as typeof copy;
    });
    // Every painted frame from the drop event on (an animation frame runs before each paint; commits that the same
    // task replaces are never seen, so they are not counted).
    await page.evaluate(() => {
      const w = window as unknown as { __screens: string[]; __dropped?: boolean };
      w.__screens = [];
      addEventListener('drop', () => (w.__dropped = true), true);
      const frame = () => {
        const empty = document.querySelector('[data-testid="empty-state"]');
        if (w.__dropped && empty) w.__screens.push(`${empty.hasAttribute('data-busy') ? 'busy' : 'empty'}:${empty.querySelectorAll('button').length}`);
        if (!document.querySelector('[data-testid="item-row"]')) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    await dropSource(page, [PDF, path.join(FIXTURES, 'sample-h264-aac.mp4')]);
    await dropReal(page);
    const empty = page.getByTestId('empty-state');
    await expect(empty).toHaveAttribute('data-busy', '');
    await expect(empty.getByRole('heading')).toHaveText('자료 2개를 가져오는 중…');
    await expect(empty.getByRole('button')).toHaveCount(0);
    await page.waitForTimeout(300); // held: it stays the busy screen
    await expect(empty).toHaveAttribute('data-busy', '');
    await app.evaluate(() => (globalThis as { __learnReleaseCopy?: () => void }).__learnReleaseCopy?.());
    await expect(page.getByTestId('item-row')).toHaveCount(2);
    // From the drop on, every painted frame of the empty library was the busy screen (no flash of the buttons).
    const screens = await page.evaluate(() => (window as unknown as { __screens: string[] }).__screens);
    expect(screens.length).toBeGreaterThan(0);
    expect(screens.filter((x) => x !== 'busy:0')).toEqual([]);
  } finally {
    await app.close();
  }
});

test('no overlay while reading; the drag gets the no-drop cursor and a drop there imports nothing', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await importPaths(page, [PDF]);
    await openItem(page, 'sample');
    await drag(page, 'dragenter', THREE);
    expect(await drag(page, 'dragover', THREE)).toBe('none');
    await drag(page, 'drop', THREE);
    await twoFrames(page);
    await expect(page.getByTestId('drop-overlay')).toHaveCount(0);
    await expect(page.getByTestId('drop-failed')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('a sheet holds the window: no overlay, the no-drop cursor, and a drop is ignored (a window under a sheet takes no drops)', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const keys = await expectWindow(app, 'sheet', () => runMenuCommand(app, 'app.shortcuts'));
    await drag(page, 'dragenter', THREE);
    expect(await drag(page, 'dragover', THREE)).toBe('none');
    await drag(page, 'drop', THREE);
    await twoFrames(page);
    await expect(page.getByTestId('drop-overlay')).toHaveCount(0);
    await expect(page.getByTestId('drop-failed')).toHaveCount(0);
    await closeSheet(keys, 'Escape');
    // The sheet is gone: the window takes drops again.
    await drag(page, 'dragenter', THREE);
    await expect(page.getByTestId('drop-overlay')).toBeVisible();
    expect(await drag(page, 'dragover', THREE)).toBe('copy');
    await drag(page, 'dragleave', THREE);
  } finally {
    await app.close();
  }
});

test('the safety net: the overlay goes a second after the last dragover, on blur and on dragend; a held drag keeps it', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  const overlay = page.getByTestId('drop-overlay');
  try {
    // A drag cancelled outside the window whose dragleave never came: no more dragovers, and the overlay goes by itself.
    await drag(page, 'dragenter', THREE, { repeat: false });
    await expect(overlay).toBeVisible();
    const shownAt = Date.now();
    await expect(overlay).toHaveCount(0, { timeout: 5_000 });
    expect(Date.now() - shownAt).toBeGreaterThan(500);
    // A drag held over the window keeps sending dragovers (as the OS does): the overlay stays past the second.
    await drag(page, 'dragenter', THREE);
    await page.waitForTimeout(1_500);
    await expect(overlay).toBeVisible();
    await drag(page, 'dragleave', THREE);
    await expect(overlay).toHaveCount(0);
    // The window loses the focus, or a drag that began in the window ends: the overlay goes at once, well inside the
    // idle second (the held drag's last dragover came less than 100 ms before).
    for (const event of ['blur', 'dragend'] as const) {
      await drag(page, 'dragenter', THREE);
      await expect(overlay).toBeVisible();
      expect(await goneAfter(page, event), event).toBe(true);
    }
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
    await drag(page, 'dragleave', THREE);
  } finally {
    await app.close();
  }
});

test('a duplicate dropped on a background window: main brings the window forward before the duplicate sheet', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await importPaths(page, [PDF]);
    await dropSource(page, [PDF]);
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
