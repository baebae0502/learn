// Quick search (spec 4.1–4.3): ⌘F and the toolbar field, its count, 초성 and AND across the fields, the abstract and
// memo read on the first query, the title mark, esc and ↓, the no-results state, IME composition, hidden rows leaving
// the selection, a query that lasts the session only. ⌘F goes through runMenuCommand (CDP keys never reach native
// accelerators on Linux); a real ⌘F is checked on macOS by tests/evidence/library.evidence.ts.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { expectNoSeriousA11y } from './a11y';
import { FIXTURES, importPaths, launch, menuItemEnabled, openItem, rowByTitle, runMenuCommand, seedMetadata } from './helpers';

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
const IS_MAC = process.platform === 'darwin';
const dirs = (i: { outputPath(...p: string[]): string }) => [i.outputPath('library'), i.outputPath('userdata')] as const;

test.beforeAll(() => {
  for (const f of FILES) if (!fs.existsSync(f)) throw new Error(`fixture missing: ${f} — run \`pnpm fixtures\``);
});

/** Four items with known titles and metadata; the first has an abstract and a memo. */
async function library(page: Page): Promise<void> {
  const [a, b, c, d] = await importPaths(page, FILES);
  await seedMetadata(page, a!.id, { creators: [{ name: '김철수', role: 'author' }], date: '2024', publisher: '분자생물학회', abstract: '수용체가 신호를 증폭하는 과정을 다룹니다.', extra: '시험 범위' }, SIGNAL);
  await seedMetadata(page, b!.id, { creators: [{ name: '이영희', role: 'author' }], date: '2023', publisher: 'Learn Press' }, FOLD);
  await seedMetadata(page, c!.id, { creators: [{ name: 'Jane Smith', role: 'lecturer' }], date: '2021' }, BAYES);
  await seedMetadata(page, d!.id, { creators: [] }, PHOTO);
  await expect(rowByTitle(page, PHOTO)).toBeVisible();
  await expect(rowByTitle(page, SIGNAL)).toBeVisible();
}
const input = (page: Page) => page.getByTestId('search-field').locator('input');
/** The titles of the table's rows (all four fit on screen, so every row is drawn). */
const titles = (page: Page) => page.getByTestId('item-row').evaluateAll((els) => els.map((e) => e.getAttribute('data-title')).sort());
/** A CSS colour token as the page computes it. */
const tokenIn = (page: Page, name: string) =>
  page.evaluate((v) => {
    const p = document.createElement('span');
    document.body.append(p);
    p.style.color = `var(${v})`;
    const c = getComputedStyle(p).color;
    p.remove();
    return c;
  }, name);

test('the field: after 가져오기, 240 wide, clickable in the drag strip, named after ⌘F; none in the empty library, and ⌘F is off there and in the reader', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    // Nothing to find in an empty library: no field, ⌘F greyed (spec 3.5).
    await expect(page.getByTestId('empty-state')).toBeVisible();
    await expect(page.getByTestId('search-field')).toHaveCount(0);
    expect(await menuItemEnabled(app, 'library.find')).toBe(false);
    await library(page);
    const field = page.getByTestId('search-field');
    await expect(field).toBeVisible();
    expect(Math.round((await field.boundingBox())!.width)).toBe(240);
    expect(await page.locator('.tb-actions').evaluate((el) => [...el.querySelectorAll('[data-testid="import-menu"], [data-testid="search-field"]')].map((e) => e.getAttribute('data-testid')))).toEqual(['import-menu', 'search-field']);
    // The toolbar is a drag strip: the field must take the click.
    expect(await field.evaluate((el) => getComputedStyle(el).getPropertyValue('-webkit-app-region') || getComputedStyle(el).getPropertyValue('app-region'))).toBe('no-drag');
    await expect(input(page)).toHaveAttribute('placeholder', '제목, 저자, 태그 검색');
    await expect(page.getByRole('searchbox', { name: '빠른 검색' })).toHaveCount(1);
    await expect(input(page)).toHaveAttribute('aria-keyshortcuts', IS_MAC ? 'Meta+F' : 'Control+F');
    await expect(page.getByTestId('toolbar-count')).toHaveText('4개');
    await expect.poll(() => menuItemEnabled(app, 'library.find')).toBe(true);
    await openItem(page, SIGNAL);
    await expect(page.getByTestId('pdf-canvas')).toBeVisible();
    await expect.poll(() => menuItemEnabled(app, 'library.find')).toBe(false);
    await expect(page.getByTestId('search-field')).toHaveCount(0); // the reader's toolbar has none
  } finally {
    await app.close();
  }
});

