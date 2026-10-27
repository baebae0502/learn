// Search and palette with the organize data (M5): the tag names the quick search reads, the view it is limited to
// and the empty state that names it, 내 라이브러리 전체에서 찾기, the palette's 컬렉션 group, the item ranking, the render
// count of a keystroke and the cut of the long fields.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { expectNoSeriousA11y } from './a11y';
import {
  FIXTURES, addToCollection, assignTag, createCollection, createTag, importPaths, launch, openItem, renderCounts, rowByTitle, runMenuCommand, seedLibrary, seedMetadata, watchRenders,
} from './helpers';

const FILES = [
  path.join(FIXTURES, 'sample.pdf'),
  path.join(FIXTURES, '한글 경로 (테스트) #1.pdf'),
  path.join(FIXTURES, 'sample-h264-aac.mp4'),
  path.join(FIXTURES, 'sample-mpeg4part2.mp4'),
];
const SIGNAL = '세포 신호 전달 개요';
const FOLD = '단백질 접힘 강의 노트';
const BAYES = 'Intro to Bayesian Inference';
const PHOTO = '광합성 명반응';
const dirs = (i: { outputPath(...p: string[]): string }) => [i.outputPath('library'), i.outputPath('userdata')] as const;

test.beforeAll(() => {
  for (const f of FILES) if (!fs.existsSync(f)) throw new Error(`fixture missing: ${f} — run \`pnpm fixtures\``);
});

/** Four items with known titles; the first has an abstract and a memo. */
async function library(page: Page) {
  const [a, b, c, d] = await importPaths(page, FILES);
  await seedMetadata(page, a!.id, { creators: [{ name: '김철수', role: 'author' }], date: '2024', publisher: '분자생물학회', abstract: '수용체가 신호를 증폭하는 과정을 다룹니다.', extra: '시험 범위' }, SIGNAL);
  await seedMetadata(page, b!.id, { creators: [{ name: '이영희', role: 'author' }], date: '2023', publisher: 'Learn Press' }, FOLD);
  await seedMetadata(page, c!.id, { creators: [{ name: 'Jane Smith', role: 'lecturer' }], date: '2021' }, BAYES);
  await seedMetadata(page, d!.id, { creators: [] }, PHOTO);
  await expect(rowByTitle(page, PHOTO)).toBeVisible();
  await expect(rowByTitle(page, SIGNAL)).toBeVisible();
  return [a!, b!, c!, d!] as const;
}
const input = (page: Page) => page.getByTestId('search-field').locator('input');

/** The render counts once none has changed for three polls: what a keystroke renders is final by then. */
async function settledRenders(page: Page): Promise<Record<string, number>> {
  let last = JSON.stringify(await renderCounts(page));
  for (let quiet = 0; quiet < 3; ) {
    await page.waitForTimeout(150);
    const now = JSON.stringify(await renderCounts(page));
    quiet = now === last ? quiet + 1 : 0;
    last = now;
  }
  return JSON.parse(last) as Record<string, number>;
}

/** The titles of the table's rows, sorted (the few rows these tests make all fit on screen). */
const titles = (page: Page) => page.getByTestId('item-row').evaluateAll((els) => els.map((e) => e.getAttribute('data-title')).sort());
const sorted = (...xs: string[]) => [...xs].sort();
/** ⌘K through the menu command (a CDP key never reaches a native accelerator on Linux), then the query in its field. */
async function paletteWith(app: ElectronApplication, page: Page, query: string): Promise<void> {
  await runMenuCommand(app, 'app.palette');
  await expect(page.getByTestId('palette-input')).toBeFocused();
  await page.getByTestId('palette-input').fill(query);
}
const chip = (page: Page, tagId: string) => page.getByTestId(`tag-chip-${tagId}`);

