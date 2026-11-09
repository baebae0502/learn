// M7c body search: the scheduler reads each PDF's text once the window is idle, resumes after a kill, stops for the trash,
// and tells the screen how far it is; the quick search's scope (정보 / 정보와 본문) searches that text with the metadata.
import path from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { expectNoSeriousA11y } from './a11y';
import {
  FIXTURES,
  expectTooltipText,
  hardKill,
  hoverLikeUser,
  importPaths,
  launch,
  mainWindow,
  pageTextCount,
  rowByTitle,
  runMenuCommand,
  seedBodyText,
  seedMetadata,
  settled,
  showItemPanel,
  textExtraction,
  textHeld,
  textHold,
  textIdle,
  textJobs,
  trashItems,
} from './helpers';

const pdf = (name: string) => path.join(FIXTURES, name);
const detailOf = async (page: import('@playwright/test').Page, itemId: string) => {
  const r = await page.evaluate((id) => window.learn.library.detail({ itemId: id }), itemId);
  if (!r.ok) throw new Error(`library.detail failed: ${r.code}`);
  return r.data;
};

test('E2E starts paused; resumed, korean.pdf is indexed and its detail says done', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const [korean, video, image] = await importPaths(page, [pdf('korean.pdf'), pdf('sample-h264-aac.mp4'), pdf('transparent.png')]);
    // The positive control comes first: the job is there and waits, only the PDF has one.
    const jobs = await textJobs(app);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ state: 'queued', attempts: 0 });
    expect((await detailOf(page, korean!.id)).text).toEqual({ state: 'pending' });
    await textExtraction(app, 'now');
    await textIdle(app);
    expect(await pageTextCount(app, { itemId: korean!.id })).toBe(3);
    expect((await detailOf(page, korean!.id)).text).toEqual({ state: 'done', pages: 3, truncated: false });
    expect((await detailOf(page, video!.id)).text).toBeNull();
    expect((await detailOf(page, image!.id)).text).toBeNull();
  } finally {
    await app.close();
  }
});

test('locked.pdf fails as locked, no-text.pdf is empty', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const [locked, empty] = await importPaths(page, [pdf('locked.pdf'), pdf('no-text.pdf')]);
    await textExtraction(app, 'now');
    await textIdle(app);
    expect((await detailOf(page, locked!.id)).text).toEqual({ state: 'failed', reason: 'locked' });
    expect((await detailOf(page, empty!.id)).text).toEqual({ state: 'empty', pages: 2 });
  } finally {
    await app.close();
  }
});

test('a SIGKILL mid-extraction resumes on relaunch with exact page counts', async ({}, testInfo) => {
  const library = testInfo.outputPath('library');
  const userData = testInfo.outputPath('userdata');
  const first = await launch(library, userData);
  let sha256: string;
  try {
    const [paper] = await importPaths(first.page, [pdf('paper-100.pdf')]);
    sha256 = (await detailOf(first.page, paper!.id)).file.sha256;
    await textHold(first.app, 40);
    await textExtraction(first.app, 'now');
    await expect.poll(() => textHeld(first.app), { message: 'the job wrote 40 pages and is held' }).toBe(true);
    expect(await pageTextCount(first.app, { sha256 })).toBe(40);
  } catch (e) {
    await first.app.close().catch(() => {});
    throw e;
  }
  await hardKill(first.app);

  const second = await launch(library, userData);
  try {
    // The startup check marks the job interrupted; the first wake queues it again and it goes on from page 40.
    await textExtraction(second.app, 'now');
    await textIdle(second.app);
    expect(await pageTextCount(second.app, { sha256 })).toBe(100);
    const job = (await textJobs(second.app)).find((j) => j.sha256 === sha256);
    expect(job).toMatchObject({ state: 'done', attempts: 2, nextPage: 100 });
  } finally {
    await second.app.close();
  }
});

