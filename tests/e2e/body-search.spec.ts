// M7c body search: the scheduler reads each PDF's text once the window is idle, resumes after a kill, stops for the trash,
// and tells the screen how far it is; the quick search's scope (정보 / 정보와 본문) searches that text with the metadata.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { expectNoSeriousA11y } from './a11y';
import { holdReplies } from './dnd-helpers';
import {
  FIXTURES,
  closeReaderTab,
  cueTextCount,
  subtitleAssets,
  expectTooltipText,
  hardKill,
  hoverLikeUser,
  importPaths,
  launch,
  libraryTab,
  mainWindow,
  openItem,
  pageTextCount,
  readerTab,
  rowByTitle,
  runMenuCommand,
  seedBodyText,
  seedMetadata,
  selectRows,
  setPdfZoom,
  settled,
  showItemPanel,
  textExtraction,
  textHeld,
  textHold,
  textIdle,
  textJobs,
  stubOpenDialog,
  trashItems,
  videoReady,
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

    const found = await page.evaluate((id) => window.learn.search.matches({ itemId: id, query: '형광' }), hit.data.itemIds[0]!);
    if (!found.ok) throw new Error(`search.matches failed: ${found.code}`);
    const pages = found.data.matches.flatMap((m) => (m.kind === 'page' ? [m] : []));
    expect(pages.length).toBeGreaterThan(0);
    expect(pages).toHaveLength(found.data.matches.length);
    expect(found.data.total).toBeGreaterThanOrEqual(pages.length);
    const order = pages.map((p) => p.pageIndex);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    for (const p of pages) expect(p.snippet).toContain('\ue000');

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
    await expect(scopeRow(page, '정보와 본문')).toContainText('PDF 본문·자막 포함');
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
    await expect(empty.locator('.pe-text')).toHaveText('제목⁠·저자⁠·태그⁠·출판사⁠·원래 이름⁠·초록⁠·메모⁠·PDF 본문⁠·자막에서 찾았습니다.');
    await expectNoSeriousA11y(page, 'quick search in 정보와 본문, no results');
    // korean.pdf's page 2 is decomposed (NFD) in the file; the stored text is NFC, so the NFC query finds it there too.
    await field(page).fill('변환기는');
    await expect.poll(() => titles(page)).toEqual([korean.title]);
    const pages = await page.evaluate((id) => window.learn.search.matches({ itemId: id, query: '변환기는' }), korean.id);
    expect(pages.ok && pages.data.matches.map((m) => m.kind === 'page' && m.pageIndex)).toContain(1);
  } finally {
    await app.close();
  }
});

