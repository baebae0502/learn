// Tags (M5 spec 4, 5.1, 9.2; design-spec 6 태그 칩): the selector at the sidebar's foot, the AND filter, renaming in the chip with
// the merge sheet, colours and the 1–8 keys, the table's dots, the chip menu and the item menu's 색 태그 ▸, and what the filter
// leaves of the table. Native menus are the stubbed popups (stubContextMenu records their rows); the sheets are the stubbed
// message box (stubConfirm). Titles are read by commands-coverage.spec.ts's ledger: change them together.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  FIXTURES, addToCollection, closeSheet, confirmCalls, createCollection, createTag, expectWindow, importPaths, launch, makeTags, menuSnapshot, openItem, organizeSnapshot,
  recordedPopupPoints, recordedPopups, rowByTitle, runMenuCommand, runPalette, setTagColor, stubConfirm, stubContextMenu, tagChip, tokenColor, type MenuNode,
} from './helpers';
import { expectNoSeriousA11y } from './a11y';

const PDF = path.join(FIXTURES, 'sample.pdf');
const KO_PDF = path.join(FIXTURES, '한글 경로 (테스트) #1.pdf');
const MP4 = path.join(FIXTURES, 'sample-h264-aac.mp4');
const KO = '한글 경로 (테스트) #1';
const VIDEO = 'sample-h264-aac';
const dirs = (i: { outputPath(...p: string[]): string }) => [i.outputPath('library'), i.outputPath('userdata')] as const;

test.beforeAll(() => {
  for (const f of [PDF, KO_PDF, MP4]) if (!fs.existsSync(f)) throw new Error(`fixture missing: ${f} — run \`pnpm fixtures\``);
});

/** A library of three items; `id(title)` is an item's id. */
async function start(testInfo: { outputPath(...p: string[]): string }) {
  const s = await launch(...dirs(testInfo));
  const items = await importPaths(s.page, [PDF, KO_PDF, MP4]);
  return { ...s, items, id: (title: string) => items.find((i) => i.title === title)!.id };
}
const chipIds = (page: Page) => page.getByTestId('tag-cloud').locator('[data-chip-id]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset['chipId']));
const rowTitles = async (page: Page) => (await page.getByTestId('item-row').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset['title']!))).sort();
const heldBy = async (page: Page, tagId: string) => (await organizeSnapshot(page)).tagged[tagId] ?? [];
const chooseMenu = async (page: Page, id: 'view' | 'all' | 'name' | 'count') => {
  await page.getByTestId('tag-selector-more').click();
  await page.getByTestId(`tag-menu-${id}`).click();
};
const flat = (nodes: MenuNode[]): MenuNode[] => nodes.flatMap((n) => [n, ...flat(n.submenu ?? [])]);

test('the selector sits at the sidebar foot: absent with no tags, in the reader and in the empty library; at most 40 % of the sidebar with its own scroll', async ({}, testInfo) => {
  const { app, page, id } = await start(testInfo);
  try {
    const selector = page.getByTestId('tag-selector');
    await expect(selector).toHaveCount(0);
    await makeTags(page, [{ name: '수용체', items: [id('sample')] }]);
    await expect(selector).toBeVisible();
    const inner = page.locator('nav.sidebar-inner');
    const [sel, col] = [(await selector.boundingBox())!, (await inner.boundingBox())!];
    expect(Math.abs(sel.y + sel.height - (col.y + col.height)), 'it ends where the sidebar ends').toBeLessThanOrEqual(1);
    await expect(selector.locator('.head')).toHaveText('태그');
    // The reader's sidebar is the way back: nothing to filter there.
    await openItem(page, 'sample');
    await expect(selector).toHaveCount(0);
    await runMenuCommand(app, 'nav.back');
    await expect(selector).toBeVisible();
    // Many tags (모든 태그 shows the ones no item has): capped at 40 %, the chips scroll, the head and the field stay.
    await page.evaluate(async () => {
      for (let i = 0; i < 120; i++) await window.learn.tags.create({ name: `태그 ${String(i).padStart(3, '0')}` });
    });
    await chooseMenu(page, 'all');
    await expect(page.getByTestId('tag-cloud').locator('[data-chip-id]')).toHaveCount(121);
    const tall = (await selector.boundingBox())!;
    const column = (await inner.boundingBox())!;
    expect(tall.height).toBeLessThanOrEqual(column.height * 0.4 + 1);
    expect(tall.height).toBeGreaterThan(column.height * 0.3);
    const cloud = page.getByTestId('tag-cloud');
    expect(await cloud.evaluate((el) => el.scrollHeight > el.clientHeight && getComputedStyle(el).overflowY === 'auto')).toBe(true);
    const field = (await page.getByTestId('tag-filter-field').boundingBox())!;
    expect(field.y + field.height).toBeLessThanOrEqual(tall.y + tall.height);
  } finally {
    await app.close();
  }
  // Tags in a library with no items: the empty library has no selector (spec 3.6).
  const empty = await launch(testInfo.outputPath('library2'), testInfo.outputPath('userdata2'));
  try {
    await createTag(empty.page, '수용체');
    await empty.page.waitForTimeout(400);
    await expect(empty.page.getByTestId('tag-selector')).toHaveCount(0);
  } finally {
    await empty.app.close();
  }
});

