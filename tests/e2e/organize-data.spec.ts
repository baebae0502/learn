// Organize data in the library table (no sidebar to change the scope yet): the stored view reopens at start (a collection with
// its path, the recent view with its own sort and 마지막으로 연 날 column, a view that cannot be shown), and a change reads
// only what it changes (counted in main, ipc/register.ts) — a tag or collection the snapshot, a metadata or opened notice
// the items concerned. Scope changes through the sidebar are checked where the sidebar is.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  FIXTURES, addToCollection, assignTag, createCollection, createTag, importPaths, ipcCalls, launch, organizeSnapshot, quietLibraryCalls, recordedPopups,
  rowByTitle, seedMetadata, showItemPanel, stubContextMenu,
} from './helpers';

const FILES = [path.join(FIXTURES, 'sample.pdf'), path.join(FIXTURES, '한글 경로 (테스트) #1.pdf'), path.join(FIXTURES, 'sample-h264-aac.mp4')];
const EXTRA = path.join(FIXTURES, 'sample-mpeg4part2.mp4');
const A = '신호 전달 개론';
const B = '단백질 접힘';
const C = '확률 노트';
const dirs = (i: { outputPath(...p: string[]): string }) => [i.outputPath('library'), i.outputPath('userdata')] as const;

test.beforeAll(() => {
  for (const f of [...FILES, EXTRA]) if (!fs.existsSync(f)) throw new Error(`fixture missing: ${f} — run \`pnpm fixtures\``);
});

/** Three items with known titles, in a library that is empty. */
async function seeded(page: Page) {
  const [a, b, c] = await importPaths(page, FILES);
  await seedMetadata(page, a!.id, { creators: [] }, A);
  await seedMetadata(page, b!.id, { creators: [] }, B);
  await seedMetadata(page, c!.id, { creators: [] }, C);
  await expect(rowByTitle(page, C)).toBeVisible();
  return [a!, b!, c!] as const;
}
/** The titles in the rows, top to bottom. */
const titles = (page: Page) =>
  page.getByTestId('item-row').evaluateAll((els) => els.sort((x, y) => Number(x.getAttribute('data-index')) - Number(y.getAttribute('data-index'))).map((e) => e.getAttribute('data-title')));
const storeView = (page: Page, value: unknown) =>
  page.evaluate(async (v) => {
    const r = await window.learn.settings.set({ key: 'library.view', value: v });
    if (!r.ok) throw new Error(r.code);
  }, value);
const setting = (page: Page, key: string) => page.evaluate((k) => window.learn.settings.get({ key: k }).then((r) => (r.ok ? r.data : 'failed')), key);
const plain = (s: string | null) => (s ?? '').replace(/ /g, ' ');

test('the stored view reopens a collection: its name as the title, the full path as the tooltip, the items of it and of its sub-collections, and the item panel\'s numbers', async ({}, testInfo) => {
  const [lib, ud] = dirs(testInfo);
  let s = await launch(lib, ud);
  try {
    const [a, b] = await seeded(s.page);
    const bio = await createCollection(s.page, '분자생물학');
    const ch6 = await createCollection(s.page, '6장 · 신호 전달', bio);
    await addToCollection(s.page, ch6, [a.id]);
    await addToCollection(s.page, bio, [b.id]);
    const snap = await organizeSnapshot(s.page);
    expect(snap.members[ch6]).toEqual([a.id]);

    await storeView(s.page, { kind: 'collection', id: bio });
    await s.app.close();
    s = await launch(lib, ud);
    await showItemPanel(s.app, s.page);
    await expect(s.page.getByTestId('toolbar-title')).toHaveText('분자생물학');
    await expect(s.page.getByTestId('toolbar-title')).toHaveAttribute('title', '분자생물학');
    expect((await titles(s.page)).sort()).toEqual([A, B].sort()); // B directly, A through 6장
    await expect(s.page.getByTestId('toolbar-count')).toHaveText('2개');
    await expect.poll(async () => plain(await s.page.getByTestId('inspector-stats').textContent())).toMatch(/^분자생물학 · 자료 2개\(PDF 2\) · [\d.]+ [KMG]?B$/);
    await expect(s.page).toHaveTitle('분자생물학');

    await storeView(s.page, { kind: 'collection', id: ch6 });
    await s.app.close();
    s = await launch(lib, ud);
    await expect(s.page.getByTestId('toolbar-title')).toHaveText('6장 · 신호 전달');
    await expect(s.page.getByTestId('toolbar-title')).toHaveAttribute('title', '분자생물학 › 6장 · 신호 전달');
    expect(await titles(s.page)).toEqual([A]);
    await expect(s.page.getByTestId('toolbar-count')).toHaveText('1개');
    await expect(s.page.getByTestId('column-header')).toHaveText(['제목', '저자', '연도', '종류', '추가일']); // the openedAt column is for the recent view
  } finally {
    await s.app.close();
  }
});