test('정보와 본문 with nothing else to show: 찾는 중… once the body answer has taken 300 ms, then the rows or no-results in its place', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const { search30 } = await bodyLibrary(app, page);
    await chooseScope(page, '정보와 본문');
    await holdReplies(app, ['search:body'], 1500);
    // When the field's input came and when the waiting state first showed, as the page saw them.
    await page.evaluate(() => {
      const log = { input: [] as number[], shown: [] as number[] };
      (window as unknown as { __pending: typeof log }).__pending = log;
      document.addEventListener('input', (e) => void ((e.target as Element | null)?.closest('[data-testid="search-field"]') && log.input.push(performance.now())), true);
      new MutationObserver(() => {
        if (document.querySelector('[data-testid="search-pending"]') && log.shown.length < log.input.length) log.shown.push(performance.now());
      }).observe(document.body, { childList: true, subtree: true });
    });
    const pending = page.getByTestId('search-pending');
    // 현미경: in search-30's pages, in no title — no metadata row, so the table would otherwise stay blank.
    await field(page).fill('현미경');
    await expect(pending.getByRole('status')).toHaveText('찾는 중…');
    await expect(page.getByTestId('toolbar-count')).toHaveText('0개 / 3개');
    const first = await page.evaluate(() => (window as unknown as { __pending: { input: number[]; shown: number[] } }).__pending);
    expect(first.shown[0]! - first.input[0]!, 'nothing for the first 300 ms').toBeGreaterThanOrEqual(300);
    await expect.poll(() => titles(page)).toEqual([search30.title]);
    await expect(pending).toHaveCount(0);
    await expectNoSeriousA11y(page, '정보와 본문, a body match after the wait');
    // A query nothing has: the wait, then no-results with the body searched.
    await field(page).fill('효소 억제제');
    await expect(pending.getByRole('status')).toHaveText('찾는 중…');
    await expectNoSeriousA11y(page, '정보와 본문, waiting for the body');
    await expect(page.getByTestId('search-empty').locator('.pe-text')).toContainText('PDF 본문⁠·자막에서 찾았습니다.');
    await expect(pending).toHaveCount(0);
    const second = await page.evaluate(() => (window as unknown as { __pending: { input: number[]; shown: number[] } }).__pending);
    expect(second.shown[1]! - second.input[1]!, 'nothing for the first 300 ms').toBeGreaterThanOrEqual(300);
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
    await expect(text).toContainText('PDF 본문⁠·자막에서 찾았습니다.');
    await scopeButton(page).click();
    await expect(scopeRow(page, '정보와 본문')).toBeVisible();
    await expect(progressRow(page)).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('the index progress leaves out a PDF whose original is missing: counted while it is there, the menu line and the no-results note go once the rest is indexed', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const gone = testInfo.outputPath('gone.pdf');
    fs.copyFileSync(pdf('korean.pdf'), gone);
    await importPaths(page, [pdf('search-30.pdf')]);
    const [linked] = await importPaths(page, [gone], { mode: 'linked' });
    // Positive control: while its original is there, the linked PDF is one the index waits for.
    await scopeButton(page).click();
    await expect(progressRow(page)).toHaveText('본문 색인 0 / 2');
    await page.keyboard.press('Escape');
    await expect(scopeMenu(page)).toHaveCount(0);
    // Its original goes, as on an unplugged drive: looked at again, the item is marked missing.
    fs.rmSync(gone);
    await page.evaluate((id) => window.learn.library.get({ itemId: id }), linked!.id);
    await expect(rowByTitle(page, linked!.title).getByTestId('missing-flag')).toBeVisible();
    await textExtraction(app, 'now');
    await textIdle(app);
    // The rest is indexed and the missing file left for when it is back: nothing more will be read now.
    expect((await textJobs(app)).map((j) => j.state).sort()).toEqual(['done', 'queued']);
    await expect.poll(() => page.evaluate(() => window.learn.search.progress().then((r) => (r.ok ? r.data : null)))).toEqual({ done: 1, total: 1 });
    await chooseScope(page, '정보와 본문');
    await field(page).fill('효소 억제제');
    const text = page.getByTestId('search-empty').locator('.pe-text');
    await expect(text).toContainText('PDF 본문⁠·자막에서 찾았습니다.');
    await expect(text).not.toContainText('본문 색인이 끝나면');
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

// ---- The item panel's 본문 일치 (spec 5.8): one PDF's pages that match, each opening the reader at that page ------------------

const matches = (page: Page) => page.getByTestId('matches-section');
const matchList = (page: Page) => matches(page).getByRole('listbox', { name: '본문 일치' });
const matchRow = (page: Page, n: number) => matchList(page).locator(`[data-testid="match-row"][data-page="${n}"]`);
const matchPages = (page: Page) => matchList(page).getByRole('option').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-page'))));
const matchStatus = (page: Page) => matches(page).getByTestId('matches-status');
const bodyTextLine = (page: Page) => page.locator('[data-testid="file-row"][data-field="bodyText"] dd');
/** The test ids of the item panel's parts, top to bottom. */
const panelParts = (page: Page) => page.getByTestId('inspector-item').evaluate((el) => [...el.children].map((c) => c.getAttribute('data-testid')));
/** The shown reader's page as its store has it (the E2E-only window.__learnReader). */
const readerPage = (page: Page) => page.evaluate(() => (window as unknown as { __learnReader: { getState(): { pdf: { pageNumber: number } | null } } }).__learnReader.getState().pdf?.pageNumber ?? null);
const findInput = (page: Page) => page.getByTestId('pdf-find-field').getByRole('searchbox');
const findCount = (page: Page) => page.getByTestId('pdf-find-count');
/** The page whose text layer holds the find bar's current match (pdf.js marks it .highlight.selected), in the shown reader. */
const selectedMatchPage = (page: Page) =>
  page.evaluate(() => document.querySelector('[data-testid="tab-panel"][data-active="true"] .textLayer .highlight.selected')?.closest('.page')?.getAttribute('data-page-number') ?? null);
const editorField = (page: Page, name: string) => page.locator(`[data-testid="editor-field"][data-field="${name}"] :is(input, textarea)`);

/** From now on, the pages the shown reader is at once it is placed: the first is where it was placed (never the saved page, then a jump). */
async function recordPlacedPages(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __placed: number[]; __learnReader: { subscribe(f: () => void): () => void; getState(): { pdf: { placed: boolean; pageNumber: number } | null } } };
    w.__placed = [];
    w.__learnReader.subscribe(() => {
      const pdf = w.__learnReader.getState().pdf;
      if (pdf?.placed && w.__placed.at(-1) !== pdf.pageNumber) w.__placed.push(pdf.pageNumber);
    });
  });
}
const placedPages = (page: Page) => page.evaluate(() => (window as unknown as { __placed: number[] }).__placed);

/** The reader shown at page `n`, the find bar on `query` with its current match in that page (`index` of `total` in the document). */
async function expectReaderAt(page: Page, n: number, query: string, count: string): Promise<void> {
  await expect(page.getByTestId('pdf-scroll')).toHaveAttribute('data-restored', '');
  await expect.poll(() => readerPage(page)).toBe(n);
  await expect(findInput(page)).toHaveValue(query);
  await expect(findCount(page)).toHaveText(count);
  await expect.poll(() => selectedMatchPage(page)).toBe(String(n));
}

/** bodyLibrary in 정보와 본문 with `query` typed and the row `title` selected in the shown item panel. */
async function panelFor(app: ElectronApplication, page: Page, query: string, title: string): Promise<void> {
  await field(page).fill(query);
  await expect(rowByTitle(page, title)).toBeVisible();
  await showItemPanel(app, page);
  await selectRows(page, [title]);
  await expect(page.getByTestId('inspector-head').locator('h2')).toHaveText(title);
}