test('chips: colour tags first by slot with an 8 px dot, the rest by name; 현재 보기의 태그만 / 모든 태그 (the rest dim) and 이름순 / 많이 쓴 순 from the … menu, remembered', async ({}, testInfo) => {
  const { app, page, id } = await start(testInfo);
  try {
    const bio = await createCollection(page, '분자생물학');
    await addToCollection(page, bio, [id('sample'), id(KO)]);
    const [imp, rng, rec, hah, reg] = await makeTags(page, [
      { name: '중요', slot: 1, items: [id('sample'), id(KO)] },
      { name: '시험 범위', slot: 2, items: [id('sample')] },
      { name: '수용체', items: [id(KO)] },
      { name: '하하', items: [id('sample'), id(KO)] },
      { name: '회귀분석', items: [id(VIDEO)] },
    ]);
    await expect.poll(() => chipIds(page)).toEqual([imp, rng, rec, hah, reg]);
    const dot = tagChip(page, imp).locator('.dot');
    await expect(dot).toHaveCSS('background-color', await tokenColor(page, '--tag-1'));
    expect(await dot.evaluate((e) => [e.getBoundingClientRect().width, e.getBoundingClientRect().height, getComputedStyle(e).borderRadius])).toEqual([8, 8, '50%']);
    await expect(tagChip(page, rec).locator('.dot')).toHaveCount(0);
    const chipBox = (await tagChip(page, rec).locator('xpath=..').boundingBox())!;
    expect(chipBox.height).toBe(22);

    // 분자생물학 has no item of 회귀분석: 현재 보기의 태그만 leaves it out, 모든 태그 shows it dim.
    await page.getByTestId(`nav-collection-${bio}`).click();
    await expect.poll(() => chipIds(page)).toEqual([imp, rng, rec, hah]);
    await page.getByTestId('tag-selector-more').click();
    await expect(page.getByTestId('tag-menu-view')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('tag-menu-name')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('tag-menu-clear')).toHaveCount(0); // only with a filter
    await page.getByTestId('tag-menu-all').click();
    await expect.poll(() => chipIds(page)).toEqual([imp, rng, rec, hah, reg]);
    await expect(tagChip(page, reg)).toHaveAttribute('data-dim', '');
    await expect(tagChip(page, reg)).toHaveAttribute('aria-pressed', 'false');
    await expect(tagChip(page, rec)).not.toHaveAttribute('data-dim', '');
    // 많이 쓴 순: by the items of the view — 하하 (2) before 수용체 (1) before 회귀분석 (0), the colour tags still first.
    await chooseMenu(page, 'count');
    await expect.poll(() => chipIds(page)).toEqual([imp, rng, hah, rec, reg]);
    // Remembered: after a reload the same view, the same menu choices.
    await page.reload();
    await page.getByTestId('app-ready').waitFor({ state: 'attached' });
    await expect.poll(() => chipIds(page)).toEqual([imp, rng, hah, rec, reg]);
    await page.getByTestId('tag-selector-more').click();
    await expect(page.getByTestId('tag-menu-all')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('tag-menu-count')).toHaveAttribute('aria-checked', 'true');
  } finally {
    await app.close();
  }
});

