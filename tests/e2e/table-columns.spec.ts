// The library table's header (M5 spec 5.1, 5.2): it sits outside the vertical scroller, so a classic scroll bar starts
// under it and the header ends where the bar's column begins; sideways, header and body move together. Dragging a header
// cell reorders the columns (a 2 px accent line, esc cancels, the order is saved on release).
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { LIBRARY_COLUMN_IDS } from '../../packages/domain/src/library-columns';
import { expectNoSeriousA11y } from './a11y';
import { FIXTURES, importPaths, launch, mainWindow, rowAt, seedLibrary, showItemPanel, stubContextMenu } from './helpers';

const PDF = path.join(FIXTURES, 'sample.pdf');
const dirs = (i: { outputPath(...p: string[]): string }) => [i.outputPath('library'), i.outputPath('userdata')] as const;
const header = (page: Page, col: string) => page.locator(`[data-testid="column-header"][data-col="${col}"]`);
const scroller = (page: Page) => page.getByTestId('library-scroller');

/** The header row's and the scroller's edges: the header stops at the scroll bar's column and the bar starts under it. */
const edges = (page: Page) =>
  page.evaluate(() => {
    const clip = document.querySelector('[data-testid="table-head-clip"]')!.getBoundingClientRect();
    const view = document.querySelector<HTMLElement>('[data-testid="library-scroller"]')!;
    const box = view.getBoundingClientRect();
    return { clipBottom: clip.bottom, clipRight: clip.right, top: box.top, clientRight: box.left + view.clientWidth, right: box.right, gutter: view.offsetWidth - view.clientWidth };
  });
/** Each shown column's header cell against the same column's cell in the first row: any difference in the left or right edge. */
const misaligned = (page: Page) =>
  page.evaluate(() => {
    const row = document.querySelector('[data-testid="item-row"][data-index="0"]')!;
    return [...document.querySelectorAll<HTMLElement>('[data-testid="column-header"]')]
      .map((h) => {
        const cell = row.querySelector<HTMLElement>(`[data-col="${h.dataset['col']}"]`)!.getBoundingClientRect();
        const head = h.getBoundingClientRect();
        return { col: h.dataset['col']!, left: Math.round((head.left - cell.left) * 10) / 10, right: Math.round((head.right - cell.right) * 10) / 10 };
      })
      .filter((m) => m.left !== 0 || m.right !== 0);
  });