test('trash stops the running job and restore resumes it; purge removes the page text', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const [paper] = await importPaths(page, [pdf('paper-100.pdf')]);
    const sha256 = (await detailOf(page, paper!.id)).file.sha256;
    await textHold(app, 40);
    await textExtraction(app, 'now');
    await expect.poll(() => textHeld(app)).toBe(true);
    expect(await trashItems(page, [paper!.id])).toBe(1);
    await expect.poll(async () => (await textJobs(app)).find((j) => j.sha256 === sha256)?.state, { message: 'the stopped job is back in the queue' }).toBe('queued');
    expect((await detailOf(page, paper!.id)).text).toEqual({ state: 'pending' });
    await textHold(app, null); // lets go and forgets: left as it was, the restored job would be held again at page 60
    expect(await page.evaluate((id) => window.learn.library.restore({ itemIds: [id] }), paper!.id)).toMatchObject({ ok: true, data: 1 });
    await textIdle(app);
    expect((await detailOf(page, paper!.id)).text).toEqual({ state: 'done', pages: 100, truncated: false });
    expect(await pageTextCount(app, { sha256 })).toBe(100);
    expect(await trashItems(page, [paper!.id])).toBe(1);
    expect(await page.evaluate((id) => window.learn.library.purge({ itemIds: [id], collectionIds: [] }), paper!.id)).toMatchObject({ ok: true });
    expect(await pageTextCount(app, { sha256 })).toBe(0);
  } finally {
    await app.close();
  }
});

test('progress notices: done never passes total, and the last one has them equal', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await importPaths(page, [pdf('korean.pdf'), pdf('sample.pdf'), pdf('search-30.pdf')]);
    await page.evaluate(() => {
      const seen: Array<{ done: number; total: number }> = [];
      (window as unknown as { __searchProgress: typeof seen }).__searchProgress = seen;
      window.learn.on('search:progress', (p) => void seen.push(p));
    });
    await textExtraction(app, 'now');
    await textIdle(app);
    // The last notice is sent when the queue empties, which is when textIdle resolves; it may still be on its way to the page.
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __searchProgress: Array<{ done: number; total: number }> }).__searchProgress.at(-1)))
      .toEqual({ done: 3, total: 3 });
    const seen = await page.evaluate(() => (window as unknown as { __searchProgress: Array<{ done: number; total: number }> }).__searchProgress);
    expect(seen.length).toBeGreaterThan(0);
    for (const p of seen) {
      expect(p.done).toBeLessThanOrEqual(p.total);
      expect(p.total).toBe(3);
    }
  } finally {
    await app.close();
  }
});

test("the page's search API answers from the index", async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const seeded = await seedBodyText(app, { docs: 20, pages: 12, chars: 400, seed: 1 });
    const body = (query: string) => page.evaluate((q) => window.learn.search.body({ query: q }), query);
    const hit = await body('형광');
    if (!hit.ok) throw new Error(`search.body failed: ${hit.code}`);
    expect(hit.data.searched).toBe(true);
    expect(hit.data.itemIds.length).toBeGreaterThan(0);
    expect(hit.data.itemIds.every((id) => seeded.itemIds.includes(id))).toBe(true);
    // One letter has no body word: not searched, which is not the same as nothing found.
    expect(await body('형')).toEqual({ ok: true, data: { itemIds: [], searched: false } });
    // Three letters take the index, and a query nobody has is searched and empty.
    const indexed = await body('transduction');
    expect(indexed.ok && indexed.data.searched && indexed.data.itemIds.length > 0).toBe(true);
    expect(await body('xylophone')).toEqual({ ok: true, data: { itemIds: [], searched: true } });

    const pages = await page.evaluate((id) => window.learn.search.pages({ itemId: id, query: '형광' }), hit.data.itemIds[0]!);
    if (!pages.ok) throw new Error(`search.pages failed: ${pages.code}`);
    expect(pages.data.pages.length).toBeGreaterThan(0);
    expect(pages.data.total).toBeGreaterThanOrEqual(pages.data.pages.length);
    const order = pages.data.pages.map((p) => p.pageIndex);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    for (const p of pages.data.pages) expect(p.snippet).toContain('\ue000');

    expect(await page.evaluate(() => window.learn.search.progress())).toEqual({ ok: true, data: { done: 20, total: 20 } });
  } finally {
    await app.close();
  }
});

// ---- The quick search's scope (spec 5.8): 정보 or 정보와 본문 from a button at the field's start ---------------------------

const field = (page: Page) => page.getByTestId('search-field').locator('input');
const scopeButton = (page: Page) => page.getByTestId('search-scope');
const scopeMenu = (page: Page) => page.getByRole('menu', { name: '검색 범위' });
const scopeRow = (page: Page, name: '정보' | '정보와 본문') => scopeMenu(page).getByRole('menuitemradio', { name, exact: true });
const progressRow = (page: Page) => page.getByTestId('search-scope-progress');
const storedScope = (page: Page) => page.evaluate(() => window.learn.settings.get({ key: 'library.searchScope' }).then((r) => (r.ok ? r.data : r.code)));
const titles = (page: Page) => page.getByTestId('item-row').evaluateAll((els) => els.map((e) => e.getAttribute('data-title')).sort());
const PLACEHOLDER = { metadata: '제목, 저자, 태그 검색', fulltext: '제목, 저자, 태그, 본문 검색' } as const;