test('filter: chips narrow the table to the items that have every chosen tag, N개 / M개 counts it, Space toggles, the scope clears it, and a filter that leaves nothing says so', async ({}, testInfo) => {
  const { app, page, id } = await start(testInfo);
  try {
    const [f1, f2, f3] = await makeTags(page, [
      { name: '가', items: [id('sample'), id(KO)] },
      { name: '나', items: [id(KO), id(VIDEO)] },
      { name: '다' },
    ]);
    await chooseMenu(page, 'all'); // 다 has no item: shown dim, and it can be chosen
    await expect(tagChip(page, f3)).toBeVisible();
    await tagChip(page, f1).click();
    await expect(tagChip(page, f1)).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => rowTitles(page)).toEqual(['sample', KO].sort());
    await expect(page.getByTestId('toolbar-count')).toHaveText('2개 / 3개');
    await tagChip(page, f2).click(); // AND: both tags
    await expect.poll(() => rowTitles(page)).toEqual([KO]);
    await expect(page.getByTestId('toolbar-count')).toHaveText('1개 / 3개');
    await tagChip(page, f2).focus();
    await page.keyboard.press('Space'); // the keyboard toggles it back
    await expect(tagChip(page, f2)).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => rowTitles(page)).toEqual(['sample', KO].sort());
    // 태그 선택 해제 in the … menu, only now that a filter is set.
    await page.getByTestId('tag-selector-more').click();
    await expect(page.getByTestId('tag-menu-clear')).toBeVisible();
    await page.getByTestId('tag-menu-clear').click();
    await expect(tagChip(page, f1)).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => rowTitles(page)).toHaveLength(3);

    // A filter that leaves nothing (다 is on no item): the table body says so; its button clears the filter and the focus goes to the chips.
    await tagChip(page, f3).click();
    await expect(page.getByTestId('tag-filter-empty')).toBeVisible();
    await expect(page.getByTestId('tag-filter-empty')).toContainText('고른 태그를 모두 가진 자료가 없습니다');
    await expect(page.getByTestId('search-empty')).toHaveCount(0);
    await page.getByTestId('tag-filter-empty-clear').click();
    await expect(page.getByTestId('tag-filter-empty')).toHaveCount(0);
    await expect(tagChip(page, f3)).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => page.evaluate(() => document.activeElement?.hasAttribute('data-chip-id'))).toBe(true);
    // A query beside it: the search's own empty state wins (spec 3.6).
    await tagChip(page, f3).click();
    await runMenuCommand(app, 'library.find');
    await page.getByTestId('search-field').locator('input').fill('sample');
    await expect(page.getByTestId('search-empty')).toBeVisible();
    await expect(page.getByTestId('tag-filter-empty')).toHaveCount(0);
    await page.getByTestId('search-field').locator('input').fill('');

    // The palette's 태그 선택 해제; and another view starts with no filter (spec 3.5).
    await runPalette(page, app, '태그 선택 해제', 'tags.clearFilter');
    await expect(tagChip(page, f3)).toHaveAttribute('aria-pressed', 'false');
    const c = await createCollection(page, '묶음');
    await addToCollection(page, c, [id('sample')]);
    await tagChip(page, f1).click();
    await page.getByTestId(`nav-collection-${c}`).click();
    await expect(tagChip(page, f1)).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => rowTitles(page)).toEqual(['sample']);
  } finally {
    await app.close();
  }
});

test('the 태그 필터 field narrows the chips by NFC, case and 초성, esc empties it, the table is untouched, and a composition is not cut by esc', async ({}, testInfo) => {
  const { app, page, id } = await start(testInfo);
  try {
    const all = [id('sample')];
    const [exam, recept, reg] = await makeTags(page, [
      { name: '시험 범위', slot: 1, items: all },
      { name: 'Receptor', items: all },
      { name: '회귀분석', items: all },
    ]);
    const field = page.getByTestId('tag-filter-field').locator('input');
    await field.fill('ㅅㅎ');
    await expect.poll(() => chipIds(page)).toEqual([exam]);
    await field.fill('recep');
    await expect.poll(() => chipIds(page)).toEqual([recept]);
    await field.fill('ㅎㄱ');
    await expect.poll(() => chipIds(page)).toEqual([reg]);
    await field.fill('없는 태그');
    await expect(page.getByTestId('tag-none')).toHaveText('일치하는 태그가 없습니다');
    await expect(page.getByTestId('item-row')).toHaveCount(3); // rows are never filtered by this field
    await field.press('Escape');
    await expect(field).toHaveValue('');
    await expect.poll(() => chipIds(page)).toEqual([exam, reg, recept]); // Hangul before Latin, as the Korean collator has it
    // IME: the chips follow the composition; esc during it neither empties the field nor ends the composition.
    const cdp = await page.context().newCDPSession(page);
    await field.focus();
    await cdp.send('Input.imeSetComposition', { text: 'ㅅㅎ', selectionStart: 2, selectionEnd: 2 });
    await expect.poll(() => chipIds(page)).toEqual([exam]);
    await page.keyboard.press('Escape');
    await expect.poll(() => chipIds(page)).toEqual([exam]);
    await cdp.send('Input.insertText', { text: 'ㅅㅎ' });
    await expect(field).toHaveValue('ㅅㅎ');
  } finally {
    await app.close();
  }
});