test('본문 일치: right under the head, "쪽 30개" and twenty pages named "N쪽, …" with the word marked, then 외 10쪽; korean.pdf lists its pages 1–3; a PDF with no match has none after its 300 ms wait', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const { search30, korean, titled } = await bodyLibrary(app, page);
    await chooseScope(page, '정보와 본문');
    await panelFor(app, page, 'fluorescence', search30.title);
    await expect(matches(page).getByTestId('matches-count')).toHaveText('쪽 30개');
    await expect(matchList(page).getByRole('option')).toHaveCount(20);
    expect(await matchPages(page)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    await expect(matchRow(page, 1)).toHaveAccessibleName(/^1쪽, .*fluorescence/);
    await expect(matchRow(page, 1).locator('.pg')).toHaveText('1쪽');
    await expect(matchRow(page, 1).locator('mark')).toHaveText('fluorescence');
    await expect(matches(page).getByTestId('matches-more')).toHaveText('외 10쪽');
    // The section's place: right under the head (an item never opened has no 읽기), above 정보.
    expect((await panelParts(page)).slice(0, 3)).toEqual(['inspector-head', 'matches-section', 'info-section']);
    // A done index says nothing in the file section.
    await expect(page.getByTestId('file-section')).toBeVisible();
    await expect(bodyTextLine(page)).toHaveCount(0);
    await expectNoSeriousA11y(page, 'item panel, 본문 일치 with twenty pages and more');

    // korean.pdf: page 2 is NFD in the file; its NFC text is found as on pages 1 and 3.
    await panelFor(app, page, '메커니즘은', korean.title);
    await expect.poll(() => matchPages(page)).toEqual([1, 2, 3]);
    await expect(matches(page).getByTestId('matches-count')).toHaveText('쪽 3개');
    await expect(matches(page).getByTestId('matches-more')).toHaveCount(0);

    // A PDF whose index is done and has no match: nothing for 300 ms, 찾는 중… while search:matches is held, then no section.
    await holdReplies(app, ['search:matches'], 1200);
    await field(page).fill('형광');
    // The body answer is in the table: the query has settled, so the panel asks for this query's pages only.
    await expect.poll(() => titles(page)).toEqual([search30.title, titled.title].sort());
    // When the row is chosen and when the waiting line first shows, as the page sees them.
    await page.evaluate(() => {
      const log = { asked: performance.now(), shown: 0 };
      (window as unknown as { __matchWait: typeof log }).__matchWait = log;
      new MutationObserver(() => {
        if (!log.shown && document.querySelector('[data-testid="matches-loading"]')) log.shown = performance.now();
      }).observe(document.body, { childList: true, subtree: true });
    });
    await selectRows(page, [titled.title]);
    await expect(matches(page).getByTestId('matches-loading')).toHaveText('찾는 중…');
    await expect(matches(page).getByRole('status')).toHaveText('찾는 중…');
    const wait = await page.evaluate(() => (window as unknown as { __matchWait: { asked: number; shown: number } }).__matchWait);
    expect(wait.shown - wait.asked, 'nothing for the first 300 ms').toBeGreaterThanOrEqual(300);
    await expect(matches(page)).toHaveCount(0);
    await expect(page.getByTestId('info-section')).toBeVisible();
    await holdReplies(app, ['search:matches'], 0);
  } finally {
    await app.close();
  }
});

test('본문 일치 keys on the query typed now, as the table does: it empties in the update that drops the table\'s body rows (never the last query\'s pages after them), and a query typed again shows from the cache at once', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const { search30 } = await bodyLibrary(app, page);
    // A second item of search-30's file stays in the table by its title; search-30 itself is a body-only row, the witness of
    // the table's body answer.
    const [copy] = await importPaths(page, [pdf('search-30.pdf')], { allowDuplicate: true });
    const kept = await seedMetadata(page, copy!.id, { creators: [] }, 'fluorescence 12 관찰');
    await chooseScope(page, '정보와 본문');
    await panelFor(app, page, 'fluorescence', kept.title);
    await expect(matches(page).getByTestId('matches-count')).toHaveText('쪽 30개');
    await expect(rowByTitle(page, search30.title)).toBeVisible();
    // Every DOM change from here: the section's count (null when there is no section) and whether the witness row is there.
    await page.evaluate((witness) => {
      const w = window as unknown as { __snaps: Array<{ count: string | null; witness: boolean }> };
      w.__snaps = [];
      const snap = () =>
        w.__snaps.push({
          count: document.querySelector('[data-testid="matches-count"]')?.textContent?.replace(/\u00a0/g, ' ') ?? null,
          witness: document.querySelector(`[data-testid="item-row"][data-title=${JSON.stringify(witness)}]`) !== null,
        });
      new MutationObserver(snap).observe(document.body, { childList: true, subtree: true, characterData: true });
    }, search30.title);
    const snaps = () => page.evaluate(() => (window as unknown as { __snaps: Array<{ count: string | null; witness: boolean }> }).__snaps);
    // A new query (page 12 only): the table drops its body rows until the answer, and the section goes with them.
    await field(page).fill('fluorescence 12');
    await expect(matches(page).getByTestId('matches-count')).toHaveText('쪽 1개');
    await expect(rowByTitle(page, search30.title)).toBeVisible();
    const across = await snaps();
    expect(across.some((s) => !s.witness), 'the table dropped its body rows on the way').toBe(true);
    expect(across.filter((s) => !s.witness && s.count === '쪽 30개'), 'the last query\'s pages never outlive the table\'s body rows').toEqual([]);
    // Typed again: both answers are cached, so the section shows its pages in the same update as the table, before the settle.
    await page.evaluate(() => void ((window as unknown as { __snaps: unknown[] }).__snaps.length = 0));
    await field(page).fill('fluorescence');
    await expect(matches(page).getByTestId('matches-count')).toHaveText('쪽 30개');
    const back = await snaps();
    expect(back.filter((s) => s.count === null), 'the section never left on the way back').toEqual([]);
  } finally {
    await app.close();
  }
});

