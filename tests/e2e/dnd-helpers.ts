// Helpers of the drag and drop specs (M5). A drag is a real Chromium drag that Playwright intercepts (mouse down,
// move, up), so dragstart, React Aria's own handlers and dragend are the browser's; Finder's files are CDP drag events
// carrying a real file.
import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';

/** The platform's move key while dropping (React Aria: ⌘ on macOS, Shift elsewhere). */
export const MOVE_KEY = process.platform === 'darwin' ? 'Meta' : 'Shift';
export type DragKind = 'items' | 'collection' | 'tag';

/** `count` animation frames: whatever a handled event renders is on screen by then. */
export const frames = (page: Page, count = 2): Promise<void> =>
  page.evaluate(
    (n) =>
      new Promise<void>((resolve) => {
        let left = n;
        const tick = () => (--left <= 0 ? resolve() : void requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    count,
  );

/** Where to put the pointer on `loc`: its label side (a wide row's left 140 px), `fy` of its height. */
export async function point(loc: Locator, fx = 0.5, fy = 0.5): Promise<{ x: number; y: number }> {
  const box = await loc.boundingBox();
  if (!box) throw new Error('dnd: the element has no box (scrolled out of a virtual list, or not there)');
  return { x: box.x + Math.min(box.width * fx, 140), y: box.y + box.height * fy };
}

/** Presses on `from` and moves a little: the browser starts the drag after the first moves. */
export async function beginDrag(page: Page, from: Locator, kind: DragKind): Promise<void> {
  const p = await point(from);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 8, p.y + 5, { steps: 3 });
  await expect(page.locator('html')).toHaveAttribute('data-dnd', kind);
  await frames(page, 2);
}

/** Moves the held pointer over `over` (`fy`: how far down its height) and lets two frames pass. */
export async function hover(page: Page, over: Locator, opts: { fy?: number } = {}): Promise<void> {
  const p = await point(over, 0.5, opts.fy ?? 0.5);
  await page.mouse.move(p.x, p.y, { steps: 8 });
  // Chromium hands the page a dragover only now and then while the pointer moves: a few 1 px moves settle the last one.
  for (let i = 1; i <= 3; i++) {
    await frames(page, 1);
    await page.mouse.move(p.x + i, p.y);
  }
  await frames(page, 2);
}

export async function release(page: Page): Promise<void> {
  await page.mouse.up();
  await frames(page, 3);
  await page.waitForTimeout(80);
}

/** Cancels the drag the way a user does (esc), then lets the mouse go. */
export async function cancelDrag(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await frames(page, 2);
  await page.mouse.up();
  await frames(page, 3);
  await page.waitForTimeout(80);
}

/** Press, move over `to`, drop. `key`: a modifier held while over the target (the move key). */
export async function dragTo(page: Page, from: Locator, kind: DragKind, to: Locator, opts: { key?: 'Shift' | 'Meta' } = {}): Promise<void> {
  await beginDrag(page, from, kind);
  if (opts.key) await page.keyboard.down(opts.key);
  await hover(page, to);
  await release(page);
  if (opts.key) await page.keyboard.up(opts.key);
}

/** The drop targets marked now: a table row by its item id, anything else by its test id. */
export const marked = (page: Page): Promise<string[]> =>
  page.evaluate(() => [...document.querySelectorAll('[data-drop-target]')].map((e) => e.getAttribute('data-item-id') ?? e.getAttribute('data-testid') ?? e.className));

/** The titles in the table, in table order (a virtual body's DOM order need not be the visual one). */
export const tableTitles = (page: Page): Promise<string[]> =>
  page
    .locator('[data-testid="item-row"]')
    .evaluateAll((rows) => rows.map((r) => [Number(r.getAttribute('data-index')), r.getAttribute('data-title') ?? ''] as const).sort((a, b) => a[0] - b[0]).map(([, title]) => title));

/** Records what each row drag shows as its image (the image node is taken away the tick after it is handed over). */
export async function recordPreviews(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __previews?: Array<{ title: string; badge: string | null }> };
    w.__previews = [];
    new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes)
          if (node instanceof HTMLElement && node.classList.contains('dnd-preview-host'))
            w.__previews!.push({ title: node.querySelector('.dnd-preview-title')?.textContent ?? '', badge: node.querySelector('.dnd-preview-badge')?.textContent ?? null });
    }).observe(document.body, { childList: true });
  });
}
export const previews = (page: Page) => page.evaluate(() => (window as unknown as { __previews: Array<{ title: string; badge: string | null }> }).__previews);

/** The files of a drag from Finder, as the OS sends them (a real file on disk); `alt` is the ⌥ key held. */
export async function finderDrag(page: Page, file: string) {
  const cdp = await page.context().newCDPSession(page);
  const data = { items: [], files: [file], dragOperationsMask: 3 };
  return {
    async send(type: 'dragEnter' | 'dragOver' | 'drop', where: Locator | { x: number; y: number }, opts: { alt?: boolean } = {}): Promise<void> {
      const at = 'x' in where ? where : await point(where);
      const modifiers = opts.alt ? 1 : 0;
      if (type === 'dragOver') {
        // Chromium hands the page a dragover only now and then, and the same point twice is not a move: a few 1 px steps settle the last one.
        for (let i = 0; i < 4; i++) {
          await cdp.send('Input.dispatchDragEvent', { type, x: at.x + i, y: at.y, modifiers, data });
          await page.waitForTimeout(60);
        }
      } else {
        await cdp.send('Input.dispatchDragEvent', { type, x: at.x, y: at.y, modifiers, data });
      }
      await frames(page, 2);
    },
    async cancel(): Promise<void> {
      await cdp.send('Input.dispatchDragEvent', { type: 'dragCancel', x: 0, y: 0, data });
      await frames(page, 2);
    },
    close: () => cdp.detach(),
  };
}

/** The next call of an IPC channel is refused (an error answer); the calls after it go to the handler that was there. */
export async function failOnce(app: ElectronApplication, channel: string): Promise<void> {
  await app.evaluate(({ ipcMain }, channel) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (...a: unknown[]) => Promise<unknown>> })._invokeHandlers;
    const original = handlers.get(channel)!;
    let refused = false;
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async (...a) => {
      if (!refused) {
        refused = true;
        return { ok: false, code: 'INTERNAL', message: '시험을 위해 거절했습니다.', retryable: false };
      }
      return original(...(a as [unknown, unknown]));
    });
  }, channel);
}