test('keyboard: the chips are one Tab stop, ←→ Home End move it, Space toggles, ↩ renames and gives the focus back, ⇧F10 opens the tag menu under the chip', async ({}, testInfo) => {
  const { app, page, id } = await start(testInfo);
  try {
    const items = [id('sample')];
    const [a, b, c] = await makeTags(page, [
      { name: '가', slot: 1, items },
      { name: '나', items },
      { name: '다', items },
    ]);
    const focusedChip = () => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset['chipId'] ?? null);
    const stops = () => page.locator('[data-testid="tag-selector"] [data-chip-id][tabindex="0"]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset['chipId']));
    expect(await stops()).toEqual([a]); // one stop, the first until the user has been elsewhere
    await page.getByTestId('tag-selector-more').focus();
    await page.keyboard.press('Tab');
    expect(await focusedChip()).toBe(a);
    await page.keyboard.press('ArrowRight');
    expect(await focusedChip()).toBe(b);
    expect(await stops()).toEqual([b]);
    await page.keyboard.press('End');
    expect(await focusedChip()).toBe(c);
    await page.keyboard.press('ArrowRight'); // at the end it stays
    expect(await focusedChip()).toBe(c);
    await page.keyboard.press('Home');
    expect(await focusedChip()).toBe(a);
    await page.keyboard.press('End');
    await page.keyboard.press('Tab'); // out of the group: the filter field
    await expect(page.getByTestId('tag-filter-field').locator('input')).toBeFocused();
    await page.keyboard.press('Shift+Tab'); // back to the chip the user left
    expect(await focusedChip()).toBe(c);

    await page.keyboard.press('Space');
    await expect(tagChip(page, c)).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Space');
    await expect(tagChip(page, c)).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('Enter'); // rename, not press
    await expect(tagChip(page, c)).toHaveCount(0);
    await expect(page.getByTestId('tag-rename-input')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(tagChip(page, c)).toBeFocused();
    await expect(tagChip(page, c)).toHaveAttribute('aria-pressed', 'false');

    // ⇧F10: the native menu under the chip, once.
    await stubContextMenu(app, null);
    await page.keyboard.press('Shift+F10');
    await expect.poll(async () => (await recordedPopups(app)).length).toBe(1);
    const box = (await tagChip(page, c).boundingBox())!;
    const [at] = await recordedPopupPoints(app);
    expect(at!.x).toBeGreaterThanOrEqual(box.x);
    expect(at!.x).toBeLessThanOrEqual(box.x + box.width);
    expect(Math.abs(at!.y - (box.y + box.height))).toBeLessThanOrEqual(3);
    await page.waitForTimeout(700); // the browser's own contextmenu for the key does not open it a second time
    expect((await recordedPopups(app)).length).toBe(1);
    const labels = (await recordedPopups(app))[0]!.map((e) => (e.type === 'separator' ? '-' : e.label));
    expect(labels).toEqual(['이름 바꾸기', '색 지정', '색 해제', '-', '태그 삭제…']);
  } finally {
    await app.close();
  }
});

test('rename in the chip: ↩ saves, esc cancels, blank keeps, 200 characters stop, a click elsewhere saves, a composition is not cut; a name another tag has asks to merge', async ({}, testInfo) => {
  const { app, page, id } = await start(testInfo);
  try {
    const [alpha, beta] = await makeTags(page, [
      { name: 'Alpha', items: [id('sample')] },
      { name: 'beta', items: [id(KO)] },
    ]);
    const input = page.getByTestId('tag-rename-input');
    await tagChip(page, beta).focus();
    await page.keyboard.press('Enter');
    await expect(input).toBeFocused();
    expect(await input.evaluate((e: HTMLInputElement) => [e.selectionStart, e.selectionEnd, e.value.length])).toEqual([0, 4, 4]); // the whole name selected
    await input.fill('gamma');
    await page.keyboard.press('Enter');
    await expect(tagChip(page, beta)).toContainText('gamma');
    await expect(tagChip(page, beta)).toBeFocused();
    expect((await organizeSnapshot(page)).tags.find((t) => t.id === beta)?.name).toBe('gamma');

    await page.keyboard.press('Enter');
    await input.fill('zzz');
    await page.keyboard.press('Escape'); // cancel
    await expect(tagChip(page, beta)).toContainText('gamma');
    await page.keyboard.press('Enter');
    await input.fill('   ');
    await page.keyboard.press('Enter'); // blank: the old name, no error
    await expect(tagChip(page, beta)).toContainText('gamma');
    await expect(page.getByTestId('action-error')).toHaveCount(0);

    await page.keyboard.press('Enter');
    await input.fill('가'.repeat(201));
    await page.keyboard.press('Enter');
    await expect(input).toBeVisible(); // stays open
    await expect(page.getByTestId('tag-rename-note')).toHaveText('태그 이름은 200자까지 쓸 수 있습니다.');
    await page.keyboard.press('Escape');

    await page.keyboard.press('Enter');
    await input.fill('delta');
    await page.getByTestId('library-table').click({ position: { x: 20, y: 200 } }); // a click elsewhere saves
    await expect(tagChip(page, beta)).toContainText('delta');

    // IME: ↩ during a composition only ends it; after the commit ↩ saves.
    await tagChip(page, beta).focus();
    await page.keyboard.press('Enter');
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.imeSetComposition', { text: '새', selectionStart: 1, selectionEnd: 1 });
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await expect(input).toBeVisible();
    await cdp.send('Input.insertText', { text: '새 이름' });
    await expect(input).toHaveValue('새 이름');
    await page.keyboard.press('Enter');
    await expect(tagChip(page, beta)).toContainText('새 이름');

    // A name another tag has (case ignored): the sheet, 합치기 by default. Cancel changes nothing.
    await stubConfirm(app, 'cancel');
    await page.getByTestId('tag-selector').getByTestId(`tag-chip-${beta}`).focus();
    await page.keyboard.press('Enter');
    await input.fill(' ALPHA ');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await confirmCalls(app)).length).toBe(1);
    expect((await confirmCalls(app))[0]).toMatchObject({ message: '‘Alpha’ 태그가 이미 있습니다. 두 태그를 합치겠습니까?', buttons: ['합치기', '취소'], defaultId: 0 });
    expect((await confirmCalls(app))[0]!.detail).toContain('‘새 이름’ 태그의 자료는 ‘Alpha’');
    await expect(tagChip(page, beta)).toContainText('새 이름');
    expect((await organizeSnapshot(page)).tags.map((t) => t.id)).toContain(beta);

    // Confirm: the filter on the merged tag moves to the one that remains, and the items of both are on it.
    await tagChip(page, beta).click();
    await expect.poll(() => rowTitles(page)).toEqual([KO]);
    await stubConfirm(app, 'confirm');
    await tagChip(page, beta).focus();
    await page.keyboard.press('Enter');
    await input.fill('ALPHA');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId(`tag-chip-${beta}`)).toHaveCount(0);
    await expect(tagChip(page, alpha)).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => rowTitles(page)).toEqual(['sample', KO].sort());
    expect((await heldBy(page, alpha)).sort()).toEqual([id('sample'), id(KO)].sort());
    expect((await organizeSnapshot(page)).tags.map((t) => t.name)).toEqual(['Alpha']);
  } finally {
    await app.close();
  }
});