test('a 본문 일치 row opens the reader at its page in the saved zoom, the find bar on the query with its first match there — ↩ and a click; an open tab jumps, and ⌘[ goes back', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const { search30 } = await bodyLibrary(app, page);
    await chooseScope(page, '정보와 본문');
    await panelFor(app, page, 'fluorescence', search30.title);
    await recordPlacedPages(page);
    // ↩: the arrows move in the list, ↩ opens the row's page; a new reader is placed there at once.
    await matchRow(page, 6).focus();
    await page.keyboard.press('ArrowDown');
    await expect(matchRow(page, 7)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(readerTab(page, search30.id)).toBeVisible();
    await expectReaderAt(page, 7, 'fluorescence', '7 / 30');
    expect((await placedPages(page))[0], 'placed at the page, not at the saved place first').toBe(7);

    // The tab is open and placed: another row jumps there (recorded for back), the find bar searching from that page.
    await libraryTab(page).click();
    await expect(matchRow(page, 12)).toBeVisible();
    // Opened once, the item has a 읽기 section: 본문 일치 stays above it.
    await expect.poll(async () => (await panelParts(page)).slice(0, 3)).toEqual(['inspector-head', 'matches-section', 'reading-section']);
    await matchRow(page, 12).click();
    await expectReaderAt(page, 12, 'fluorescence', '12 / 30');
    await runMenuCommand(app, 'nav.historyBack');
    await expect.poll(() => readerPage(page)).toBe(7);

    // A zoom of the reader's own is kept: closed and opened from a row, it comes back at that row's page in that zoom.
    await setPdfZoom(page, 1.5);
    await expect(page.getByTestId('pdf-viewer')).toHaveAttribute('data-zoom', '1.5');
    await closeReaderTab(page);
    await expect(readerTab(page, search30.id)).toHaveCount(0);
    await expect(matchRow(page, 20)).toBeVisible();
    await recordPlacedPages(page);
    await matchRow(page, 20).click();
    await expectReaderAt(page, 20, 'fluorescence', '20 / 30');
    await expect(page.getByTestId('pdf-viewer')).toHaveAttribute('data-zoom', '1.5');
    expect((await placedPages(page))[0], 'placed at the page in the saved zoom, not at the saved place first').toBe(20);
  } finally {
    await app.close();
  }
});

test('a 본문 일치 row of two words not side by side opens the find bar on one of them, its match on the row\'s page', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const { search30 } = await bodyLibrary(app, page);
    await chooseScope(page, '정보와 본문');
    // Every page has both words, as "fluorescence signal transduction": a page matches, the phrase is on none.
    await panelFor(app, page, 'transduction fluorescence', search30.title);
    await expect(matches(page).getByTestId('matches-count')).toHaveText('쪽 30개');
    await matchRow(page, 12).click();
    await expect(readerTab(page, search30.id)).toBeVisible();
    await expectReaderAt(page, 12, 'transduction', '12 / 30');
  } finally {
    await app.close();
  }
});

test('a 본문 일치 row whose reader cannot show the document leaves no page behind for a later open of that tab', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const { search30 } = await bodyLibrary(app, page);
    await chooseScope(page, '정보와 본문');
    await panelFor(app, page, 'fluorescence', search30.title);
    // The viewer fails to start once (E2E fault), as a document that cannot be shown does.
    await page.evaluate(() => {
      (window as unknown as { __learnFaults: { thumbnail: object; page: object; ready: boolean; start: number } }).__learnFaults = { thumbnail: {}, page: {}, ready: false, start: 1 };
    });
    await matchRow(page, 7).click();
    await expect(readerTab(page, search30.id)).toBeVisible();
    await expect(page.getByTestId('pdf-error')).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __learnReader: { getState(): { pendingJump: unknown } } }).__learnReader.getState().pendingJump))
      .toBeNull();
  } finally {
    await app.close();
  }
});

test('a 본문 일치 row while 정보 편집 cannot let go opens nothing, and the item opened later is not taken to that page; once the edit lets go the row opens it there', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const { search30 } = await bodyLibrary(app, page);
    await chooseScope(page, '정보와 본문');
    await panelFor(app, page, 'fluorescence', search30.title);
    await page.getByTestId('info-edit').click();
    await editorField(page, 'date').fill('어제');
    await matchRow(page, 5).click();
    // Asked first and refused (a marked field): the form says why, and no tab opens.
    await expect(page.getByTestId('editor-unsaved')).toBeVisible();
    await expect(editorField(page, 'date')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByTestId('library-table')).toBeVisible();
    await expect(readerTab(page, search30.id)).toHaveCount(0);
    await page.getByTestId('editor-discard').click();
    await expect(page.getByTestId('info-editor')).toHaveCount(0);
    // Opened the usual way: at its saved place (page 1), no find bar — the refused row left nothing behind.
    await openItem(page, search30.title);
    await expect(page.getByTestId('pdf-scroll')).toHaveAttribute('data-restored', '');
    await expect.poll(() => readerPage(page)).toBe(1);
    await expect(page.getByTestId('pdf-page-field')).toHaveValue('1');
    await expect(page.getByTestId('pdf-find-bar')).toHaveCount(0);

    // Positive control: a valid edit is saved, then the row opens its page.
    await libraryTab(page).click();
    await page.getByTestId('info-edit').click();
    await editorField(page, 'publisher').fill('학습출판');
    await matchRow(page, 5).click();
    await expectReaderAt(page, 5, 'fluorescence', '5 / 30');
    expect((await detailOf(page, search30.id)).metadata.publisher).toBe('학습출판');
  } finally {
    await app.close();
  }
});