test('a stored view that cannot be shown (a collection that is gone) opens at 내 라이브러리, without a flash of anything else', async ({}, testInfo) => {
  const [lib, ud] = dirs(testInfo);
  let s = await launch(lib, ud);
  try {
    await seeded(s.page);
    await storeView(s.page, { kind: 'collection', id: '5a0b8c1d-3e4f-4a5b-8c6d-7e8f9a0b1c2d' });
    await s.app.close();
    s = await launch(lib, ud);
    await expect(s.page.getByTestId('toolbar-title')).toHaveText('내 라이브러리');
    expect((await titles(s.page)).sort()).toEqual([A, B, C].sort());
    await expect(s.page.getByTestId('toolbar-count')).toHaveText('3개');
  } finally {
    await s.app.close();
  }
});

test('the recent view: opened items only, newest first by its own sort, with 마지막으로 연 날 after the title and locked in the header menu', async ({}, testInfo) => {
  const [lib, ud] = dirs(testInfo);
  let s = await launch(lib, ud);
  try {
    const [a, b] = await seeded(s.page);
    for (const id of [a.id, b.id]) {
      const r = await s.page.evaluate((itemId) => window.learn.reader.open({ itemId }), id);
      if (!r.ok) throw new Error(`reader.open failed: ${r.code}`);
      // openedAt has millisecond precision and equal values keep the added-date order whatever the direction (sort.ts): on a
      // fast runner two back-to-back opens can share a millisecond, so each open gets its own.
      await s.page.waitForTimeout(10);
    }
    await storeView(s.page, { kind: 'recent' });
    await s.app.close();
    s = await launch(lib, ud);
    await expect(s.page.getByTestId('toolbar-title')).toHaveText('최근 연 자료');
    await expect.poll(() => titles(s.page)).toEqual([B, A]); // b was opened last
    await expect(s.page.getByTestId('toolbar-count')).toHaveText('2개');
    await expect(s.page.getByTestId('column-header')).toHaveText(['제목', '마지막으로 연 날', '저자', '연도', '종류', '추가일']);
    await expect(s.page.getByTestId('item-row').first().locator('[data-col="openedAt"]')).toHaveText(/\S/);
    await expect(s.page.locator('[data-testid="column-header"][data-col="openedAt"]')).toHaveAttribute('aria-sort', 'descending');

    // The header menu shows the forced column checked and fixed.
    await stubContextMenu(s.app, null);
    await s.page.locator('[data-testid="column-header"][data-col="year"]').click({ button: 'right' });
    await expect.poll(async () => (await recordedPopups(s.app)).length).toBe(1);
    const [menu] = await recordedPopups(s.app);
    expect(menu!.find((i) => i.label === '마지막으로 연 날')).toMatchObject({ checked: true, enabled: false });
    expect(menu!.find((i) => i.label === '수정일')).toMatchObject({ checked: false, enabled: true });

    // Pressing its header flips the recent view's own sort; the main sort is untouched and the column stays out of the stored columns.
    await s.page.locator('[data-testid="column-header"][data-col="openedAt"] button').click();
    await expect.poll(() => titles(s.page)).toEqual([A, B]);
    await expect.poll(() => setting(s.page, 'library.sort.recent')).toEqual({ column: 'openedAt', direction: 'asc' });
    expect(await setting(s.page, 'library.sort')).toBeNull();
    expect(((await setting(s.page, 'library.columns')) as { visible?: string[] } | null)?.visible ?? []).not.toContain('openedAt');
  } finally {
    await s.app.close();
  }
});