test('colour: 색 지정 sets colour N = slot N, the tag that held the slot loses both, 색 해제 clears; the menu names the slot another tag holds and checks the colour', async ({}, testInfo) => {
  const { app, page, id } = await start(testInfo);
  try {
    const items = [id('sample')];
    const [important, review, question] = await makeTags(page, [
      { name: '중요', slot: 1, items },
      { name: '복습', items },
      { name: '질문', items },
    ]);
    const rowsOf = async () => (await recordedPopups(app)).at(-1)!;
    await stubContextMenu(app, ['색 지정', '1 노랑 — 중요']);
    await tagChip(page, review).click({ button: 'right' });
    await expect.poll(async () => (await organizeSnapshot(page)).tags.find((t) => t.id === review)?.position).toBe(1);
    const menu = await rowsOf();
    expect(menu.map((e) => (e.type === 'separator' ? '-' : e.label))).toEqual(['이름 바꾸기', '색 지정', '색 해제', '-', '태그 삭제…']);
    expect(menu.find((e) => e.label === '색 해제')).toMatchObject({ enabled: false }); // 복습 had no colour
    const colours = menu.find((e) => e.label === '색 지정')!.submenu!;
    expect(colours.map((e) => e.label)).toEqual(['1 노랑 — 중요', '2 빨강', '3 초록', '4 파랑', '5 보라', '6 자홍', '7 주황', '8 회색']);
    expect(colours.every((e) => e.type === 'radio' && !e.checked)).toBe(true);
    const snap = (await organizeSnapshot(page)).tags;
    expect(snap.find((t) => t.id === review)).toMatchObject({ color: 'yellow', position: 1 });
    expect(snap.find((t) => t.id === important)).toMatchObject({ color: null, position: null }); // one call took both away
    await expect(tagChip(page, important).locator('.dot')).toHaveCount(0);
    await expect(tagChip(page, review).locator('.dot')).toHaveCSS('background-color', await tokenColor(page, '--tag-1'));
    await expect.poll(() => chipIds(page)).toEqual([review, important, question]); // the colour tag leads

    // The same menu for the tag that holds the slot: its own colour is checked, 색 해제 is on; then clear it.
    await stubContextMenu(app, '색 해제');
    await tagChip(page, review).click({ button: 'right' });
    const own = await rowsOf();
    expect(own.find((e) => e.label === '색 해제')).toMatchObject({ enabled: true });
    expect(own.find((e) => e.label === '색 지정')!.submenu!.filter((e) => e.checked).map((e) => e.label)).toEqual(['1 노랑']);
    await expect.poll(async () => (await organizeSnapshot(page)).tags.find((t) => t.id === review)).toMatchObject({ color: null, position: null });
    await expect(tagChip(page, review).locator('.dot')).toHaveCount(0);
    // 3 초록 on 질문, with the menu bar following (파일 › 색 태그 ▸ lists the tag at the slot).
    await stubContextMenu(app, ['색 지정', '3 초록']);
    await tagChip(page, question).click({ button: 'right' });
    await expect.poll(async () => (await organizeSnapshot(page)).tags.find((t) => t.id === question)?.position).toBe(3);
    await rowByTitle(page, 'sample').click();
    await expect
      .poll(async () => flat(await menuSnapshot(app)).find((n) => n.id === 'submenu.colorTags')?.submenu?.map((n) => n.label))
      .toEqual(['질문']);
  } finally {
    await app.close();
  }
});