test('the body index state: 색인 중 in 본문 일치 and the file section while it waits; once read, a done PDF lists its pages, 글자 없음 and 실패(암호) say so in both', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await textExtraction(app, 'pause');
    const [search30, noText, locked] = await importPaths(page, [pdf('search-30.pdf'), pdf('no-text.pdf'), pdf('locked.pdf')]);
    const waiting = await seedMetadata(page, search30!.id, { creators: [] }, '형광 관찰 기록');
    const scan = await seedMetadata(page, noText!.id, { creators: [] }, '형광 스캔본');
    const secret = await seedMetadata(page, locked!.id, { creators: [] }, '형광 암호 문서');
    await chooseScope(page, '정보와 본문');
    await panelFor(app, page, '형광', waiting.title);
    await expect(matchStatus(page)).toHaveText('본문을 색인하는 중입니다.');
    await expect(matchList(page)).toHaveCount(0);
    await expect(bodyTextLine(page)).toHaveText('본문을 색인하는 중입니다.');
    await expect(page.locator('[data-testid="file-row"][data-field="bodyText"] dt')).toHaveText('본문 검색');
    await expectNoSeriousA11y(page, 'item panel, 본문 일치 while the index waits');

    await textExtraction(app, 'now');
    await textIdle(app);
    // The index's notice brings the detail again: the rows take the line's place, and the file section is quiet.
    await expect(matches(page).getByTestId('matches-count')).toHaveText('쪽 30개');
    await expect(matchStatus(page)).toHaveCount(0);
    await expect(bodyTextLine(page)).toHaveCount(0);

    await selectRows(page, [scan.title]);
    await expect(matchStatus(page)).toHaveText('글자를 찾지 못했습니다. 스캔한 PDF일 수 있습니다.');
    await expect(bodyTextLine(page)).toHaveText('글자를 찾지 못했습니다. 스캔한 PDF일 수 있습니다.');
    await selectRows(page, [secret.title]);
    await expect(matchStatus(page)).toHaveText('암호로 보호된 PDF라 본문을 색인하지 않았습니다.');
    await expect(bodyTextLine(page)).toHaveText('암호로 보호된 PDF라 본문을 색인하지 않았습니다.');
    await expectNoSeriousA11y(page, 'item panel, 본문 일치 for a locked PDF');
  } finally {
    await app.close();
  }
});

test('no body state line where nothing will read the body: a PDF in the trash and one whose original is missing say nothing, though both said 색인 중 in place', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await textExtraction(app, 'pause');
    const gone = testInfo.outputPath('gone.pdf');
    fs.copyFileSync(pdf('korean.pdf'), gone);
    const [sample] = await importPaths(page, [pdf('sample.pdf')]);
    const [linked] = await importPaths(page, [gone], { mode: 'linked' });
    await chooseScope(page, '정보와 본문');
    // The linked PDF while its original is there: the line in the section and in the file section.
    await panelFor(app, page, 'gone', linked!.title);
    await expect(matchStatus(page)).toHaveText('본문을 색인하는 중입니다.');
    await expect(bodyTextLine(page)).toHaveText('본문을 색인하는 중입니다.');
    // Its original goes: the head says so, and neither place says the body is being indexed.
    fs.rmSync(gone);
    await page.evaluate((id) => window.learn.library.get({ itemId: id }), linked!.id);
    await expect(page.getByTestId('inspector-head').locator('.inline-flag')).toHaveText('파일 없음');
    await expect(page.getByTestId('file-section')).toBeVisible();
    await expect(bodyTextLine(page)).toHaveCount(0);
    await expect(matches(page)).toHaveCount(0);

    // A PDF in place says it; in the trash its panel says nothing about the body.
    await field(page).fill('');
    await selectRows(page, [sample!.title]);
    await expect(bodyTextLine(page)).toHaveText('본문을 색인하는 중입니다.');
    expect(await trashItems(page, [sample!.id])).toBe(1);
    await page.getByTestId('nav-scope-trash').click();
    await selectRows(page, [sample!.title]);
    await expect(page.getByTestId('inspector-head').locator('h2')).toHaveText(sample!.title);
    await expect(page.getByTestId('file-section')).toBeVisible();
    await expect(page.locator('[data-testid="file-row"][data-field="sha256"]')).toBeVisible();
    await expect(bodyTextLine(page)).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('an index cut at a limit says so in 본문 일치: under its rows, and alone when no page matched', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    // Twelve pages written by a job that stopped at a limit; "transduction" is on seven of them, "xylophone" on none.
    const seeded = await seedBodyText(app, { docs: 1, pages: 12, chars: 400, seed: 1, truncated: true });
    const cut = await seedMetadata(page, seeded.itemIds[0]!, { creators: [] }, 'xylophone transduction 기록');
    expect((await detailOf(page, cut.id)).text).toEqual({ state: 'done', pages: 12, truncated: true });
    await chooseScope(page, '정보와 본문');
    await panelFor(app, page, 'transduction', cut.title);
    await expect(matches(page).getByTestId('matches-count')).toHaveText('쪽 7개');
    await expect(matchList(page).getByRole('option')).toHaveCount(7);
    await expect(matchStatus(page)).toHaveText('앞 12쪽까지 색인했습니다.');
    await expect(bodyTextLine(page)).toHaveText('앞 12쪽까지 색인했습니다.');
    // The rows come first, the line under them.
    expect(await matches(page).evaluate((el) => {
      const list = el.querySelector('[data-testid="match-list"]')!;
      return (list.compareDocumentPosition(el.querySelector('[data-testid="matches-status"]')!) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    })).toBe(true);
    // Found by its title only: the section holds the line alone, so no match does not read as none in the whole file.
    await field(page).fill('xylophone');
    // One state that only the answer for this query gives: a section with the line and neither rows nor a count.
    await expect
      .poll(() =>
        matches(page).evaluateAll((els) =>
          els.map((el) => ({
            line: el.querySelector('[data-testid="matches-status"]')?.textContent ?? null,
            rows: el.querySelector('[data-testid="match-list"]') !== null,
            count: el.querySelector('[data-testid="matches-count"]') !== null,
          })),
        ),
      )
      .toEqual([{ line: '앞 12쪽까지 색인했습니다.', rows: false, count: false }]);
    await expectNoSeriousA11y(page, 'item panel, 본문 일치 of a cut index with no match');
  } finally {
    await app.close();
  }
});