test('⌘F selects the field; 초성, two letters, AND over every field, the abstract and memo, the count and the title mark; no results', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await library(page);
    await runMenuCommand(app, 'library.find');
    await expect(input(page)).toBeFocused();
    await page.keyboard.type('신호');
    await expect.poll(() => titles(page)).toEqual([SIGNAL]);
    await expect(page.getByTestId('toolbar-count')).toHaveText('1개 / 4개');
    const mark = rowByTitle(page, SIGNAL).locator('mark');
    await expect(mark).toHaveText('신호');
    expect(await mark.evaluate((el) => getComputedStyle(el).color)).toBe(await tokenIn(page, '--accent-text'));
    await expect(page.getByTestId('search-status')).toHaveText('일치하는 자료 1개');
    await expectNoSeriousA11y(page, 'quick search, results');
    // ⌘F again selects what is typed, so the next keys replace it.
    await runMenuCommand(app, 'library.find');
    await expect(input(page)).toBeFocused();
    await expect.poll(() => input(page).evaluate((el) => [(el as HTMLInputElement).selectionStart, (el as HTMLInputElement).selectionEnd])).toEqual([0, 2]);
    await page.keyboard.type('ㅅㅎ');
    await expect(input(page)).toHaveValue('ㅅㅎ');
    await expect.poll(() => titles(page)).toEqual([SIGNAL]);
    await expect(mark).toHaveText('신호');
    // A creator, a year, a publisher (two words, AND), the original file name, Latin letters in any case.
    for (const [q, expected] of [['김철', [SIGNAL]], ['2023', [FOLD]], ['learn press', [FOLD]], ['h264', [BAYES]], ['BAYES', [BAYES]]] as const) {
      await input(page).fill(q);
      await expect.poll(() => titles(page), q).toEqual(expected);
    }
    await expect(rowByTitle(page, BAYES).locator('mark')).toHaveText('Bayes');
    // Matched in another field only: no mark in the title.
    await input(page).fill('김철');
    await expect.poll(() => titles(page)).toEqual([SIGNAL]);
    await expect(rowByTitle(page, SIGNAL).locator('mark')).toHaveCount(0);
    // The abstract and the memo arrive with the first query; 초성 does not apply to them (ㅈㅍ is 증폭's).
    await input(page).fill('증폭');
    await expect.poll(() => titles(page)).toEqual([SIGNAL]);
    await input(page).fill('시험');
    await expect.poll(() => titles(page)).toEqual([SIGNAL]);
    await input(page).fill('ㅈㅍ');
    await expect(page.getByTestId('search-empty')).toBeVisible();
    // No results: the state in the table body's place, its particle chosen by the last syllable (‘…’과 / ‘…’와).
    await input(page).fill('효소 반응');
    const empty = page.getByTestId('search-empty');
    await expect(empty.locator('.pe-title')).toHaveText('‘효소 반응’과 일치하는 자료가 없습니다');
    await input(page).fill('신호 이영희');
    await expect(empty.locator('.pe-title')).toHaveText('‘신호 이영희’와 일치하는 자료가 없습니다');
    await expect(empty.locator('.pe-text')).toHaveText('제목·저자·태그·출판사·원래 이름·초록·메모에서 찾았습니다.');
    await expect(page.getByTestId('toolbar-count')).toHaveText('0개 / 4개');
    await expect(page.getByTestId('item-row')).toHaveCount(0);
    await expectNoSeriousA11y(page, 'quick search, no results');
    await page.getByTestId('search-empty-clear').click();
    await expect(input(page)).toHaveValue('');
    await expect(input(page)).toBeFocused();
    await expect(page.getByTestId('item-row')).toHaveCount(4);
    await expect(page.getByTestId('toolbar-count')).toHaveText('4개');
  } finally {
    await app.close();
  }
});