test('delete: the sheet says how many items the tag comes off, cancel keeps it, confirm removes it from the chips, the table and the filter', async ({}, testInfo) => {
  const { app, page, id } = await start(testInfo);
  try {
    const [important, review] = await makeTags(page, [
      { name: '중요', slot: 1, items: [id('sample'), id(KO)] },
      { name: '복습' },
    ]);
    await expect(rowByTitle(page, 'sample').locator('.tag-dots i')).toHaveCount(1);
    await tagChip(page, important).click(); // the filter holds it
    await expect.poll(() => rowTitles(page)).toEqual(['sample', KO].sort());
    await stubConfirm(app, 'cancel');
    await stubContextMenu(app, '태그 삭제…');
    await tagChip(page, important).click({ button: 'right' });
    await expect.poll(async () => (await confirmCalls(app)).length).toBe(1);
    expect((await confirmCalls(app))[0]).toMatchObject({ message: '‘중요’ 태그를 삭제하겠습니까?', detail: '자료 2개에서 떼어집니다.', buttons: ['삭제', '취소'], defaultId: 0 });
    await expect(tagChip(page, important)).toBeVisible();
    await stubConfirm(app, 'confirm');
    await tagChip(page, important).click({ button: 'right' });
    await expect(page.getByTestId(`tag-chip-${important}`)).toHaveCount(0);
    expect((await confirmCalls(app))[0]!.message).toBe('‘중요’ 태그를 삭제하겠습니까?');
    expect((await organizeSnapshot(page)).tags.map((t) => t.id)).not.toContain(important);
    await expect(rowByTitle(page, 'sample').locator('.tag-dots')).toHaveCount(0);
    await expect.poll(() => rowTitles(page)).toHaveLength(3); // the deleted tag left the filter: the table is whole again
    await expect(page.getByTestId('tag-filter-empty')).toHaveCount(0);
    // A tag on no item: the sheet says so.
    await chooseMenu(page, 'all');
    await tagChip(page, review).click({ button: 'right' });
    await expect.poll(async () => (await confirmCalls(app)).length).toBe(2);
    expect((await confirmCalls(app))[1]!.detail).toBe('붙어 있는 자료가 없습니다.');
  } finally {
    await app.close();
  }
});