// ---- Subtitles in the quick search and the item panel (M8a spec 8.2, 8.3): time rows that open the video at that sentence ----------

const KO = pdf('lecture-60s.ko.srt');
const EN = pdf('lecture-60s.en.vtt');
const timeRow = (page: Page, label: string) => matchList(page).locator('[data-testid="match-row"]').filter({ has: page.locator('.pg', { hasText: label }) });
const timeRowTimes = (page: Page) => matchList(page).getByRole('option').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-time'))));
const transcriptField = (page: Page) => page.getByTestId('transcript-search').getByRole('searchbox');
const videoAt = (page: Page) => page.evaluate(() => window.__learnVideo!.state());

/** lecture-60s.mp4 with `files` attached as its subtitles (the page's own API: the screens come later), its row shown in 정보와 본문. */
async function subtitleLibrary(page: Page, files: string[]) {
  const [video] = await importPaths(page, [pdf('lecture-60s.mp4')]);
  const r = await page.evaluate((input) => window.learn.subtitles.attach(input), { itemId: video!.id, paths: files });
  if (!r.ok) throw new Error(`subtitles.attach failed: ${r.code}`);
  expect(r.data.added).toHaveLength(files.length);
  return video!;
}

test('a word only a subtitle has finds the video in 정보와 본문 and not in 정보; the scope says 자막, and so does a search that found nothing', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const video = await subtitleLibrary(page, [KO]);
    expect(video.title).toBe('lecture-60s');
    await chooseScope(page, '정보와 본문');
    await field(page).fill('칼슘');
    await expect(rowByTitle(page, video.title)).toBeVisible(); // the positive control for the 정보 run below
    await scopeButton(page).click();
    await expect(scopeRow(page, '정보와 본문')).toContainText('PDF 본문·자막 포함');
    await page.keyboard.press('Escape');
    await expect(scopeMenu(page)).toHaveCount(0);
    await field(page).fill('없는낱말입니다');
    await expect(page.getByTestId('search-empty').locator('.pe-text')).toContainText('PDF 본문⁠·자막에서 찾았습니다.');

    await chooseScope(page, '정보');
    await field(page).fill('칼슘');
    await expect(page.getByTestId('search-empty')).toBeVisible();
    await expect(rowByTitle(page, video.title)).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('본문 일치 of a video: "문장 2개" and a row per sentence with its start time; a click opens the video there, paused, the transcript search holding the word with that sentence the match; the PDF\'s page rows still open their page', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const video = await subtitleLibrary(page, [KO]);
    const [pdfItem] = await importPaths(page, [pdf('korean.pdf')]);
    await textExtraction(app, 'now');
    await textIdle(app);
    await chooseScope(page, '정보와 본문');
    await panelFor(app, page, '칼슘 펌프', video.title);
    await expect(matches(page).getByTestId('matches-count')).toHaveText('문장 2개');
    // One track: the clock and the snippet, no track name; the phrase's words are marked in the snippet.
    await expect.poll(() => timeRowTimes(page)).toEqual([19_000, 34_500]);
    await expect(matchList(page).getByRole('option').nth(0).locator('.pg')).toHaveText('0:19');
    await expect(matchList(page).getByRole('option').nth(1).locator('.pg')).toHaveText('0:34');
    await expect(timeRow(page, '0:19')).toHaveAccessibleName(/^0:19, 칼슘 펌프는 칼슘 이온을 세포 밖으로 내보냅니다\./);
    await expect(timeRow(page, '0:19').locator('mark').first()).toHaveText('칼슘');
    await expect(matches(page).getByTestId('matches-more')).toHaveCount(0);
    expect((await panelParts(page)).slice(0, 3)).toEqual(['inspector-head', 'matches-section', 'info-section']);
    await expectNoSeriousA11y(page, 'item panel, 본문 일치 of a video');

    // A click: the tab opens at the sentence, paused (a row never starts playback), the search holds the word, that sentence is the match.
    await timeRow(page, '0:34').click();
    await expect(readerTab(page, video.id)).toBeVisible();
    // The sentence holds the whole query as typed ("칼슘 펌프" side by side), so the field has all of it.
    await expect(transcriptField(page)).toHaveValue('칼슘 펌프');
    await expect.poll(async () => Math.abs((await videoAt(page))!.timeMs - 34_500)).toBeLessThanOrEqual(80);
    expect((await videoAt(page))!.paused).toBe(true);
    expect((await videoAt(page))!.captionsOn).toBe(true);
    await expect(page.getByTestId('transcript-count')).toHaveText('2개');
    const hit = page.locator('[data-testid="cue-row"][data-index="9"]');
    await expect(hit).toBeVisible();
    await expect(hit.locator('mark.is-current').first()).toBeVisible();
    await expect(page.locator('[data-testid="transcript"] mark.is-current')).toHaveCount(1); // the phrase once: the cue's other 칼슘 is no match
    await expect(page.getByTestId('transcript-follow')).toHaveAttribute('data-selected');
    await expect(hit).toHaveAttribute('data-current', 'true');

    // The tab is open: another row jumps in place (↩ on the focused row), and the search keeps the same word.
    await libraryTab(page).click();
    await expect(timeRow(page, '0:19')).toBeVisible();
    await timeRow(page, '0:19').focus();
    await page.keyboard.press('Enter');
    await expect(readerTab(page, video.id)).toHaveAttribute('aria-selected', 'true');
    await expect.poll(async () => Math.abs((await videoAt(page))!.timeMs - 19_000)).toBeLessThanOrEqual(80);
    await expect(page.locator('[data-testid="cue-row"][data-index="5"]')).toHaveAttribute('data-current', 'true');
    await expect(transcriptField(page)).toHaveValue('칼슘 펌프');
    expect((await videoAt(page))!.paused).toBe(true);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __learnReader: { getState(): { pendingJump: unknown } } }).__learnReader.getState().pendingJump)).toBeNull();

    // The PDF's rows are as they were: a page row opens the reader at that page (regression of the page jump).
    await libraryTab(page).click();
    await field(page).fill('메커니즘은');
    await expect(rowByTitle(page, pdfItem!.title)).toBeVisible();
    await selectRows(page, [pdfItem!.title]);
    await expect(matchRow(page, 2)).toBeVisible();
    await matchRow(page, 2).click();
    await expectReaderAt(page, 2, '메커니즘은', '2 / 3');
  } finally {
    await app.close();
  }
});