test('typing in the quick search re-renders the table, the toolbar and the field, never the main window', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    const [first] = await library(page);
    await seedLibrary(app, { count: 300, from: first });
    await expect(page.getByTestId('toolbar-count')).toHaveText('304개');
    await runMenuCommand(app, 'library.find');
    await expect(input(page)).toBeFocused();
    await watchRenders(page);
    // The first character turns "a search is active" on in the command context, which the main window reports to the menu bar: once.
    await page.keyboard.insertText('세');
    await expect(page.getByTestId('toolbar-count')).toHaveText(/ \/ 304개$/);
    const before = await settledRenders(page);
    expect(before['MainWindow'] ?? 0, 'the counter reaches the main window').toBeGreaterThan(0);
    for (const ch of ['포', ' ', '신', '호']) await page.keyboard.insertText(ch);
    await expect(input(page)).toHaveValue('세포 신호');
    await expect(page.getByTestId('toolbar-count')).toHaveText(/^\d+개 \/ 304개$/);
    const after = await settledRenders(page);
    expect(after['MainWindow'], 'the main window rendered again while the query changed').toBe(before['MainWindow']);
    for (const name of ['LibraryView', 'LibraryToolbar', 'LibrarySearch']) {
      expect(after[name] ?? 0, `${name} follows the query`).toBeGreaterThan(before[name] ?? 0);
    }
  } finally {
    await app.close();
  }
});

test('the quick search reads tag names — by letters, by 초성, with the other fields — and follows a rename, a tag put on or taken off, and a deletion', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    const [a, b, , d] = await library(page);
    const core = await createTag(page, '핵심 개념');
    const gq = await createTag(page, '수용체 Gq');
    await assignTag(page, core, [b.id]);
    await assignTag(page, gq, [d.id]);
    await runMenuCommand(app, 'library.find');
    await expect(input(page)).toBeFocused();
    await expect(input(page)).toHaveAttribute('placeholder', '제목, 저자, 태그 검색');
    const find = async (query: string, expected: string[]) => {
      await input(page).fill(query);
      await expect.poll(() => titles(page), query).toEqual(expected);
    };
    await find('개념', [FOLD]);
    await expect(page.getByTestId('toolbar-count')).toHaveText('1개 / 4개');
    await expect(rowByTitle(page, FOLD).locator('mark')).toHaveCount(0); // a tag-only match marks nothing in the title
    await find('ㄱㄴ', [FOLD]); // the 초성 of 개념
    await find('GQ', [PHOTO]); // any case
    await find('수용체', sorted(SIGNAL, PHOTO)); // SIGNAL's abstract, PHOTO's tag
    await find('접힘 핵심', [FOLD]); // a word of the title and a word of the tags: one more field of the AND
    await input(page).fill('광합성 핵심');
    await expect(page.getByTestId('search-empty')).toBeVisible();

    // The same query follows the data, with no reload: a rename, a tag put on, taken off, deleted.
    await find('개념', [FOLD]);
    await page.evaluate((tagId) => window.learn.tags.rename({ tagId, name: '정리 완료' }), core);
    await expect(page.getByTestId('search-empty')).toBeVisible(); // 개념 is no tag name now
    await find('정리', [FOLD]);
    await assignTag(page, core, [a.id]);
    await expect.poll(() => titles(page)).toEqual(sorted(SIGNAL, FOLD));
    await page.evaluate((i) => window.learn.tags.unassign(i), { tagId: core, itemIds: [b.id] });
    await expect.poll(() => titles(page)).toEqual([SIGNAL]);
    await page.evaluate((tagId) => window.learn.tags.remove({ tagId }), core);
    await expect(page.getByTestId('search-empty')).toBeVisible();

    // The palette reads the same tag names.
    await input(page).fill('');
    await paletteWith(app, page, 'Gq');
    await expect(page.getByTestId('palette-result')).toHaveCount(1);
    await expect(page.getByTestId('palette-result')).toHaveAttribute('data-item-id', d.id);
    await page.keyboard.press('Escape');
  } finally {
    await app.close();
  }
});