test('the header sits above the scroller: the scroll bar starts under it, the header ends where the bar begins, the cells line up, sideways they move together, a wheel over it scrolls the table', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    const [pdf] = await importPaths(page, [PDF]);
    await seedLibrary(app, { count: 150, from: pdf! });
    await expect(page.getByTestId('toolbar-count')).toHaveText('151개');
    const start = await edges(page);
    if (process.platform === 'linux') expect(start.gutter, 'Chromium on Linux draws a classic scroll bar').toBeGreaterThan(0);
    expect(start.clipBottom).toBeCloseTo(start.top, 0); // the scroller (and its bar) begins at the header's bottom edge
    expect(start.clipRight).toBeCloseTo(start.clientRight, 0); // the header ends where the bar's column begins
    expect(await misaligned(page)).toEqual([]);
    await expectNoSeriousA11y(page, 'library table, header outside the scroller');

    // A wheel over the header scrolls the body (the header is no longer inside the scroller).
    const box = (await header(page, 'year').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 300);
    await expect.poll(() => scroller(page).evaluate((e) => e.scrollTop)).toBeGreaterThan(0);
    expect(await misaligned(page)).toEqual([]);

    // Sideways: 1024 px with the sidebar and the item panel leave the table narrower than its columns.
    await (await mainWindow(app)).evaluate((w) => w.setContentSize(1024, w.getContentSize()[1]!));
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThan(1100);
    await showItemPanel(app, page);
    await expect.poll(() => scroller(page).evaluate((e) => e.scrollWidth - e.clientWidth), { message: 'the columns must overflow the table here' }).toBeGreaterThan(0);
    await scroller(page).evaluate((e) => e.scrollTo(0, 0));
    await scroller(page).evaluate((e) => (e.scrollLeft = 120));
    await expect.poll(() => page.getByTestId('table-head-clip').evaluate((e) => e.scrollLeft)).toBe(120);
    expect(await misaligned(page)).toEqual([]);
    const over = (await header(page, 'creators').boundingBox())!; // the table is scrolled: a cell that is in view now
    await page.mouse.move(over.x + 20, over.y + over.height / 2);
    await page.mouse.wheel(60, 0); // a sideways sweep over the header moves the table
    await expect.poll(() => scroller(page).evaluate((e) => e.scrollLeft)).toBeGreaterThan(120);
    await expect.poll(async () => (await scroller(page).evaluate((e) => e.scrollLeft)) - (await page.getByTestId('table-head-clip').evaluate((e) => e.scrollLeft))).toBe(0);
    expect(await misaligned(page)).toEqual([]);
    await scroller(page).evaluate((e) => (e.scrollLeft = e.scrollWidth));
    const last = (await header(page, 'createdAt').boundingBox())!;
    const clip = (await page.getByTestId('table-head-clip').boundingBox())!;
    expect(last.x + last.width).toBeCloseTo(clip.x + clip.width, 0); // scrolled to the end: the last cell meets the header's edge

    // No classic bar (overlay scroll bars): the gutter is 0 and the header spans the whole table.
    await page.addStyleTag({ content: '[data-testid="library-scroller"] { scrollbar-width: none; }' });
    await expect.poll(() => page.evaluate(() => document.querySelector<HTMLElement>('[data-testid="library-table"]')!.style.getPropertyValue('--scrollbar-w'))).toBe('0px');
    const flat = await edges(page);
    expect(flat.gutter).toBe(0);
    expect(flat.clipRight).toBeCloseTo(flat.right, 0);
    expect(await misaligned(page)).toEqual([]);
  } finally {
    await app.close();
  }
});

test('at 1024 px the columns overflow the table and the rows keep their 8 px inset at both ends of the sideways scroll, the selected row filled across it, the header over the same columns', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    const [pdf] = await importPaths(page, [PDF]);
    await seedLibrary(app, { count: 150, from: pdf! });
    await expect(page.getByTestId('toolbar-count')).toHaveText('151개');
    await (await mainWindow(app)).evaluate((w) => w.setContentSize(1024, w.getContentSize()[1]!));
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThan(1100);
    await showItemPanel(app, page);
    await expect.poll(() => scroller(page).evaluate((e) => e.scrollWidth - e.clientWidth), { message: 'the columns must overflow the table here' }).toBeGreaterThan(0);
    /** The selected row's box against the scroller's visible edges, and its fill. */
    const rowBox = () =>
      page.evaluate(() => {
        const view = document.querySelector<HTMLElement>('[data-testid="library-scroller"]')!;
        const box = view.getBoundingClientRect();
        const row = document.querySelector<HTMLElement>('[data-testid="item-row"][data-index="2"]')!;
        const r = row.getBoundingClientRect();
        return { scrollLeft: view.scrollLeft, max: view.scrollWidth - view.clientWidth, left: r.left - box.left, right: box.left + view.clientWidth - r.right, fill: getComputedStyle(row).backgroundColor, width: r.width, content: view.scrollWidth - 16 };
      });
    await rowAt(page, 2).click(); // focusing a row must not scroll the table sideways to put its edge flush with the view's
    await expect(rowAt(page, 2)).toHaveAttribute('aria-selected', 'true');
    let start = await rowBox();
    expect(start.scrollLeft).toBe(0);
    expect(start.left).toBeCloseTo(8, 0);
    expect(start.width).toBeCloseTo(start.content, 0); // the fill spans the whole row, not only the part in view
    expect(start.fill).not.toBe('rgba(0, 0, 0, 0)');
    expect(await misaligned(page)).toEqual([]);

    await scroller(page).evaluate((e) => (e.scrollLeft = e.scrollWidth));
    await expect.poll(async () => (await rowBox()).scrollLeft).toBe((await rowBox()).max);
    const end = await rowBox();
    expect(end.right).toBeCloseTo(8, 0);
    expect(end.width).toBeCloseTo(end.content, 0);
    expect(end.fill).toBe(start.fill);
    expect(await misaligned(page)).toEqual([]);
    await expect.poll(() => page.getByTestId('table-head-clip').evaluate((e) => e.scrollLeft)).toBe(end.scrollLeft);

    // A key that moves the cursor in the scrolled-aside table keeps the position and the inset.
    await page.keyboard.press('ArrowDown');
    await expect(rowAt(page, 3)).toBeFocused();
    const moved = await page.evaluate(() => {
      const view = document.querySelector<HTMLElement>('[data-testid="library-scroller"]')!;
      const r = document.querySelector('[data-testid="item-row"][data-index="3"]')!.getBoundingClientRect();
      return { scrollLeft: view.scrollLeft, right: view.getBoundingClientRect().left + view.clientWidth - r.right };
    });
    expect(moved.scrollLeft).toBe(end.scrollLeft);
    expect(moved.right).toBeCloseTo(8, 0);
    await scroller(page).evaluate((e) => (e.scrollLeft = 0));
    start = await rowBox();
    expect(start.left).toBeCloseTo(8, 0);
    expect(await misaligned(page)).toEqual([]);
  } finally {
    await app.close();
  }
});