test('with two subtitles a row names its track ("0:23 · 한국어" and "0:23 · 영어": two rows, two sentences), and a click shows that track', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const video = await subtitleLibrary(page, [KO, EN]);
    await chooseScope(page, '정보와 본문');
    await panelFor(app, page, 'ATP', video.title);
    await expect(matches(page).getByTestId('matches-count')).toHaveText('문장 2개');
    await expect(matchList(page)).toHaveClass(/tracks/);
    await expect(matchList(page).getByRole('option').locator('.pg')).toHaveText(['0:23 · 한국어', '0:23 · 영어']);
    await expect(timeRow(page, '영어')).toHaveAccessibleName(/^0:23\u00a0· 영어, /);
    // Each row shows its own track's sentence, not the other's.
    await expect(timeRow(page, '영어').locator('.snip')).toHaveText('This process needs ATP.');
    await expect(timeRow(page, '한국어').locator('.snip')).toHaveText('이 과정에는 ATP가 필요합니다.');
    await timeRow(page, '영어').click();
    await expect(readerTab(page, video.id)).toBeVisible();
    await expect(transcriptField(page)).toHaveValue('ATP');
    const tracks = await page.evaluate((id) => window.learn.subtitles.list({ itemId: id }), video.id);
    if (!tracks.ok) throw new Error('subtitles.list failed');
    const english = tracks.data.tracks.find((t) => t.language === 'en')!;
    await expect.poll(async () => (await videoAt(page))!.trackId).toBe(english.assetId);
    expect((await videoAt(page))!.captionsOn).toBe(true);
    await expect.poll(async () => Math.abs((await videoAt(page))!.timeMs - 23_000)).toBeLessThanOrEqual(80);
    await expect(page.locator('[data-testid="cue-row"][data-index="6"]')).toHaveAttribute('data-current', 'true');
    await expect(page.locator('[data-testid="transcript"] mark.is-current')).toHaveCount(1);
  } finally {
    await app.close();
  }
});

test('a video in the trash is not found by its subtitles, and once deleted for good its sentences are gone from the index', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const video = await subtitleLibrary(page, [KO]);
    expect(await cueTextCount(app, { itemId: video.id })).toBeGreaterThan(0);
    await chooseScope(page, '정보와 본문');
    await field(page).fill('칼슘');
    await expect(rowByTitle(page, video.title)).toBeVisible(); // the positive control
    const found = await page.evaluate((id) => window.learn.search.matches({ itemId: id, query: '칼슘' }), video.id);
    expect(found.ok && found.data.total).toBe(2);
    // The cue texts are keyed by the subtitle file's content, not the video's.
    const [asset] = await subtitleAssets(app);
    const sha256 = asset!.sha256;
    expect(await cueTextCount(app, { sha256 })).toBeGreaterThan(0);
    const bodyIds = () => page.evaluate(() => window.learn.search.body({ query: '칼슘' }).then((r) => (r.ok ? r.data.itemIds : null)));
    expect(await bodyIds()).toEqual([video.id]); // the positive control: the search itself finds the live video
    await trashItems(page, [video.id]);
    // The search, not the table, says it: search:body no longer answers the trashed video.
    await expect.poll(bodyIds).toEqual([]);
    const gone = await page.evaluate((id) => window.learn.search.matches({ itemId: id, query: '칼슘' }), video.id);
    expect(gone.ok && gone.data.total).toBe(0);
    await expect(rowByTitle(page, video.title)).toHaveCount(0);
    const purged = await page.evaluate((itemIds) => window.learn.library.purge({ itemIds, collectionIds: [] }), [video.id]);
    expect(purged.ok).toBe(true);
    await expect.poll(() => cueTextCount(app, { sha256 })).toBe(0);
  } finally {
    await app.close();
  }
});

/** 자막 ▾ on the open video, its open panel answering with `files`: the reader's own way to attach. */
async function addSubtitlesOnTab(app: ElectronApplication, page: Page, files: string[]): Promise<void> {
  await stubOpenDialog(app, files);
  await expect(page.getByRole('menu')).toHaveCount(0);
  await page.getByTestId('subtitles-menu').click();
  await page.getByTestId('subtitle-add').click();
  await expect(page.getByTestId('subtitle-attached')).toBeVisible();
}