test('the search is limited to the view and the tag filter; its empty state names the view and offers 내 라이브러리 전체에서 찾기', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    const [a, b] = await library(page);
    const bio = await createCollection(page, '분자생물학');
    await addToCollection(page, bio, [a.id]);
    const key = await createTag(page, '핵심');
    await assignTag(page, key, [b.id]);
    await runMenuCommand(app, 'library.find');
    await expect(input(page)).toBeFocused();
    const empty = page.getByTestId('search-empty');
    const body = empty.locator('.pe-text');
    const FIELDS = '제목·저자·태그·출판사·원래 이름·초록·메모에서 찾았습니다.';

    // 내 라이브러리: the plain sentence and one action.
    await input(page).fill('효소 억제제');
    await expect(body).toHaveText(FIELDS);
    await expect(page.getByTestId('search-empty-clear')).toBeVisible();
    await expect(page.getByTestId('search-empty-everywhere')).toHaveCount(0);

    // A collection: the query stays across the view change (spec 3.5); the sentence names the view; both actions.
    await page.getByTestId(`nav-collection-${bio}`).click();
    await expect(page.getByTestId('toolbar-title')).toHaveText('분자생물학');
    await expect(input(page)).toHaveValue('효소 억제제');
    await expect(body).toHaveText(`‘분자생물학’의 ${FIELDS}`);
    await expect(page.getByTestId('search-empty-everywhere')).toHaveText('내 라이브러리 전체에서 찾기');
    await expectNoSeriousA11y(page, 'quick search, no results in a collection');

    // The results are the view's: FOLD is in the library, not in 분자생물학.
    await input(page).fill('접힘');
    await expect(empty).toBeVisible();
    await expect(page.getByTestId('toolbar-count')).toHaveText('0개 / 1개');
    await page.getByTestId('search-empty-everywhere').click();
    await expect(page.getByTestId('toolbar-title')).toHaveText('내 라이브러리');
    await expect(input(page)).toHaveValue('접힘'); // kept
    await expect(input(page)).toBeFocused(); // the button went with the empty state
    await expect.poll(() => titles(page)).toEqual([FOLD]);
    await expect(empty).toHaveCount(0);

    // A special view is named in the same way.
    await page.getByTestId('nav-scope-unfiled').click();
    await input(page).fill('신호'); // SIGNAL is filed in 분자생물학
    await expect(body).toHaveText(`‘미분류’의 ${FIELDS}`);
    await page.getByTestId('search-empty-everywhere').click();
    await expect.poll(() => titles(page)).toEqual([SIGNAL]);

    // The tag filter narrows the same way; the empty state says how many tags did it (spec 3.6).
    await input(page).fill('');
    await chip(page, key).click(); // 핵심: FOLD alone
    await expect.poll(() => titles(page)).toEqual([FOLD]);
    await input(page).fill('광합성'); // PHOTO is in the library but has no 핵심
    await expect(body).toHaveText(`${FIELDS} 고른 태그 1개로 거른 결과입니다.`);
    await expect(page.getByTestId('toolbar-count')).toHaveText('0개 / 4개');
    await page.getByTestId('search-empty-clear').click();
    await expect.poll(() => titles(page)).toEqual([FOLD]); // the filter stays when the query goes
  } finally {
    await app.close();
  }
});