test('the keyboard cursor still scrolls its row in under the 4 px top inset and the 8 px bottom inset of a body that has no header of its own', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    const [pdf] = await importPaths(page, [PDF]);
    await seedLibrary(app, { count: 150, from: pdf! });
    await expect(page.getByTestId('toolbar-count')).toHaveText('151개');
    await rowAt(page, 0).click();
    await page.keyboard.press('End');
    await expect(rowAt(page, 150)).toBeFocused();
    const gapBelow = () =>
      page.evaluate(() => {
        const view = document.querySelector<HTMLElement>('[data-testid="library-scroller"]')!;
        const row = document.querySelector('[data-testid="item-row"][data-index="150"]')!.getBoundingClientRect();
        return view.getBoundingClientRect().top + view.clientHeight - row.bottom;
      });
    await expect.poll(gapBelow).toBeCloseTo(8, 0);
    await page.keyboard.press('Home');
    await expect(rowAt(page, 0)).toBeFocused();
    const gapAbove = () =>
      page.evaluate(() => {
        const view = document.querySelector<HTMLElement>('[data-testid="library-scroller"]')!;
        return document.querySelector('[data-testid="item-row"][data-index="0"]')!.getBoundingClientRect().top - view.getBoundingClientRect().top;
      });
    await expect.poll(gapAbove).toBeCloseTo(4, 0);
    // One row up from the 40th: PageUp/PageDown land fully below the header's edge (the scroller's top).
    await page.keyboard.press('PageDown');
    await page.keyboard.press('PageDown');
    const r = await page.evaluate(() => {
      const view = document.querySelector<HTMLElement>('[data-testid="library-scroller"]')!.getBoundingClientRect();
      const cur = document.activeElement!.getBoundingClientRect();
      return { top: cur.top - view.top, bottom: view.bottom - cur.bottom };
    });
    expect(r.top).toBeGreaterThanOrEqual(0);
    expect(r.bottom).toBeGreaterThanOrEqual(0);
  } finally {
    await app.close();
  }
});