test('the recent view is not restored when nothing was opened within 30 days', async ({}, testInfo) => {
  const [lib, ud] = dirs(testInfo);
  let s = await launch(lib, ud);
  try {
    await seeded(s.page);
    await storeView(s.page, { kind: 'recent' });
    await s.app.close();
    s = await launch(lib, ud);
    await expect(s.page.getByTestId('toolbar-title')).toHaveText('내 라이브러리');
    await expect(s.page.getByTestId('column-header')).toHaveText(['제목', '저자', '연도', '종류', '추가일']);
  } finally {
    await s.app.close();
  }
});

test('a tag or collection change reads the snapshot only; a metadata or opened change reads those items only; an import reads the whole list', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    const [a, b] = await seeded(page);
    const tag = await createTag(page, '중요');
    const coll = await createCollection(page, '분자생물학');
    const base = await quietLibraryCalls(app);
    const n = (c: Record<string, number>, ch: string) => c[ch] ?? 0;

    // A tag: the snapshot is read once, the list and the items are not.
    await assignTag(page, tag, [a.id]);
    await expect.poll(async () => n(await ipcCalls(app), 'library:organize')).toBe(n(base, 'library:organize') + 1);
    const afterTag = await quietLibraryCalls(app);
    expect(n(afterTag, 'library:list'), 'a tag does not read the list').toBe(n(base, 'library:list'));
    expect(n(afterTag, 'library:getItems')).toBe(n(base, 'library:getItems'));

    // A collection: the same.
    await addToCollection(page, coll, [a.id, b.id]);
    await expect.poll(async () => n(await ipcCalls(app), 'library:organize')).toBe(n(afterTag, 'library:organize') + 1);
    const afterColl = await quietLibraryCalls(app);
    expect(n(afterColl, 'library:list'), 'a collection does not read the list').toBe(n(afterTag, 'library:list'));

    // Metadata of one item: that item is read, the list is not, and the row shows the new title.
    await seedMetadata(page, b.id, { creators: [] }, '단백질 접힘 개론');
    await expect(rowByTitle(page, '단백질 접힘 개론')).toBeVisible();
    const afterMeta = await quietLibraryCalls(app);
    expect(n(afterMeta, 'library:getItems'), 'one read of the item').toBe(n(afterColl, 'library:getItems') + 1);
    expect(n(afterMeta, 'library:list'), 'metadata does not read the list').toBe(n(afterColl, 'library:list'));
    expect(n(afterMeta, 'library:organize'), 'nor the snapshot').toBe(n(afterColl, 'library:organize'));

    // Opening an item (the reader's notice): the item is read, the list is not.
    const opened = await page.evaluate((itemId) => window.learn.reader.open({ itemId }), a.id);
    expect(opened.ok).toBe(true);
    await expect.poll(async () => n(await ipcCalls(app), 'library:getItems')).toBe(n(afterMeta, 'library:getItems') + 1);
    const afterOpen = await quietLibraryCalls(app);
    expect(n(afterOpen, 'library:list'), 'opened does not read the list').toBe(n(afterMeta, 'library:list'));

    // The control: an import does read the whole list, so the counter is able to show a list read.
    await importPaths(page, [EXTRA]);
    await expect.poll(async () => n(await ipcCalls(app), 'library:list')).toBe(n(afterOpen, 'library:list') + 1);
    await expect(page.getByTestId('item-row')).toHaveCount(4);
  } finally {
    await app.close();
  }
});