test('the palette lists 내 라이브러리 전체에서 찾기 only for a search outside 내 라이브러리, and running it keeps the query', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    const [a] = await library(page);
    const bio = await createCollection(page, '분자생물학');
    await addToCollection(page, bio, [a.id]);
    const row = page.locator('[data-testid="palette-item"][data-command-id="library.findEverywhere"]');

    // 내 라이브러리 with a search: nothing to widen.
    await runMenuCommand(app, 'library.find');
    await input(page).fill('접힘');
    await paletteWith(app, page, '전체에서');
    await expect(row).toHaveCount(0);
    await page.keyboard.press('Escape');
    // A collection without a search: nothing to keep.
    await input(page).fill('');
    await page.getByTestId(`nav-collection-${bio}`).click();
    await expect(page.getByTestId('toolbar-title')).toHaveText('분자생물학');
    await paletteWith(app, page, '전체에서');
    await expect(row).toHaveCount(0);
    await page.keyboard.press('Escape');

    // A collection with a search: listed, and ↩ returns the view to 내 라이브러리 with the query still in the field.
    await runMenuCommand(app, 'library.find');
    await input(page).fill('접힘');
    await paletteWith(app, page, '전체에서');
    await expect(row).toHaveCount(1);
    await expect(row).toHaveText('내 라이브러리 전체에서 찾기');
    await expect(row).toHaveAttribute('data-focused', 'true');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('palette')).toBeHidden();
    await expect(page.getByTestId('toolbar-title')).toHaveText('내 라이브러리');
    await expect(input(page)).toHaveValue('접힘');
    await expect.poll(() => titles(page)).toEqual([FOLD]);
    // The palette's own 라이브러리에서 ‘…’ 검색 row does the same from a view: the 자료 rows above it searched everything.
    await page.getByTestId(`nav-collection-${bio}`).click();
    await paletteWith(app, page, '증폭');
    await page.getByTestId('palette-search-library').click();
    await expect(page.getByTestId('toolbar-title')).toHaveText('내 라이브러리');
    await expect(input(page)).toHaveValue('증폭');
  } finally {
    await app.close();
  }
});

test('the long fields are searched up to their first 4,000 characters', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    const [, b] = await library(page);
    // 앞낱말 ends at 3,954; 뒷낱말 starts at 4,056.
    const abstract = `${'가'.repeat(3950)} 앞낱말 ${'나'.repeat(100)} 뒷낱말`;
    await seedMetadata(page, b.id, { creators: [], abstract }, FOLD);
    await runMenuCommand(app, 'library.find');
    await input(page).fill('앞낱말');
    await expect.poll(() => titles(page)).toEqual([FOLD]);
    await input(page).fill('뒷낱말');
    await expect(page.getByTestId('search-empty')).toBeVisible();
  } finally {
    await app.close();
  }
});

test('the palette lists 컬렉션 between 자료 and 명령: by name with 초성, five at most, the parent and count beside it, and ↩ shows the collection', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    const [a, , c] = await library(page);
    const bio = await createCollection(page, '분자생물학');
    const ch6 = await createCollection(page, '6장 · 신호 전달', bio);
    await createCollection(page, '7장 · 세포 주기', bio);
    const stat = await createCollection(page, '통계');
    await addToCollection(page, ch6, [a.id]);
    await addToCollection(page, stat, [c.id]);
    const ga = await createCollection(page, '노트 가');
    const na = await createCollection(page, '노트 나');
    const mo = await createCollection(page, '노트 모음');
    const mo2 = await createCollection(page, '노트 모음', bio);
    const nong = await createCollection(page, '농토');
    await createCollection(page, '강의 노트');
    const rows = page.locator('.palette [role="option"]');
    const kinds = () => rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    const collectionIds = () => page.getByTestId('palette-collection').evaluateAll((els) => els.map((e) => e.getAttribute('data-collection-id')));

    // No query: commands only.
    await runMenuCommand(app, 'app.palette');
    await expect(page.locator('.palette .p-group')).toHaveText(['명령']);
    await expect(page.getByTestId('palette-collection')).toHaveCount(0);

    // 신호: the item, the collection that holds it in its name, the hand-off to the quick search.
    await page.getByTestId('palette-input').fill('신호');
    await expect(page.locator('.palette .p-group')).toHaveText(['자료', '컬렉션', '명령']);
    await expect.poll(kinds).toEqual(['palette-result', 'palette-collection', 'palette-search-library']);
    const folder = page.getByTestId('palette-collection');
    await expect(folder.locator('.p-title mark')).toHaveText('신호');
    await expect(folder.locator('.p-sub')).toHaveText('분자생물학 안 · 1개');
    await expect(folder.locator('svg').first()).toHaveClass(/lucide-folder\b/);
    await expect(page.getByTestId('palette-status')).toHaveText('자료 1개, 컬렉션 1개');
    await expectNoSeriousA11y(page, 'palette, 컬렉션 group');
    await page.keyboard.press('ArrowDown'); // 자료 → 컬렉션
    await expect(folder).toHaveAttribute('data-focused', 'true');
    await expect(folder.locator('.kbd-group')).toHaveCount(1); // ↩ on the cursor row only
    await expect(page.locator('.p-foot .row').nth(1)).toHaveText(/열기/);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('palette')).toBeHidden();
    await expect(page.getByTestId('toolbar-title')).toHaveText('6장 · 신호 전달');
    await expect.poll(() => titles(page)).toEqual([SIGNAL]);
    await expect(page.getByTestId(`nav-collection-${ch6}`)).toBeVisible(); // the sidebar shows where it is, under the collapsed parent

    // ㄴㅌ: by where the name matched (초성 too), then the shorter path, then the name; five of six.
    await paletteWith(app, page, 'ㄴㅌ');
    await expect.poll(collectionIds).toEqual([ga, na, mo, nong, mo2]);
    await expect(folder.nth(4).locator('.p-sub')).toHaveText('분자생물학 안 · 0개'); // the nested 노트 모음 is fifth, after the roots
    await expect(folder.first().locator('.p-sub')).toHaveText('0개'); // a top-level collection: the count alone
    await page.keyboard.press('Escape');

    // From the reader: back to the library, then the collection.
    await openItem(page, SIGNAL);
    await paletteWith(app, page, '통계');
    await expect(page.getByTestId('palette-collection')).toHaveCount(1);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('library-table')).toBeVisible();
    await expect(page.getByTestId('toolbar-title')).toHaveText('통계');
    await expect.poll(() => titles(page)).toEqual([BAYES]);

    // Nothing matches: the title names all three groups.
    await paletteWith(app, page, 'ㅍㅍㅍㅍ');
    await expect(page.getByTestId('palette-empty').locator('.pe-title')).toHaveText('‘ㅍㅍㅍㅍ’와 일치하는 자료·컬렉션·명령이 없습니다');
    await expect(page.getByTestId('palette-status')).toHaveText('‘ㅍㅍㅍㅍ’와 일치하는 자료·컬렉션·명령이 없습니다');
  } finally {
    await app.close();
  }
});