test('a subtitle attached on the video tab is searched at once: the same query typed again finds the video, and 본문 일치 lists its sentences', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const [video] = await importPaths(page, [pdf('lecture-60s.mp4')]);
    await chooseScope(page, '정보와 본문');
    await field(page).fill('칼슘 펌프');
    // The body has answered (no video has the words yet): the answer the window keeps for this query.
    await expect(page.getByTestId('search-empty').locator('.pe-text')).toContainText('PDF 본문⁠·자막에서 찾았습니다.');
    await field(page).fill('');
    await openItem(page, video!.title);
    await videoReady(page);
    await addSubtitlesOnTab(app, page, [KO]);

    await libraryTab(page).click();
    await field(page).fill('칼슘 펌프');
    await expect(rowByTitle(page, video!.title)).toBeVisible();
    await showItemPanel(app, page);
    await selectRows(page, [video!.title]);
    await expect(matches(page).getByTestId('matches-count')).toHaveText('문장 2개');
    await expect.poll(() => timeRowTimes(page)).toEqual([19_000, 34_500]);
  } finally {
    await app.close();
  }
});

test('이 자막 제거 takes its sentences out of the same query typed again: 본문 일치 has no time rows; the restore brings them back', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const video = await subtitleLibrary(page, [KO]);
    // Its title holds the query too: the row stays in the table by its metadata, and the panel shows what the body says of it.
    const titled = await seedMetadata(page, video.id, { creators: [] }, '칼슘 펌프 강의');
    const listed = await page.evaluate((id) => window.learn.subtitles.list({ itemId: id }), video.id);
    if (!listed.ok) throw new Error('subtitles.list failed');
    const [track] = listed.data.tracks;
    await chooseScope(page, '정보와 본문');
    await panelFor(app, page, '칼슘 펌프', titled.title);
    await expect.poll(() => timeRowTimes(page)).toEqual([19_000, 34_500]); // the positive control: the rows the removal must take
    await field(page).fill('');
    await openItem(page, titled.title);
    await videoReady(page);
    await expect(page.getByTestId('subtitles-menu')).toHaveText('한국어');
    await page.getByTestId('subtitles-menu').click();
    await page.getByRole('menuitem', { name: '이 자막 제거' }).click();
    await expect(page.getByTestId('subtitle-removed')).toBeVisible();

    await libraryTab(page).click();
    await field(page).fill('칼슘 펌프');
    await expect(rowByTitle(page, titled.title)).toBeVisible();
    await selectRows(page, [titled.title]);
    await expect(page.getByTestId('inspector-head').locator('h2')).toHaveText(titled.title);
    await expect(matches(page)).toHaveCount(0);

    // The undo's route, while the library shows the query's answer without the sentences.
    const back = await page.evaluate((input) => window.learn.subtitles.restore(input), { itemId: video.id, assetId: track!.assetId, position: track!.position, language: track!.language });
    expect(back.ok).toBe(true);
    await field(page).fill('');
    await field(page).fill('칼슘 펌프');
    await expect.poll(() => timeRowTimes(page)).toEqual([19_000, 34_500]);
  } finally {
    await app.close();
  }
});

test('a sentence that holds the query\'s words apart opens with one word of it in the transcript search; the match is still that sentence', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const video = await subtitleLibrary(page, [KO]);
    await chooseScope(page, '정보와 본문');
    // "펌프가 멈추면 세포 안의 칼슘 농도가": both words, not side by side.
    await panelFor(app, page, '펌프 농도', video.title);
    await expect(matches(page).getByTestId('matches-count')).toHaveText('문장 1개');
    await timeRow(page, '0:34').click();
    await expect(readerTab(page, video.id)).toBeVisible();
    await expect(transcriptField(page)).toHaveValue('펌프');
    await expect(page.locator('[data-testid="cue-row"][data-index="9"] mark.is-current')).toBeVisible();
  } finally {
    await app.close();
  }
});

test('the time column takes the widest label of a two-track list ("65:12 · 포르투갈어(브라질)"), the track\'s name alone is cut, and no label runs over its snippet', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const dir = testInfo.outputPath('subs');
    fs.mkdirSync(dir, { recursive: true });
    const cue = (text: string) => `1\n01:05:12,000 --> 01:05:15,000\n${text}\n`;
    const koFile = path.join(dir, 'long.ko.srt');
    const enFile = path.join(dir, 'long.pt-BR.srt');
    fs.writeFileSync(koFile, cue('ATP 없이는 칼슘 펌프가 칼슘 이온을 세포 밖으로 내보내지 못합니다.'));
    fs.writeFileSync(enFile, cue('ATP: a bomba de cálcio leva os íons de cálcio para fora da célula.'));
    const video = await subtitleLibrary(page, [koFile, enFile]);
    await chooseScope(page, '정보와 본문');
    await panelFor(app, page, 'ATP', video.title);
    await expect(matches(page).getByTestId('matches-count')).toHaveText('문장 2개');
    await expect(matchList(page).locator('.pg').nth(1)).toContainText('65:12');
    await expect(matchList(page).locator('.pg').nth(1)).toContainText('포르투갈어(브라질)');
    const boxes = () =>
      matchList(page).getByRole('option').evaluateAll((rows) =>
        rows.map((row) => {
          const pg = row.querySelector('.pg')!.getBoundingClientRect();
          const snip = row.querySelector('.snip')!.getBoundingClientRect();
          const clk = row.querySelector('.clk')!.getBoundingClientRect();
          return { pgRight: pg.right, snipLeft: snip.left, clkRight: clk.right, pgLeft: pg.left, width: pg.width };
        }),
      );
    const rows = await boxes();
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.width, 'wider than the floor: the label asked for it').toBeGreaterThan(92);
      expect(row.pgRight).toBeLessThanOrEqual(row.snipLeft); // no label runs over its snippet
      expect(row.clkRight).toBeLessThanOrEqual(row.pgRight);
    }
    expect(rows[0]!.snipLeft).toBe(rows[1]!.snipLeft); // one column for both rows
  } finally {
    await app.close();
  }
});