test('a cursor row revealed from the middle of the list lands 4 px under the scroller top coming from above and 8 px over its bottom coming from below', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    const [pdf] = await importPaths(page, [PDF]);
    await seedLibrary(app, { count: 150, from: pdf! });
    await expect(page.getByTestId('toolbar-count')).toHaveText('151개');
    const gaps = (index: number) =>
      page.evaluate((i) => {
        const view = document.querySelector<HTMLElement>('[data-testid="library-scroller"]')!;
        const box = view.getBoundingClientRect();
        const row = document.querySelector(`[data-testid="item-row"][data-index="${i}"]`)?.getBoundingClientRect();
        return row === undefined ? null : { top: row.top - box.top, bottom: box.top + view.clientHeight - row.bottom };
      }, index);
    const rowHeight = 28;
    await scroller(page).evaluate((e, top) => void (e.scrollTop = top), 80 * rowHeight);
    await expect(rowAt(page, 80)).toBeVisible();
    await rowAt(page, 80).click(); // the cursor is row 80, in the middle of the list and of the view
    // Scrolled away so that the cursor is above the view: ↑ brings row 79 in from above (its top edge meets the 4 px inset).
    await scroller(page).evaluate((e, top) => void (e.scrollTop = top), 110 * rowHeight);
    await page.keyboard.press('ArrowUp');
    await expect(rowAt(page, 79)).toBeFocused();
    await expect.poll(async () => (await gaps(79))?.top).toBeCloseTo(4, 0);
    // And below the view: ↓ brings row 80 in from below (its bottom edge meets the 8 px inset).
    await scroller(page).evaluate((e, top) => void (e.scrollTop = top), 20 * rowHeight);
    await page.keyboard.press('ArrowDown');
    await expect(rowAt(page, 80)).toBeFocused();
    await expect.poll(async () => (await gaps(80))?.bottom).toBeCloseTo(8, 0);
  } finally {
    await app.close();
  }
});

const DEFAULT_HEADERS = ['제목', '저자', '연도', '종류', '추가일'];
const setting = (page: Page, key: string) => page.evaluate((k) => window.learn.settings.get({ key: k }).then((r) => (r.ok ? r.data : 'failed')), key);
const storedOrder = async (page: Page) => ((await setting(page, 'library.columns')) as { order: string[] } | null)?.order ?? null;
/** Presses on a header cell's middle (clear of its 8 px edge) and returns its box and the y of the press. */
async function press(page: Page, col: string): Promise<{ box: { x: number; y: number; width: number; height: number }; y: number }> {
  const box = (await header(page, col).boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  return { box, y };
}
const dropLine = (page: Page) => page.getByTestId('column-drop-line');
const accent = (page: Page) =>
  page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.background = 'var(--accent)';
    document.body.append(probe);
    const c = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return c;
  });