/** Picks a scope with the pointer: the button opens the menu, the row chooses and closes it. */
async function chooseScope(page: Page, name: '정보' | '정보와 본문'): Promise<void> {
  await scopeButton(page).click();
  await expect(scopeMenu(page)).toBeVisible();
  await scopeRow(page, name).click();
  await expect(scopeMenu(page)).toHaveCount(0);
  await expect(field(page)).toHaveAttribute('placeholder', name === '정보' ? PLACEHOLDER.metadata : PLACEHOLDER.fulltext);
}

/** search-30.pdf (형광 on every page, not in its title), korean.pdf, and sample.pdf titled with 형광; the body indexed. */
async function bodyLibrary(app: ElectronApplication, page: Page) {
  const [search30, korean, sample] = await importPaths(page, [pdf('search-30.pdf'), pdf('korean.pdf'), pdf('sample.pdf')]);
  const titled = await seedMetadata(page, sample!.id, { creators: [] }, '형광 단백질 실험 노트');
  await textExtraction(app, 'now');
  await textIdle(app);
  await expect.poll(() => page.evaluate(() => window.learn.search.progress().then((r) => (r.ok ? r.data : null)))).toEqual({ done: 3, total: 3 });
  await expect(rowByTitle(page, titled.title)).toBeVisible();
  return { search30: search30!, korean: korean!, titled };
}

test('the scope button: at the field start in its own Tab stop, a menu by pointer and by keys, remembered by the library after a relaunch', async ({}, testInfo) => {
  const library = testInfo.outputPath('library');
  const userData = testInfo.outputPath('userdata');
  const first = await launch(library, userData);
  try {
    const { page, app } = first;
    await importPaths(page, [pdf('korean.pdf')]);
    // At rest: the 정보 scope, the field still 240 wide with the button in the magnifier's place, named and tipped 검색 범위.
    await expect(field(page)).toHaveAttribute('placeholder', PLACEHOLDER.metadata);
    expect(await storedScope(page)).toBeNull();
    const fieldBox = (await page.getByTestId('search-field').boundingBox())!;
    expect(Math.round(fieldBox.width)).toBe(240);
    const buttonBox = (await scopeButton(page).boundingBox())!;
    const inputBox = (await field(page).boundingBox())!;
    expect(buttonBox.x).toBeGreaterThanOrEqual(fieldBox.x);
    expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(inputBox.x);
    await expect(scopeButton(page)).toHaveAccessibleName('검색 범위');
    await expect(scopeButton(page)).toHaveAttribute('aria-haspopup', /true|menu/);
    await hoverLikeUser(page, 'search-scope');
    await expectTooltipText(page, '검색 범위', 'search-scope');

    // Pointer: two rows, each with what it searches, the current one checked — and none filled until the pointer is on it.
    await scopeButton(page).click();
    await expect(scopeMenu(page)).toBeVisible();
    await expect(scopeRow(page, '정보')).toHaveAttribute('aria-checked', 'true');
    await expect(scopeRow(page, '정보').locator('.check svg')).toHaveCount(1);
    await expect(scopeRow(page, '정보와 본문')).toHaveAttribute('aria-checked', 'false');
    await settled(page);
    await expect(scopeMenu(page).locator('[role="menuitemradio"][data-focused]')).toHaveCount(0);
    await expect(scopeRow(page, '정보')).toContainText('제목⁠·저자⁠·태그⁠·출판사⁠·원래 이름⁠·초록⁠·메모');
    await expect(scopeRow(page, '정보와 본문')).toContainText('PDF 본문 포함');
    await expectNoSeriousA11y(page, 'the search scope menu');
    await scopeRow(page, '정보와 본문').click();
    await expect(scopeMenu(page)).toHaveCount(0);
    await expect(field(page)).toHaveAttribute('placeholder', PLACEHOLDER.fulltext);
    await expect.poll(() => storedScope(page)).toBe('fulltext');
    // The longer placeholder fits the 240 field on one line.
    expect(await field(page).evaluate((el) => (el as HTMLInputElement).scrollWidth <= (el as HTMLInputElement).clientWidth)).toBe(true);

    // Keys: the button comes right before the field (Shift+Tab from it), ↓ opens the menu on its first row, ↩ chooses.
    await runMenuCommand(app, 'library.find');
    await expect(field(page)).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(scopeButton(page)).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(scopeRow(page, '정보')).toBeFocused();
    await expect(scopeRow(page, '정보와 본문')).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Enter');
    await expect(scopeMenu(page)).toHaveCount(0);
    await expect(scopeButton(page)).toBeFocused();
    await expect(field(page)).toHaveAttribute('placeholder', PLACEHOLDER.metadata);
    await expect.poll(() => storedScope(page)).toBe('metadata');
    // And back: ↓ ↓ ↩ from the button (the menu opens on 정보, its first row).
    await page.keyboard.press('ArrowDown');
    await expect(scopeRow(page, '정보')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(scopeRow(page, '정보와 본문')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(field(page)).toHaveAttribute('placeholder', PLACEHOLDER.fulltext);
    await expect.poll(() => storedScope(page)).toBe('fulltext');
    await page.keyboard.press('Tab');
    await expect(field(page)).toBeFocused();
  } finally {
    await first.app.close();
  }
  const second = await launch(library, userData);
  try {
    await expect(field(second.page)).toHaveAttribute('placeholder', PLACEHOLDER.fulltext);
    await scopeButton(second.page).click();
    await expect(scopeRow(second.page, '정보와 본문')).toHaveAttribute('aria-checked', 'true');
  } finally {
    await second.app.close();
  }
});

test('정보와 본문: the table is the metadata matches and the PDF body matches together, a title marked only where its metadata matched; 정보 drops the body matches', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const { search30, titled } = await bodyLibrary(app, page);
    await field(page).fill('형광');
    // 정보: the title match only (positive control for what the body adds).
    await expect.poll(() => titles(page)).toEqual([titled.title]);
    await expect(page.getByTestId('toolbar-count')).toHaveText('1개 / 3개');
    await chooseScope(page, '정보와 본문');
    await expect.poll(() => titles(page)).toEqual([search30.title, titled.title].sort());
    await expect(page.getByTestId('toolbar-count')).toHaveText('2개 / 3개');
    await expect(page.getByTestId('search-status')).toHaveText('일치하는 자료 2개');
    await expect(rowByTitle(page, titled.title).locator('mark')).toHaveText('형광');
    await expect(rowByTitle(page, search30.title).locator('mark')).toHaveCount(0); // a body-only row has no sign of its own
    await expectNoSeriousA11y(page, 'quick search, metadata and body matches');
    await chooseScope(page, '정보');
    await expect.poll(() => titles(page)).toEqual([titled.title]);
    await expect(page.getByTestId('toolbar-count')).toHaveText('1개 / 3개');
  } finally {
    await app.close();
  }
});