test('esc empties the field, then hands the focus to the table; ↓ moves to the first result, selected alone, its mark on the accent', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await library(page);
    await runMenuCommand(app, 'library.find');
    await expect(input(page)).toBeFocused(); // the command reaches the renderer later than the keys would
    await page.keyboard.type('노트');
    await expect(input(page)).toHaveValue('노트');
    await expect.poll(() => titles(page)).toEqual([FOLD]);
    await page.keyboard.press('Escape');
    await expect(input(page)).toHaveValue('');
    await expect(input(page)).toBeFocused();
    await expect(page.getByTestId('item-row')).toHaveCount(4);
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => document.activeElement?.closest('[data-testid="library-table"]') !== null)).toBe(true);
    // ↓ from the field: the first result takes the focus and the selection (as an arrow key selects in the table).
    await runMenuCommand(app, 'library.find');
    await expect(input(page)).toBeFocused(); // the command reaches the renderer later than the keys would
    await page.keyboard.type('광합');
    await expect(input(page)).toHaveValue('광합');
    await expect.poll(() => titles(page)).toEqual([PHOTO]);
    await page.keyboard.press('ArrowDown');
    const row = rowByTitle(page, PHOTO);
    await expect(row).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => page.evaluate(() => document.activeElement?.closest('[data-testid="item-row"]')?.getAttribute('data-title') ?? null)).toBe(PHOTO);
    await expect(input(page)).toHaveValue('광합');
    // On the accent selection the mark is the row's own text colour (the palette's cursor row does the same).
    await expect(row.locator('mark')).toHaveText('광합');
    expect(await row.locator('mark').evaluate((el) => getComputedStyle(el).color)).toBe(await tokenIn(page, '--text-on-accent'));
  } finally {
    await app.close();
  }
});

test('rows the query hides leave the selection; back from the reader the query is still there; a restart starts empty', async ({}, testInfo) => {
  const lib = testInfo.outputPath('library');
  const ud = testInfo.outputPath('userdata');
  let { app, page } = await launch(lib, ud);
  try {
    await library(page);
    await rowByTitle(page, PHOTO).click();
    await expect.poll(() => menuItemEnabled(app, 'item.showInFolder')).toBe(true);
    await runMenuCommand(app, 'library.find');
    await expect(input(page)).toBeFocused(); // the command reaches the renderer later than the keys would
    await page.keyboard.type('신호');
    await expect(input(page)).toHaveValue('신호');
    await expect.poll(() => titles(page)).toEqual([SIGNAL]);
    // The hidden row left the selection: no command acts on a row that is not on screen (spec 3.3).
    await expect.poll(() => menuItemEnabled(app, 'item.showInFolder')).toBe(false);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('item-row')).toHaveCount(4);
    await expect(page.locator('[data-testid="item-row"][aria-selected="true"]')).toHaveCount(0);
    // The query lasts the session: the reader and back keep it.
    await input(page).fill('광합');
    await expect.poll(() => titles(page)).toEqual([PHOTO]);
    await openItem(page, PHOTO);
    await expect(page.getByTestId('video-error')).toBeVisible(); // the unplayable video's notice: the reader is up
    await runMenuCommand(app, 'nav.back');
    await expect(input(page)).toHaveValue('광합');
    await expect.poll(() => titles(page)).toEqual([PHOTO]);
    await app.close();
    // A restart starts with an empty query (spec 4.1).
    ({ app, page } = await launch(lib, ud));
    await expect(page.getByTestId('item-row')).toHaveCount(4);
    await expect(input(page)).toHaveValue('');
  } finally {
    await app.close().catch(() => {});
  }
});

test('a Korean composition filters as it goes; esc, ↓ and ↩ that the IME owns do nothing (isComposing, keyCode 229)', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await library(page);
    await runMenuCommand(app, 'library.find');
    await expect(input(page)).toBeFocused();
    const cdp = await page.context().newCDPSession(page);
    // ㅅ (초성: 세포, 광합성, and 테스트 in an original file name) → 신 → 신ㅎ (the next syllable still composing).
    for (const [stage, rows] of [['ㅅ', 3], ['신', 1], ['신ㅎ', 1]] as const) {
      await cdp.send('Input.imeSetComposition', { text: stage, selectionStart: stage.length, selectionEnd: stage.length });
      await expect.poll(() => page.getByTestId('item-row').count(), stage).toBe(rows);
    }
    await expect(rowByTitle(page, SIGNAL).locator('mark')).toHaveText('신호');
    // Keys the composition owns: the field keeps the focus, nothing in the table is selected.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Escape');
    await expect(input(page)).toBeFocused();
    await expect(page.locator('[data-testid="item-row"][aria-selected="true"]')).toHaveCount(0);
    await cdp.send('Input.insertText', { text: '신호' }); // commits the composition
    await expect(input(page)).toHaveValue('신호');
    await expect.poll(() => titles(page)).toEqual([SIGNAL]);
    // keyCode 229 without isComposing (the macOS IME's confirming keys): esc does not empty, ↓ does not move.
    for (const key of ['Escape', 'ArrowDown', 'Enter'] as const) {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229 });
    }
    await expect(input(page)).toHaveValue('신호');
    await expect(input(page)).toBeFocused();
    // Control: a plain esc does empty it.
    await page.keyboard.press('Escape');
    await expect(input(page)).toHaveValue('');
  } finally {
    await app.close();
  }
});