test('a dragged header cell lands where the 2 px accent line showed, saved on release and kept over a restart; 열 구성 되돌리기 puts the order back; the cells follow', async ({}, testInfo) => {
  const [lib, ud] = dirs(testInfo);
  let s = await launch(lib, ud);
  try {
    await importPaths(s.page, [PDF]);
    await expect(s.page.getByTestId('column-header')).toHaveText(DEFAULT_HEADERS);
    const target = (await header(s.page, 'creators').boundingBox())!;
    const { y } = await press(s.page, 'createdAt');
    await s.page.mouse.move(target.x + 6, y, { steps: 6 });
    await expect(dropLine(s.page)).toBeVisible();
    await expect(header(s.page, 'createdAt')).toHaveAttribute('data-dragging', 'true');
    const line = (await dropLine(s.page).boundingBox())!;
    expect(line.width).toBe(2);
    expect(line.height).toBe(28);
    expect(line.x + 1).toBeCloseTo(target.x, 0); // centred on the boundary before 저자
    expect(await dropLine(s.page).evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(await accent(s.page));
    expect(await setting(s.page, 'library.columns')).toBeNull(); // nothing saved while dragging
    await s.page.mouse.up();
    await expect(s.page.getByTestId('column-header')).toHaveText(['제목', '추가일', '저자', '연도', '종류']);
    await expect(dropLine(s.page)).toHaveCount(0);
    await expect(header(s.page, 'createdAt')).not.toHaveAttribute('data-dragging', 'true');
    // The cells of a row follow the header, and nothing was sorted by the release.
    expect(await rowAt(s.page, 0).locator('[data-col]').evaluateAll((cells) => cells.map((c) => c.getAttribute('data-col')))).toEqual(['title', 'createdAt', 'creators', 'year', 'type']);
    await expect(header(s.page, 'createdAt')).toHaveAttribute('aria-sort', 'descending'); // still the default sort
    const rest = LIBRARY_COLUMN_IDS.filter((id) => !['title', 'createdAt', 'creators', 'year', 'type'].includes(id));
    await expect.poll(() => storedOrder(s.page)).toEqual(['title', 'createdAt', 'creators', 'year', 'type', ...rest]);
    expect(await misaligned(s.page)).toEqual([]);
    await s.app.close();

    s = await launch(lib, ud);
    await expect(s.page.getByTestId('column-header')).toHaveText(['제목', '추가일', '저자', '연도', '종류']);
    await stubContextMenu(s.app, '열 구성 되돌리기');
    await header(s.page, 'title').click({ button: 'right' });
    await expect(s.page.getByTestId('column-header')).toHaveText(DEFAULT_HEADERS);
    await expect.poll(() => storedOrder(s.page)).toEqual([...LIBRARY_COLUMN_IDS]);
  } finally {
    await s.app.close();
  }
});

test('a press that moves under 4 px is still a click that sorts; a longer one never sorts, and over its own cell it changes nothing', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await importPaths(page, [PDF]);
    const year = header(page, 'year');
    let { box, y } = await press(page, 'year');
    await page.mouse.move(box.x + box.width / 2 + 3, y);
    await page.mouse.up();
    await expect(year).toHaveAttribute('aria-sort', 'ascending'); // a click: 연도 starts ascending
    ({ box, y } = await press(page, 'year'));
    await page.mouse.move(box.x + box.width / 2 + 8, y, { steps: 4 });
    await expect(dropLine(page)).toHaveCount(0); // over its own cell the column would not move: no line
    await page.mouse.up();
    await expect(year).toHaveAttribute('aria-sort', 'ascending'); // a click would have reversed it
    await expect(page.getByTestId('column-header')).toHaveText(DEFAULT_HEADERS);
    expect(await setting(page, 'library.columns')).toBeNull();
    await year.click();
    await expect(year).toHaveAttribute('aria-sort', 'descending'); // and a plain click still sorts afterwards
  } finally {
    await app.close();
  }
});

test('esc cancels a header drag: the line goes, release saves nothing, and the table\'s own esc (clear the selection) is not also run', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await importPaths(page, [PDF]);
    await rowAt(page, 0).click();
    await expect(rowAt(page, 0)).toHaveAttribute('aria-selected', 'true');
    const end = (await header(page, 'createdAt').boundingBox())!;
    const { y } = await press(page, 'year');
    await page.mouse.move(end.x + end.width - 4, y, { steps: 6 });
    await expect(dropLine(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dropLine(page)).toHaveCount(0);
    await expect(header(page, 'year')).not.toHaveAttribute('data-dragging', 'true');
    await page.mouse.move(end.x + end.width - 20, y, { steps: 3 }); // still held: nothing comes back
    await expect(dropLine(page)).toHaveCount(0);
    await page.mouse.up();
    await expect(page.getByTestId('column-header')).toHaveText(DEFAULT_HEADERS);
    expect(await setting(page, 'library.columns')).toBeNull();
    await expect(rowAt(page, 0)).toHaveAttribute('aria-selected', 'true'); // the esc was the drag's alone
    await expect(header(page, 'year')).toHaveAttribute('aria-sort', 'none');
    await page.keyboard.press('Escape'); // with no drag the table's esc works as before
    await expect(rowAt(page, 0)).toHaveAttribute('aria-selected', 'false');
  } finally {
    await app.close();
  }
});