test('two Korean letters search the body, one letter does not and says so; an NFD page is found by its NFC words', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const { search30, korean, titled } = await bodyLibrary(app, page);
    await chooseScope(page, '정보와 본문');
    await field(page).fill('형광');
    await expect.poll(() => titles(page)).toEqual([search30.title, titled.title].sort());
    // One letter: the metadata only (the title has 형), and nothing promised about the body.
    await field(page).fill('형');
    await expect.poll(() => titles(page)).toEqual([titled.title]);
    await field(page).fill('효');
    const empty = page.getByTestId('search-empty');
    await expect(empty).toBeVisible();
    await expect(empty.locator('.pe-text')).toHaveText('제목⁠·저자⁠·태그⁠·출판사⁠·원래 이름⁠·초록⁠·메모에서 찾았습니다.본문은 두 글자 이상인 낱말로 찾습니다.');
    await expectNoSeriousA11y(page, 'quick search in 정보와 본문, one letter, no results');
    // Two words, searched in the body too: the field list ends in ·PDF 본문, the index is done so nothing more is said.
    await field(page).fill('효소 억제제');
    await expect(empty.locator('.pe-text')).toHaveText('제목⁠·저자⁠·태그⁠·출판사⁠·원래 이름⁠·초록⁠·메모⁠·PDF 본문에서 찾았습니다.');
    await expectNoSeriousA11y(page, 'quick search in 정보와 본문, no results');
    // korean.pdf's page 2 is decomposed (NFD) in the file; the stored text is NFC, so the NFC query finds it there too.
    await field(page).fill('변환기는');
    await expect.poll(() => titles(page)).toEqual([korean.title]);
    const pages = await page.evaluate((id) => window.learn.search.pages({ itemId: id, query: '변환기는' }), korean.id);
    expect(pages.ok && pages.data.pages.map((p) => p.pageIndex)).toContain(1);
  } finally {
    await app.close();
  }
});