test('1–8 keys put the tag at that slot on the selection or take it off, tell an empty slot, and are ignored in text fields and while composing; the palette and the ⌘/ sheet show them', async ({}, testInfo) => {
  const { app, page, id } = await start(testInfo);
  try {
    const tags = await makeTags(page, [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ name: `태그${n}`, slot: n })));
    await rowByTitle(page, 'sample').click();
    // Each of the eight keys, on the one selected item: on with the key, off with the same key again.
    for (let n = 1; n <= 8; n++) {
      await page.keyboard.press(String(n));
      await expect.poll(() => heldBy(page, tags[n - 1]!)).toEqual([id('sample')]);
    }
    await page.keyboard.press('1');
    await expect.poll(() => heldBy(page, tags[0]!)).toEqual([]);
    await page.keyboard.press('1');
    await expect.poll(() => heldBy(page, tags[0]!)).toEqual([id('sample')]);

    // Several rows: not every row has the tag → all get it; then every row has it → all lose it.
    await rowByTitle(page, 'sample').click();
    await page.keyboard.press('ControlOrMeta+A');
    await expect(page.locator('[data-testid="item-row"][aria-selected="true"]')).toHaveCount(3);
    await page.keyboard.press('1');
    await expect.poll(async () => (await heldBy(page, tags[0]!)).sort()).toEqual([id('sample'), id(KO), id(VIDEO)].sort());
    await page.keyboard.press('1');
    await expect.poll(() => heldBy(page, tags[0]!)).toEqual([]);

    // An empty slot says so (이 / 가 by how the digit is read) and changes nothing.
    await rowByTitle(page, 'sample').click();
    await page.keyboard.press('1');
    await expect.poll(() => heldBy(page, tags[0]!)).toEqual([id('sample')]);
    await setTagColor(page, tags[0]!, null, null);
    await expect(tagChip(page, tags[0]!).locator('.dot')).toHaveCount(0);
    await page.keyboard.press('1');
    await expect(page.getByTestId('tag-notice').last()).toHaveText('색 태그 1이 없습니다. 태그의 컨텍스트 메뉴에서 색을 지정하세요.');
    expect(await heldBy(page, tags[0]!)).toEqual([id('sample')]);
    await setTagColor(page, tags[4]!, null, null);
    await expect(tagChip(page, tags[4]!).locator('.dot')).toHaveCount(0);
    await page.keyboard.press('5');
    await expect(page.getByTestId('tag-notice').last()).toHaveText('색 태그 5가 없습니다. 태그의 컨텍스트 메뉴에서 색을 지정하세요.');

    // Never in a text field, and never while a composition owns the key (keyCode 229 included).
    const before = await heldBy(page, tags[1]!);
    await runMenuCommand(app, 'library.find');
    const search = page.getByTestId('search-field').locator('input');
    await expect(search).toBeFocused();
    await page.keyboard.type('2');
    await expect(search).toHaveValue('2');
    await search.fill('');
    await page.getByTestId('tag-filter-field').locator('input').focus();
    await page.keyboard.type('2');
    await page.getByTestId('tag-filter-field').locator('input').fill('');
    await rowByTitle(page, 'sample').click();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: '2', code: 'Digit2', windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: '2', code: 'Digit2', windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229 });
    await page.waitForTimeout(300);
    expect(await heldBy(page, tags[1]!)).toEqual(before);

    // The palette: one row per slot a tag holds, named by the tag; it acts on the selection.
    await runMenuCommand(app, 'app.palette');
    await page.getByTestId('palette-input').fill('색 태그');
    const keyRows = page.locator('[data-testid="palette-item"][data-command-id^="tag.color"]');
    await expect(keyRows).toHaveCount(6); // slots 1 and 5 were cleared: six tags hold a slot
    await expect(page.locator('[data-testid="palette-item"][data-command-id="tag.color3"]')).toContainText('색 태그 3 · 태그3');
    await expect(page.locator('[data-testid="palette-item"][data-command-id="tag.color1"]')).toHaveCount(0);
    await page.locator('[data-testid="palette-item"][data-command-id="tag.color2"]').click();
    await expect.poll(() => heldBy(page, tags[1]!)).toEqual([]); // it was on 'sample' (key 2 above): the palette row took it off

    // The ⌘/ sheet: one line, 1–8, under 정리; the registry's eight are not listed apart.
    const sheet = await expectWindow(app, 'sheet', () => runMenuCommand(app, 'app.shortcuts'));
    const line = sheet.getByTestId('shortcut-row').filter({ hasText: '색 태그 붙이기/떼기' });
    await expect(line).toHaveCount(1);
    await expect(line).toContainText('1–8');
    await expect(sheet.getByTestId('shortcut-row').filter({ hasText: /색 태그 \d/ })).toHaveCount(0);
    await expect(sheet.locator('.group-label', { hasText: '정리' })).toHaveCount(1);
    await closeSheet(sheet, 'Escape');

    // The menu bar's 색 태그 ▸ lists the held slots by name (the digit is shown, not registered).
    await rowByTitle(page, 'sample').click();
    await expect
      .poll(async () => flat(await menuSnapshot(app)).find((n) => n.id === 'submenu.colorTags')?.submenu?.map((n) => n.label))
      .toEqual(['태그2', '태그3', '태그4', '태그6', '태그7', '태그8']);
    await runMenuCommand(app, 'tag.color3');
    await expect.poll(async () => (await heldBy(page, tags[2]!)).includes(id('sample'))).toBe(false);
  } finally {
    await app.close();
  }
});