test('the title stays first: it cannot be dragged and nothing can be put before it', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await importPaths(page, [PDF]);
    const creators = (await header(page, 'creators').boundingBox())!;
    const last = (await header(page, 'createdAt').boundingBox())!;
    let { y } = await press(page, 'title');
    await page.mouse.move(last.x + last.width - 4, y, { steps: 6 });
    await expect(dropLine(page)).toHaveCount(0);
    await expect(header(page, 'title')).not.toHaveAttribute('data-dragging', 'true');
    await page.mouse.up();
    await expect(page.getByTestId('column-header')).toHaveText(DEFAULT_HEADERS);
    expect(await setting(page, 'library.columns')).toBeNull();
    // 연도 dragged over the title takes the first boundary it may: right after the title.
    const title = (await header(page, 'title').boundingBox())!;
    ({ y } = await press(page, 'year'));
    await page.mouse.move(title.x + 6, y, { steps: 6 });
    const line = (await dropLine(page).boundingBox())!;
    expect(line.x + 1).toBeCloseTo(creators.x, 0);
    await page.mouse.up();
    await expect(page.getByTestId('column-header')).toHaveText(['제목', '연도', '저자', '종류', '추가일']);
  } finally {
    await app.close();
  }
});

test('a column edge still resizes and never starts a reorder; a header context menu still opens', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await importPaths(page, [PDF]);
    const edge = (await page.locator('[data-testid="column-resizer"][data-col="creators"]').boundingBox())!;
    const y = edge.y + edge.height / 2;
    await page.mouse.move(edge.x + edge.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(edge.x + edge.width / 2 - 40, y, { steps: 4 });
    await expect(dropLine(page)).toHaveCount(0);
    await expect(header(page, 'creators')).not.toHaveAttribute('data-dragging', 'true');
    await expect.poll(async () => (await header(page, 'creators').boundingBox())?.width).toBe(140);
    await page.mouse.up();
    await expect(page.getByTestId('column-header')).toHaveText(DEFAULT_HEADERS);
    await expect.poll(async () => ((await setting(page, 'library.columns')) as { widths: object }).widths).toEqual({ creators: 140, year: 104 });
    await stubContextMenu(app, '크기');
    await header(page, 'year').click({ button: 'right' });
    await expect(page.getByTestId('column-header')).toHaveText([...DEFAULT_HEADERS, '크기']);
  } finally {
    await app.close();
  }
});

test('in the recent view the column 마지막으로 연 날 stays right after the title: it cannot be dragged and nothing goes before it', async ({}, testInfo) => {
  const [lib, ud] = dirs(testInfo);
  let s = await launch(lib, ud);
  try {
    const [item] = await importPaths(s.page, [PDF]);
    expect((await s.page.evaluate((itemId) => window.learn.reader.open({ itemId }), item!.id)).ok).toBe(true); // opened now: the recent view has it
    expect((await s.page.evaluate(() => window.learn.settings.set({ key: 'library.view', value: { kind: 'recent' } }))).ok).toBe(true);
    await s.app.close();

    s = await launch(lib, ud);
    await expect(s.page.getByTestId('column-header')).toHaveText(['제목', '마지막으로 연 날', '저자', '연도', '종류', '추가일']);
    const opened = (await header(s.page, 'openedAt').boundingBox())!;
    let { y } = await press(s.page, 'openedAt');
    await s.page.mouse.move(opened.x + opened.width + 200, y, { steps: 6 });
    await expect(dropLine(s.page)).toHaveCount(0);
    await s.page.mouse.up();
    await expect(s.page.getByTestId('column-header')).toHaveText(['제목', '마지막으로 연 날', '저자', '연도', '종류', '추가일']);
    // 추가일 over 마지막으로 연 날 takes the first boundary it may: after it, before 저자.
    const creators = (await header(s.page, 'creators').boundingBox())!;
    ({ y } = await press(s.page, 'createdAt'));
    await s.page.mouse.move(opened.x + 6, y, { steps: 6 });
    expect((await dropLine(s.page).boundingBox())!.x + 1).toBeCloseTo(creators.x, 0);
    await s.page.mouse.up();
    await expect(s.page.getByTestId('column-header')).toHaveText(['제목', '마지막으로 연 날', '추가일', '저자', '연도', '종류']);
  } finally {
    await s.app.close();
  }
});