test('the index progress: the menu counts the PDFs indexed while some wait, no-results says more may be found, and both go once the index is done', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    // Under E2E the extraction waits to be let go: two PDFs, none indexed.
    await importPaths(page, [pdf('korean.pdf'), pdf('search-30.pdf')]);
    await scopeButton(page).click();
    await expect(progressRow(page)).toHaveText('본문 색인 0 / 2');
    await expect(progressRow(page)).toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('Escape');
    await expect(scopeMenu(page)).toHaveCount(0);
    await chooseScope(page, '정보와 본문');
    await field(page).fill('효소 억제제');
    const text = page.getByTestId('search-empty').locator('.pe-text');
    await expect(text).toContainText('본문 색인이 끝나면 더 찾을 수 있습니다(0 / 2).');
    await expectNoSeriousA11y(page, 'quick search in 정보와 본문 while indexing, no results');
    await textExtraction(app, 'now');
    await textIdle(app);
    // The last progress notice reaches the page after the queue is empty: the note goes with it.
    await expect(text).not.toContainText('본문 색인이 끝나면');
    await expect(text).toContainText('PDF 본문에서 찾았습니다.');
    await scopeButton(page).click();
    await expect(scopeRow(page, '정보와 본문')).toBeVisible();
    await expect(progressRow(page)).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('a body match leaves with its item for the trash and comes back on restore; the trash view searches no body', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const { search30, titled } = await bodyLibrary(app, page);
    await chooseScope(page, '정보와 본문');
    await field(page).fill('형광');
    await expect.poll(() => titles(page)).toEqual([search30.title, titled.title].sort());
    expect(await trashItems(page, [search30.id])).toBe(1);
    await expect.poll(() => titles(page)).toEqual([titled.title]);
    expect(await page.evaluate((id) => window.learn.library.restore({ itemIds: [id] }), search30.id)).toMatchObject({ ok: true, data: 1 });
    await expect.poll(() => titles(page)).toEqual([search30.title, titled.title].sort());
    // In the trash view the body is not searched: search-30's text has 형광, its row there does not show for it.
    expect(await trashItems(page, [search30.id])).toBe(1);
    await page.getByTestId('nav-scope-trash').click();
    await expect(field(page)).toHaveAttribute('placeholder', PLACEHOLDER.metadata);
    await field(page).fill('');
    await expect.poll(() => titles(page)).toEqual([search30.title]);
    await field(page).fill('형광');
    const empty = page.getByTestId('search-empty');
    await expect(empty).toBeVisible();
    await expect(empty.locator('.pe-text')).not.toContainText('PDF 본문');
  } finally {
    await app.close();
  }
});

test('an empty result at 1024: the column header strip still scrolls sideways (no stop of its own), and lines up with the rows when they come back', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await importPaths(page, [pdf('korean.pdf'), pdf('sample.pdf')]);
    await (await mainWindow(app)).evaluate((w) => w.setContentSize(1024, w.getContentSize()[1]!));
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThan(1100);
    await showItemPanel(app, page);
    const clip = page.getByTestId('table-head-clip');
    const scroller = page.getByTestId('library-scroller');
    await expect.poll(() => scroller.evaluate((e) => e.scrollWidth - e.clientWidth), { message: 'the columns must overflow the table here' }).toBeGreaterThan(0);
    await field(page).fill('효소 억제제');
    await expect(page.getByTestId('search-empty')).toBeVisible();
    const box = (await page.getByTestId('column-header').first().boundingBox())!;
    await page.mouse.move(box.x + 20, box.y + box.height / 2);
    await page.mouse.wheel(120, 0);
    await expect.poll(() => clip.evaluate((e) => e.scrollLeft)).toBeGreaterThan(0);
    await expectNoSeriousA11y(page, 'no results at 1024, the header scrolled sideways');
    // No keyboard stop of its own: from the field, Tab goes on to the no-results state's buttons past the header.
    await field(page).focus();
    const stops: Array<string | null> = [];
    for (let i = 0; i < 8 && stops.at(-1) !== 'search-empty-clear'; i++) {
      await page.keyboard.press('Tab');
      stops.push(await page.evaluate(() => document.activeElement?.closest('[data-testid]')?.getAttribute('data-testid') ?? null));
    }
    expect(stops.at(-1)).toBe('search-empty-clear');
    expect(stops).not.toContain('table-head-clip');
    // The rows come back: the header goes back over their columns.
    await field(page).fill('');
    await expect(page.getByTestId('item-row')).toHaveCount(2);
    await expect.poll(async () => (await clip.evaluate((e) => e.scrollLeft)) - (await scroller.evaluate((e) => e.scrollLeft))).toBe(0);
  } finally {
    await app.close();
  }
});