test('table dots: the coloured tags only, by slot, after the title and the link mark; a white ring on the accent row; the row\'s description names them', async ({}, testInfo) => {
  const { app, page, id } = await start(testInfo);
  try {
    const linkedFile = testInfo.outputPath('linked.pdf');
    fs.copyFileSync(PDF, linkedFile);
    const linked = await page.evaluate((p) => window.learn.library.import({ paths: [p], mode: 'linked', allowDuplicate: true }), linkedFile);
    if (!linked.ok || linked.data[0]?.status !== 'imported') throw new Error('linked import failed');
    const both = [id('sample'), linked.data[0].item.id];
    const [important, exam] = await makeTags(page, [
      { name: '중요', slot: 3, items: both },
      { name: '시험 범위', slot: 1, items: both },
      { name: '복습', items: both },
    ]);
    const row = rowByTitle(page, 'sample');
    const dots = row.locator('.tag-dots i');
    await expect(dots).toHaveCount(2); // 복습 has no colour: no dot
    expect(await dots.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset['position']))).toEqual(['1', '3']);
    await expect(dots.nth(0)).toHaveCSS('background-color', await tokenColor(page, '--tag-1'));
    await expect(dots.nth(1)).toHaveCSS('background-color', await tokenColor(page, '--tag-3'));
    expect(await dots.first().evaluate((e) => [e.getBoundingClientRect().width, e.getBoundingClientRect().height])).toEqual([8, 8]);

    // The mockup's order: title, link mark, dots, then the 파일 없음 flag.
    const order = await rowByTitle(page, 'linked').evaluate((r) => {
      const cell = r.querySelector('[data-col="title"]')!;
      const follows = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      return [follows(cell.querySelector('.item-title')!, cell.querySelector('.linked-mark')!), follows(cell.querySelector('.linked-mark')!, cell.querySelector('.tag-dots')!)];
    });
    expect(order).toEqual([true, true]);

    // The inner 0.5 px border on a plain row; a 1 px white ring on the row with the accent fill.
    expect(await dots.first().evaluate((e) => getComputedStyle(e).boxShadow)).toContain('inset');
    await row.click();
    await expect(row).toHaveAttribute('aria-selected', 'true');
    const ring = await dots.first().evaluate((e) => getComputedStyle(e).boxShadow);
    expect(ring).not.toContain('inset');
    expect(ring).toContain(await tokenColor(page, '--text-on-accent'));

    // The names are the row's description, and not part of its name.
    const described = await row.getAttribute('aria-describedby');
    expect(described).toBeTruthy();
    expect(await page.locator(`[id="${described}"]`).textContent()).toBe('태그: 시험 범위, 중요');
    await expect(row.locator('[role="rowheader"]')).not.toContainText('태그');
    await expect(rowByTitle(page, 'linked').locator('.tag-dots i')).toHaveCount(2);

    // Taking the colour away takes the dot away; the tag stays on the item (the description goes with the dot).
    await setTagColor(page, exam, null, null);
    await expect(dots).toHaveCount(1);
    await setTagColor(page, important, null, null);
    await expect(row.locator('.tag-dots')).toHaveCount(0);
    expect(await row.getAttribute('aria-describedby')).toBeNull();
  } finally {
    await app.close();
  }
});

test('the item menu lists 색 태그 ▸ by slot, checks the tags every selected item has, and the pick toggles it', async ({}, testInfo) => {
  const { app, page, id } = await start(testInfo);
  try {
    const [important] = await makeTags(page, [
      { name: '중요', slot: 1 },
      { name: '질문', slot: 2, items: [id('sample')] },
    ]);
    await stubContextMenu(app, ['색 태그', '중요']);
    await rowByTitle(page, 'sample').click({ button: 'right' }); // a right click selects the row first
    await expect.poll(() => heldBy(page, important)).toEqual([id('sample')]);
    const group = (await recordedPopups(app)).at(-1)!.find((e) => e.label === '색 태그')!;
    expect(group.submenu!.map((e) => [e.label, e.checked])).toEqual([['중요', false], ['질문', true]]);
    // Now every selected item has 중요: it is checked, and picking it takes it off.
    await rowByTitle(page, 'sample').click({ button: 'right' });
    await expect.poll(() => heldBy(page, important)).toEqual([]);
    const again = (await recordedPopups(app)).at(-1)!.find((e) => e.label === '색 태그')!;
    expect(again.submenu!.map((e) => [e.label, e.checked])).toEqual([['중요', true], ['질문', true]]);
  } finally {
    await app.close();
  }
});

test('axe: the tag selector, its menu open and a chip being renamed, light and dark', async ({}, testInfo) => {
  const { app, page, id } = await start(testInfo);
  try {
    const [first] = await makeTags(page, [
      { name: '중요', slot: 1, items: [id('sample')] },
      { name: '수용체', items: [id('sample')] },
      { name: '회귀분석', items: [id(VIDEO)] },
    ]);
    await chooseMenu(page, 'all'); // a dim chip too
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate((t) => window.learn.prefs.set({ theme: t }), theme);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expectNoSeriousA11y(page, `tag selector, ${theme}`);
      await page.getByTestId('tag-selector-more').click();
      await expect(page.getByTestId('tag-menu-all')).toBeVisible();
      await expectNoSeriousA11y(page, `tag selector menu, ${theme}`);
      await page.keyboard.press('Escape');
      await tagChip(page, first!).focus();
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('tag-rename-input')).toBeFocused();
      await expectNoSeriousA11y(page, `tag chip being renamed, ${theme}`);
      await page.keyboard.press('Escape');
    }
  } finally {
    await app.close();
  }
});