test('a letter match in the title ranks above a 초성 match even when the 초성 match is earlier', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    const [a, b] = await library(page);
    await seedMetadata(page, a.id, { creators: [] }, '노트 ㅅㅎ'); // holds the jamo itself, at 3
    await seedMetadata(page, b.id, { creators: [] }, '신호 증폭'); // reads as ㅅㅎ, at 0
    await expect(rowByTitle(page, '신호 증폭')).toBeVisible();
    await paletteWith(app, page, 'ㅅㅎ');
    await expect
      .poll(() => page.getByTestId('palette-result').evaluateAll((els) => els.map((e) => e.getAttribute('data-item-id'))))
      .toEqual([a.id, b.id]);
  } finally {
    await app.close();
  }
});

test('a Korean composition in the palette does not take a collection row: ↩ while composing stays, after the commit it shows the collection', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    const [a] = await library(page);
    const lab = await createCollection(page, '현미경 실습');
    await addToCollection(page, lab, [a.id]);
    await runMenuCommand(app, 'app.palette');
    const field = page.getByTestId('palette-input');
    await expect(field).toBeFocused();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.imeSetComposition', { text: 'ㅎㅁㄱ', selectionStart: 3, selectionEnd: 3 });
    await expect(page.getByTestId('palette-collection')).toHaveCount(1);
    await expect(page.getByTestId('palette-collection')).toHaveAttribute('data-focused', 'true');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('palette')).toBeVisible();
    await expect(page.getByTestId('toolbar-title')).toHaveText('내 라이브러리');
    await cdp.send('Input.insertText', { text: 'ㅎㅁㄱ' }); // commits the composition
    await expect(field).toHaveValue('ㅎㅁㄱ');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('palette')).toBeHidden();
    await expect(page.getByTestId('toolbar-title')).toHaveText('현미경 실습');
  } finally {
    await app.close();
  }
});
