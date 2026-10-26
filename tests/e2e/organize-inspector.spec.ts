// The item panel's 태그 and 컬렉션 sections, what several items have in common, 컬렉션에 추가 ▾ / ▸ and 이 컬렉션에서 빼기
// (M5 Task 7). Data is made through the page's API (helpers); every behaviour under test goes through the screen, the
// item menu (stubbed in main: the rows it recorded, and the click on the one a path names) or the menu bar's own items.
import path from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { expectNoSeriousA11y } from './a11y';
import {
  FIXTURES, addToCollection, assignTag, createCollection, createTag, distinctPdfs, importPaths, ipcCalls, launch, menuItemEnabled, menuSnapshot, organizeSnapshot,
  quietLibraryCalls, recordedPopups, removeChip, rowAt, rowByTitle, runMenuCommand, seedLibrary, selectRows, setTagColor, showItemPanel, specialRow, stubContextMenu, treeRow,
  type MenuNode, type PopupItem,
} from './helpers';

const PDF = path.join(FIXTURES, 'sample.pdf');
const KO_PDF = path.join(FIXTURES, '한글 경로 (테스트) #1.pdf');
const MP4 = path.join(FIXTURES, 'sample-h264-aac.mp4');
const MPEG4 = path.join(FIXTURES, 'sample-mpeg4part2.mp4');
const KO = '한글 경로 (테스트) #1';
const H264 = 'sample-h264-aac';
const NEW = '새 컬렉션';
const REMOVE = '이 컬렉션에서 빼기';
const REVEAL = process.platform === 'darwin' ? 'Finder에서 보기' : '폴더에서 보기';
const dirs = (i: { outputPath(...p: string[]): string }) => [i.outputPath('library'), i.outputPath('userdata')] as const;

const tagsSection = (page: Page) => page.getByTestId('tags-section');
const chipOf = (page: Page, tagId: string) => tagsSection(page).getByTestId(`tag-chip-${tagId}`);
/** The tag ids of the chips in the section, in the order drawn (the × inside a chip is not a chip). */
const chipIds = (page: Page) =>
  tagsSection(page)
    .locator('[data-testid^="tag-chip-"]:not([data-testid="tag-chip-remove"])')
    .evaluateAll((els) => els.map((e) => (e.getAttribute('data-testid') ?? '').slice('tag-chip-'.length)));
const pathRowsOf = (page: Page) => page.getByTestId('collections-section').getByTestId('collection-path');
const sorted = (xs: readonly string[] | undefined) => [...(xs ?? [])].sort();
const membersOf = async (page: Page, collectionId: string) => sorted((await organizeSnapshot(page)).members[collectionId]);
const taggedOf = async (page: Page, tagId: string) => sorted((await organizeSnapshot(page)).tagged[tagId]);
/** The id of the tag with this name once main has it (the screen made it a moment ago). */
async function tagIdByName(page: Page, name: string): Promise<string> {
  let id = '';
  await expect.poll(async () => (id = (await organizeSnapshot(page)).tags.find((x) => x.name === name)?.id ?? '')).not.toBe('');
  return id;
}
async function collectionIdByName(page: Page, name: string): Promise<string> {
  let id = '';
  await expect.poll(async () => (id = (await organizeSnapshot(page)).collections.find((x) => x.name === name)?.id ?? '')).not.toBe('');
  return id;
}
const detailOf = (page: Page, itemId: string) =>
  page.evaluate(async (id) => {
    const r = await window.learn.library.detail({ itemId: id });
    if (!r.ok) throw new Error(`library.detail failed: ${r.code}`);
    return r.data;
  }, itemId);
/** What the E2E counter says main ran for the channels a membership or tag change would call. */
const changeCalls = async (app: ElectronApplication) => Object.fromEntries(Object.entries(await ipcCalls(app)).filter(([k]) => /^(library|collections|tags):/.test(k)));
/** A recorded popup's rows as "label ✓ ✗" (✓ checked, ✗ disabled) with '-' for a separator. */
const rowsOf = (items: readonly PopupItem[]) => items.map((i) => (i.type === 'separator' ? '-' : `${i.label}${i.checked ? ' ✓' : ''}${i.enabled ? '' : ' ✗'}`));
const flatten = (nodes: readonly MenuNode[]): MenuNode[] => nodes.flatMap((n) => [n, ...flatten(n.submenu ?? [])]);

test('tag add: the field offers up to eight existing tags the item lacks, ↑↓ choose, ↩ attaches the chosen one or creates the typed name, the field stays open, esc closes it', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    const [pdf] = await importPaths(page, [PDF]);
    const ids: string[] = [];
    for (let n = 1; n <= 10; n++) ids.push(await createTag(page, `효소 ${n}`));
    await assignTag(page, ids[1]!, [pdf!.id]); // 효소 2 is on the item already
    await showItemPanel(app, page);
    await rowByTitle(page, 'sample').click();
    await expect(chipOf(page, ids[1]!)).toBeVisible();

    await page.getByTestId('tag-add-chip').click();
    const input = page.getByTestId('tag-input');
    await expect(input).toBeFocused();
    await expect(page.getByTestId('tag-suggestions')).toHaveCount(0); // nothing typed, nothing offered
    await input.fill('효소');
    const options = page.getByTestId('tag-suggestion');
    await expect(options).toHaveCount(8);
    // Numbers by value, 효소 2 (on the item) left out, never more than eight of the nine that fit.
    expect(await options.evaluateAll((els) => els.map((e) => e.getAttribute('data-tag-id')))).toEqual([0, 2, 3, 4, 5, 6, 7, 8].map((i) => ids[i]));

    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(options.nth(1)).toHaveAttribute('data-active', '');
    await expect(input).toHaveAttribute('aria-activedescendant', (await options.nth(1).getAttribute('id'))!);
    await page.keyboard.press('Enter');
    await expect(chipOf(page, ids[2]!)).toBeVisible(); // 효소 3, the second suggestion
    await expect.poll(() => taggedOf(page, ids[2]!)).toEqual([pdf!.id]);
    await expect(input).toBeFocused(); // open for the next tag
    await expect(input).toHaveValue('');
    await expect(page.getByTestId('tag-suggestions')).toHaveCount(0);

    // A typed name that is no tag yet is created and attached; the hint says so before ↩.
    await input.fill('새 개념');
    await expect(page.getByTestId('tag-hint')).toHaveText('↩ 새 태그 ‘새 개념’ 만들기');
    await page.keyboard.press('Enter');
    const made = await tagIdByName(page, '새 개념');
    await expect(chipOf(page, made)).toBeVisible();
    await expect.poll(() => taggedOf(page, made)).toEqual([pdf!.id]);

    // A typed name that is a tag: tags.create answers that tag, so no second one is made and the chip is not doubled.
    const before = (await organizeSnapshot(page)).tags.length;
    await input.fill('효소 3');
    await expect(page.getByTestId('tag-hint')).toHaveCount(0);
    await page.keyboard.press('Enter');
    await expect(input).toHaveValue('');
    expect((await organizeSnapshot(page)).tags).toHaveLength(before);
    expect((await chipIds(page)).filter((id) => id === ids[2])).toHaveLength(1);

    // ⌫ in the empty field removes nothing.
    const chips = await chipIds(page);
    await page.keyboard.press('Backspace');
    expect(await chipIds(page)).toEqual(chips);
    await expect(page.getByTestId('tag-field')).toBeVisible();

    // esc closes it and the focus goes back to the chip that opened it.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('tag-field')).toHaveCount(0);
    await expect(page.getByTestId('tag-add-chip')).toBeFocused();
  } finally {
    await app.close();
  }
});

test('tag add: the plus beside 태그 opens the same field; a click on a suggestion attaches it and the field keeps the focus; too long a name is refused with its reason', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    const [pdf] = await importPaths(page, [PDF]);
    const receptor = await createTag(page, '수용체');
    await showItemPanel(app, page);
    await rowByTitle(page, 'sample').click();
    await page.getByTestId('tags-add').click();
    const input = page.getByTestId('tag-input');
    await expect(input).toBeFocused();
    await input.fill('ㅅㅇㅊ'); // by its initials
    await page.getByTestId('tag-suggestion').click();
    await expect(chipOf(page, receptor)).toBeVisible();
    await expect.poll(() => taggedOf(page, receptor)).toEqual([pdf!.id]);
    await expect(input).toBeFocused();
    const before = (await organizeSnapshot(page)).tags.length;
    await input.fill('가'.repeat(201));
    await expect(page.getByTestId('tag-error')).toHaveText('태그 이름은 200자까지 쓸 수 있습니다.');
    await page.keyboard.press('Enter');
    expect((await organizeSnapshot(page)).tags).toHaveLength(before); // nothing was created
    await expect(page.getByTestId('tag-field')).toBeVisible();
  } finally {
    await app.close();
  }
});

test('chips: coloured slots first by slot, then by name; × and ⌫ take a tag off and the focus goes to a neighbour, then to the add chip', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    const [pdf] = await importPaths(page, [PDF]);
    const plainB = await createTag(page, 'B 일반');
    const plainA = await createTag(page, 'A 일반');
    const red = await createTag(page, 'Z 빨강');
    const yellow = await createTag(page, 'Y 노랑');
    await setTagColor(page, red, 'red', 2);
    await setTagColor(page, yellow, 'yellow', 1);
    for (const id of [plainB, plainA, red, yellow]) await assignTag(page, id, [pdf!.id]);
    await showItemPanel(app, page);
    await rowByTitle(page, 'sample').click();
    await expect.poll(() => chipIds(page)).toEqual([yellow, red, plainA, plainB]);

    const focusedChip = () => page.evaluate(() => document.activeElement?.closest('[data-testid^="tag-chip-"]')?.getAttribute('data-testid') ?? null);
    await removeChip(chipOf(page, plainA));
    await expect.poll(() => chipIds(page)).toEqual([yellow, red, plainB]);
    await expect.poll(() => taggedOf(page, plainA)).toEqual([]);
    await expect.poll(focusedChip).toBe(`tag-chip-${plainB}`); // the chip after it

    await page.keyboard.press('Backspace'); // ⌫ on the focused chip
    await expect.poll(() => chipIds(page)).toEqual([yellow, red]);
    await expect.poll(focusedChip).toBe(`tag-chip-${red}`); // nothing after: the one before
    await page.keyboard.press('Backspace');
    await expect.poll(() => chipIds(page)).toEqual([yellow]);
    await page.keyboard.press('Backspace');
    await expect.poll(() => chipIds(page)).toEqual([]);
    await expect(page.getByTestId('tag-add-chip')).toBeFocused();
    expect((await organizeSnapshot(page)).tagged).toEqual({});
  } finally {
    await app.close();
  }
});

test('IME: keys that belong to a Korean composition neither attach, move nor close; keyCode 229 too; after the commit ↩ attaches', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await importPaths(page, [PDF]);
    await showItemPanel(app, page);
    await rowByTitle(page, 'sample').click();
    await page.getByTestId('tag-add-chip').click();
    const input = page.getByTestId('tag-input');
    await expect(input).toBeFocused();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.imeSetComposition', { text: '수용', selectionStart: 2, selectionEnd: 2 });
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('tag-field')).toBeVisible();
    expect((await organizeSnapshot(page)).tags.map((x) => x.name)).toEqual([]); // nothing was made of the half-written word
    await cdp.send('Input.insertText', { text: '수용체' }); // commits the composition
    await expect(input).toHaveValue('수용체');
    for (const type of ['keyDown', 'keyUp'] as const) {
      await cdp.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229 }); // macOS IME confirm
    }
    await page.waitForTimeout(300);
    expect((await organizeSnapshot(page)).tags).toEqual([]);
    await page.keyboard.press('Enter');
    const made = await tagIdByName(page, '수용체');
    await expect(chipOf(page, made)).toBeVisible();
  } finally {
    await app.close();
  }
});

test('collection section: a row per direct collection in tree order, a press moves there with this item still selected, 컬렉션에 없음 when none; while editing, the info rules come first', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    const [sample, ko] = await importPaths(page, [PDF, KO_PDF, MP4]);
    const stat = await createCollection(page, '통계'); // created first: the tree is by name, not creation
    const bio = await createCollection(page, '분자생물학');
    const c6 = await createCollection(page, '6장 · 신호 전달', bio);
    await addToCollection(page, bio, [sample!.id, ko!.id]);
    await addToCollection(page, c6, [sample!.id]);
    await addToCollection(page, stat, [sample!.id]);
    await showItemPanel(app, page);
    await rowByTitle(page, 'sample').click();
    await expect(pathRowsOf(page)).toHaveText(['분자생물학', '분자생물학 › 6장 · 신호 전달', '통계']);
    await expect(pathRowsOf(page).nth(1)).toHaveAttribute('data-collection-id', c6);
    await rowByTitle(page, KO).click();
    await expect(pathRowsOf(page)).toHaveText(['분자생물학']);
    await rowByTitle(page, H264).click();
    await expect(page.getByTestId('collections-none')).toHaveText('컬렉션에 없음');

    // Pressing a path moves the view there and keeps this item (only this item) selected, shown in the table.
    await rowByTitle(page, 'sample').click();
    await pathRowsOf(page).nth(0).click();
    await expect(page.getByTestId('toolbar-title')).toHaveText('분자생물학');
    await expect(treeRow(page, bio)).toHaveAttribute('aria-selected', 'true');
    await expect(rowByTitle(page, 'sample')).toHaveAttribute('aria-selected', 'true');
    await expect(rowByTitle(page, KO)).not.toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('inspector-item')).toHaveAttribute('data-item-id', sample!.id);

    // While the info is being edited, pressing a path goes through the editor's rules first (spec 6.1): an invalid
    // title keeps the editor and the view; a valid change is saved and then the view moves.
    await specialRow(page, 'all').click();
    await rowByTitle(page, 'sample').click();
    await page.getByTestId('info-edit').click();
    const title = page.locator('[data-testid="editor-field"][data-field="title"] input');
    await title.fill('');
    await pathRowsOf(page).nth(0).click();
    await expect(page.getByTestId('info-editor')).toBeVisible();
    await expect(page.getByTestId('toolbar-title')).toHaveText('내 라이브러리');
    await title.fill('sample 2');
    await pathRowsOf(page).nth(0).click();
    await expect(page.getByTestId('toolbar-title')).toHaveText('분자생물학');
    await expect(page.getByTestId('info-editor')).toHaveCount(0);
    expect((await detailOf(page, sample!.id)).item.title).toBe('sample 2');
  } finally {
    await app.close();
  }
});

test('several selected: 공통 태그 and 컬렉션 hold what all share; removing a common tag takes it off all; 모두에 태그 추가 attaches to all; a common collection moves there and clears the selection; the empty texts', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    const [s, k, m] = await importPaths(page, [PDF, KO_PDF, MP4, MPEG4]);
    const bio = await createCollection(page, '분자생물학');
    const c6 = await createCollection(page, '6장', bio);
    await addToCollection(page, bio, [s!.id, k!.id, m!.id]);
    await addToCollection(page, c6, [s!.id, k!.id]);
    const all3 = await createTag(page, '공통');
    const two = await createTag(page, '일부');
    await assignTag(page, all3, [s!.id, k!.id, m!.id]);
    await assignTag(page, two, [s!.id, k!.id]);
    await showItemPanel(app, page);
    await selectRows(page, ['sample', KO, H264]);
    await expect(page.getByTestId('inspector-multi')).toBeVisible();
    await expect(tagsSection(page)).toContainText('공통 태그');
    await expect.poll(() => chipIds(page)).toEqual([all3]);
    await expect(pathRowsOf(page)).toHaveText(['분자생물학']); // 6장 holds two of the three

    await removeChip(chipOf(page, all3));
    await expect.poll(() => taggedOf(page, all3)).toEqual([]); // off all three
    await expect(page.getByTestId('tags-common-none')).toHaveText('고른 자료에 함께 붙은 태그가 없습니다.');

    // 모두에 태그 추가: the same field; a tag some have is offered and goes on all.
    await expect(page.getByTestId('tag-add-chip')).toHaveText('모두에 태그 추가');
    await page.getByTestId('tag-add-chip').click();
    await page.getByTestId('tag-input').fill('일부');
    await expect(page.getByTestId('tag-suggestion')).toHaveCount(1);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect.poll(() => taggedOf(page, two)).toEqual(sorted([s!.id, k!.id, m!.id]));
    await expect.poll(() => chipIds(page)).toEqual([two]);
    await page.keyboard.press('Escape');

    // Nothing in common: the texts say so.
    await selectRows(page, [H264, 'sample-mpeg4part2']);
    await expect(page.getByTestId('collections-common-none')).toHaveText('고른 자료가 함께 든 컬렉션이 없습니다.');
    await expect(page.getByTestId('tags-common-none')).toBeVisible();

    // A common collection: the view moves there and the selection is cleared (several items, so no exception).
    await selectRows(page, ['sample', KO]);
    await expect(pathRowsOf(page)).toHaveText(['분자생물학', '분자생물학 › 6장']);
    await pathRowsOf(page).nth(0).click();
    await expect(page.getByTestId('toolbar-title')).toHaveText('분자생물학');
    await expect(page.getByTestId('inspector-none')).toBeVisible();
    await expect(rowByTitle(page, 'sample')).not.toHaveAttribute('aria-selected', 'true');
  } finally {
    await app.close();
  }
});

test('1,000 items selected: the common tag, the common collection and the menu\'s marks come from the snapshot — not one IPC call', async ({}, testInfo) => {
  test.setTimeout(120_000);
  const { app, page } = await launch(...dirs(testInfo));
  try {
    const [pdf] = await importPaths(page, [PDF]);
    await seedLibrary(app, { count: 999, from: pdf! });
    const everyone = await page.evaluate(async () => {
      const r = await window.learn.library.list();
      return r.ok ? r.data.map((i) => i.id) : [];
    });
    expect(everyone).toHaveLength(1000);
    const bio = await createCollection(page, '분자생물학');
    const tag = await createTag(page, '공통');
    await addToCollection(page, bio, everyone);
    await assignTag(page, tag, everyone);
    await showItemPanel(app, page);
    await rowAt(page, 0).click();
    await expect(page.getByTestId('inspector-item')).toBeVisible();
    await expect(chipOf(page, tag)).toBeVisible();
    await quietLibraryCalls(app); // the setup's own reads are done
    const before = await changeCalls(app);

    await page.keyboard.press('ControlOrMeta+a');
    await expect(page.getByTestId('inspector-multi').locator('h2')).toHaveText('자료 1000개 선택');
    await expect(chipOf(page, tag)).toBeVisible();
    await expect(pathRowsOf(page)).toHaveText(['분자생물학']);
    await page.getByTestId('add-to-collection').click();
    await expect(page.getByTestId(`add-to-collection-${bio}`)).toHaveAttribute('aria-disabled', 'true'); // all 1,000 are in it already
    await page.keyboard.press('Escape');
    await page.waitForTimeout(700); // anything that was going to be asked has been asked
    expect(await changeCalls(app)).toEqual(before);

    // The counter is not blind: a change made here shows in it (one tags:assign for the 1,000 ids).
    await page.getByTestId('tag-add-chip').click();
    await page.getByTestId('tag-input').fill('새 개념');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await changeCalls(app))['tags:assign'] ?? 0).toBe((before['tags:assign'] ?? 0) + 1);
  } finally {
    await app.close();
  }
});

test('컬렉션에 추가 ▾: the tree in order with its depth, "already in" marked and disabled; a pick files the selection; 새 컬렉션 names one and files into it, esc files nothing', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    const [s, k, m] = await importPaths(page, [PDF, KO_PDF, MP4]);
    const stat = await createCollection(page, '통계');
    const bio = await createCollection(page, '분자생물학');
    const c6 = await createCollection(page, '6장', bio);
    await addToCollection(page, bio, [s!.id, k!.id, m!.id]);
    await addToCollection(page, c6, [s!.id]);
    await showItemPanel(app, page);
    await selectRows(page, ['sample', KO, H264]);
    await page.getByTestId('add-to-collection').click();
    const entries = page.locator('[data-testid^="add-to-collection-"]');
    await expect(entries).toHaveCount(4);
    expect(await entries.evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')))).toEqual([bio, c6, stat, 'new'].map((id) => `add-to-collection-${id}`));
    await expect(page.getByTestId(`add-to-collection-${bio}`)).toHaveAttribute('data-indent', '0');
    await expect(page.getByTestId(`add-to-collection-${c6}`)).toHaveAttribute('data-indent', '1');
    await expect(page.getByTestId(`add-to-collection-${bio}`)).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId(`add-to-collection-${bio}`)).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId(`add-to-collection-${c6}`)).not.toHaveAttribute('aria-checked', 'true'); // it holds one of the three
    await expect(page.getByTestId('add-to-collection-new')).toContainText(NEW);

    await page.getByTestId(`add-to-collection-${c6}`).click();
    await expect(entries).toHaveCount(0); // the menu closed
    await expect.poll(() => membersOf(page, c6)).toEqual(sorted([s!.id, k!.id, m!.id]));
    await page.getByTestId('add-to-collection').click();
    await expect(page.getByTestId(`add-to-collection-${c6}`)).toHaveAttribute('aria-disabled', 'true'); // now it holds them all

    // 새 컬렉션: named in the sidebar; the selection goes into it once the name is made.
    await page.getByTestId('add-to-collection-new').click();
    const name = page.getByTestId('rename-input');
    await expect(name).toBeFocused();
    await name.fill('새 모음');
    await page.keyboard.press('Enter');
    const made = await collectionIdByName(page, '새 모음');
    await expect.poll(() => membersOf(page, made)).toEqual(sorted([s!.id, k!.id, m!.id]));

    // esc in the name field: no collection, nothing filed.
    const count = (await organizeSnapshot(page)).collections.length;
    await page.getByTestId('add-to-collection').click();
    await page.getByTestId('add-to-collection-new').click();
    await expect(name).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(name).toHaveCount(0);
    await page.waitForTimeout(400);
    expect((await organizeSnapshot(page)).collections).toHaveLength(count);
    expect(await membersOf(page, stat)).toEqual([]);
  } finally {
    await app.close();
  }
});

test('the item menu: 컬렉션에 추가 ▸ lists 새 컬렉션 first, then the tree whose parents are submenus opening with themselves, "already in" checked and disabled; each path files the clicked rows; 빼기 is not listed outside a collection', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    const [s, k] = await importPaths(page, [PDF, KO_PDF, MP4]);
    const stat = await createCollection(page, '통계');
    const bio = await createCollection(page, '분자생물학');
    const c6 = await createCollection(page, '6장 · 신호 전달', bio);
    await addToCollection(page, bio, [s!.id]);

    await stubContextMenu(app, ['컬렉션에 추가', '통계']);
    await rowByTitle(page, 'sample').click({ button: 'right' });
    await expect.poll(async () => (await recordedPopups(app)).length).toBe(1);
    const [menu] = await recordedPopups(app);
    expect(menu!.filter((i) => i.type !== 'separator').map((i) => i.label)).toEqual(['열기', REVEAL, '사본 내보내기…', '컬렉션에 추가']);
    const add = menu!.find((i) => i.label === '컬렉션에 추가')!;
    expect(rowsOf(add.submenu!)).toEqual([NEW, '-', '분자생물학', '통계']);
    expect(rowsOf(add.submenu!.find((i) => i.label === '분자생물학')!.submenu!)).toEqual(['분자생물학 ✓ ✗', '-', '6장 · 신호 전달']); // sample is in 분자생물학
    await expect.poll(() => membersOf(page, stat)).toEqual([s!.id]);
    expect(await menuItemEnabled(app, 'collection.removeItems')).toBe(false);

    // A child through its parent's submenu.
    await stubContextMenu(app, ['컬렉션에 추가', '분자생물학', '6장 · 신호 전달']);
    await rowByTitle(page, 'sample').click({ button: 'right' });
    await expect.poll(() => membersOf(page, c6)).toEqual([s!.id]);

    // The parent through its own first row (korean pdf is in none of them).
    await stubContextMenu(app, ['컬렉션에 추가', '분자생물학', '분자생물학']);
    await rowByTitle(page, KO).click({ button: 'right' });
    await expect.poll(() => membersOf(page, bio)).toEqual(sorted([s!.id, k!.id]));

    // Inside a selection the menu acts on all of it, and a collection that holds only some is not marked.
    await selectRows(page, ['sample', KO]);
    await stubContextMenu(app, ['컬렉션에 추가', '통계']);
    await rowByTitle(page, KO).click({ button: 'right' });
    await expect.poll(() => membersOf(page, stat)).toEqual(sorted([s!.id, k!.id]));
    const [second] = await recordedPopups(app);
    const rows = second!.find((i) => i.label === '컬렉션에 추가')!.submenu!;
    expect(rowsOf(rows)).toEqual([NEW, '-', '분자생물학', '통계']);
    expect(rowsOf(rows.find((i) => i.label === '분자생물학')!.submenu!)).toEqual(['분자생물학 ✓ ✗', '-', '6장 · 신호 전달']); // both are in 분자생물학, only sample in 6장

    // 새 컬렉션: named in place; the clicked rows go into it.
    await stubContextMenu(app, ['컬렉션에 추가', NEW]);
    await rowByTitle(page, KO).click({ button: 'right' });
    const name = page.getByTestId('rename-input');
    await expect(name).toBeFocused();
    await name.fill('내 모음');
    await page.keyboard.press('Enter');
    const made = await collectionIdByName(page, '내 모음');
    await expect.poll(() => membersOf(page, made)).toEqual(sorted([s!.id, k!.id]));

    // The menu bar's own row files the selection too; it carries no marks (main does not know the selection's collections).
    await expect.poll(() => menuItemEnabled(app, `collection.addItems?collectionId=${c6}`)).toBe(true);
    await rowByTitle(page, KO).click();
    await runMenuCommand(app, 'collection.addItems', { collectionId: c6 });
    await expect.poll(() => membersOf(page, c6)).toEqual(sorted([s!.id, k!.id]));
    const row = flatten(await menuSnapshot(app)).find((n) => n.id === `collection.addItems?collectionId=${bio}`);
    expect(row).toMatchObject({ enabled: true, checked: false });
  } finally {
    await app.close();
  }
});

test('이 컬렉션에서 빼기: only inside a collection; takes the items out of it and what is below it, says how many, 실행 취소 puts every membership back', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    const [s, k, m] = await importPaths(page, [PDF, KO_PDF, MP4]);
    const bio = await createCollection(page, '분자생물학');
    const c6 = await createCollection(page, '6장', bio);
    await addToCollection(page, bio, [s!.id, m!.id]);
    await addToCollection(page, c6, [s!.id, k!.id]);

    // In 내 라이브러리 the row is not in the item menu and the menu bar's item is off.
    await stubContextMenu(app, null);
    await rowByTitle(page, 'sample').click({ button: 'right' });
    await expect.poll(async () => (await recordedPopups(app)).length).toBe(1);
    expect((await recordedPopups(app))[0]!.map((i) => i.label)).not.toContain(REMOVE);
    expect(await menuItemEnabled(app, 'collection.removeItems')).toBe(false);

    // In 분자생물학 the view holds the items of 6장 too: sample, 한글 경로, h264.
    await treeRow(page, bio).click();
    await expect(page.getByTestId('item-row')).toHaveCount(3);
    await selectRows(page, ['sample', KO]);
    await stubContextMenu(app, REMOVE);
    await rowByTitle(page, KO).click({ button: 'right' }); // inside the selection: it stays whole
    await expect(page.getByTestId('undo-toast')).toContainText('‘분자생물학’에서 자료 2개를 뺐습니다.');
    await expect(page.getByTestId('item-row')).toHaveCount(1); // only h264 is left in the view
    expect((await organizeSnapshot(page)).members).toEqual({ [bio]: [m!.id] }); // 6장 lost both too, 분자생물학 lost sample

    await page.getByTestId('undo-action').click();
    await expect(page.getByTestId('item-row')).toHaveCount(3);
    expect(await membersOf(page, bio)).toEqual(sorted([s!.id, m!.id]));
    expect(await membersOf(page, c6)).toEqual(sorted([s!.id, k!.id]));

    // The menu bar's item does the same for the selection.
    await selectRows(page, ['sample']);
    await runMenuCommand(app, 'collection.removeItems');
    await expect(page.getByTestId('undo-toast')).toContainText('‘분자생물학’에서 자료 1개를 뺐습니다.');
    await expect.poll(() => membersOf(page, bio)).toEqual([m!.id]);
  } finally {
    await app.close();
  }
});

test('the page-count probe waits 150 ms for a selection to stay, opens one file for rows passed quickly, one per slow step, and none for several items', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await importPaths(page, distinctPdfs(testInfo.outputPath('pdfs'), 12));
    await showItemPanel(app, page);
    await page.evaluate(() => {
      (window as unknown as { __learnProbes: unknown[] }).__learnProbes = [];
    });
    const probes = () => page.evaluate(() => (window as unknown as { __learnProbes?: unknown[] }).__learnProbes?.length ?? -1);
    await rowAt(page, 0).click();
    await expect.poll(probes).toBe(1);

    // Ten ↓ in one task: ten selections 0 ms apart (a keyboard rate no machine can undercut), one probe for the last row.
    await page.evaluate(() => {
      const grid = document.activeElement!;
      for (let i = 0; i < 10; i++) grid.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true, cancelable: true }));
    });
    await expect.poll(probes).toBe(2);
    await page.waitForTimeout(600);
    expect(await probes()).toBe(2); // none of the rows passed was opened
    await expect(page.getByTestId('inspector-kind')).toHaveText(/PDF · \d+쪽/);

    // The control: a slow step is read each time, so the counter does not stand still by itself.
    await rowAt(page, 10).focus();
    for (const n of [3, 4]) {
      await page.keyboard.press('ArrowUp');
      await expect.poll(probes).toBe(n);
    }

    // Several items: no panel head, no probe.
    await page.keyboard.press('ControlOrMeta+a');
    await expect(page.getByTestId('inspector-multi')).toBeVisible();
    await page.waitForTimeout(600);
    expect(await probes()).toBe(4);
  } finally {
    await app.close();
  }
});

test('the role field of the info form: our own chevron and no system arrow off the Mac, the system select on it', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await importPaths(page, [PDF]);
    await showItemPanel(app, page);
    await rowByTitle(page, 'sample').click();
    await page.getByTestId('info-edit').click();
    await page.getByTestId('creator-add').click();
    const select = page.getByTestId('creator-role').first();
    const chevron = select.locator('xpath=..').locator('svg');
    const appearance = await select.evaluate((e) => getComputedStyle(e).appearance);
    if (process.platform === 'darwin') {
      expect(appearance).toBe('auto');
      await expect(chevron).toBeHidden();
    } else {
      expect(appearance).toBe('none');
      await expect(chevron).toBeVisible();
      const [box, mark] = [await select.boundingBox(), await chevron.boundingBox()];
      expect(mark!.x).toBeGreaterThanOrEqual(box!.x + box!.width - 24); // at the field's end
      expect(mark!.x + mark!.width).toBeLessThanOrEqual(box!.x + box!.width);
    }
    await select.selectOption('editor'); // it is still a select
    await expect(select).toHaveValue('editor');
  } finally {
    await app.close();
  }
});

test('axe at the states this task adds: tags and collections of one item, the add field with suggestions, several items\' common sections, the open 컬렉션에 추가 ▾ menu', async ({}, testInfo) => {
  test.setTimeout(120_000);
  const { app, page } = await launch(...dirs(testInfo), { colorScheme: null });
  try {
    const [s, k] = await importPaths(page, [PDF, KO_PDF, MP4]);
    const bio = await createCollection(page, '분자생물학');
    const c6 = await createCollection(page, '6장', bio);
    await addToCollection(page, bio, [s!.id, k!.id]);
    await addToCollection(page, c6, [s!.id]);
    const important = await createTag(page, '중요');
    await setTagColor(page, important, 'yellow', 1);
    const plain = await createTag(page, '수용체');
    await assignTag(page, important, [s!.id, k!.id]);
    await assignTag(page, plain, [s!.id]);
    await createTag(page, '수용체 억제');
    await showItemPanel(app, page);
    await rowByTitle(page, 'sample').click();
    await expect(chipOf(page, important)).toBeVisible();
    await expectNoSeriousA11y(page, 'item panel with tags and collections');
    await page.getByTestId('tag-add-chip').click();
    await page.getByTestId('tag-input').fill('수용');
    await expect(page.getByTestId('tag-suggestion')).toHaveCount(1);
    await page.keyboard.press('ArrowDown');
    await expectNoSeriousA11y(page, 'tag add field with a chosen suggestion');
    await page.keyboard.press('Escape');
    await selectRows(page, ['sample', KO]);
    await expect(page.getByTestId('inspector-multi')).toBeVisible();
    await expectNoSeriousA11y(page, 'several items, common tags and collections');
    await page.getByTestId('add-to-collection').click();
    await expect(page.getByTestId(`add-to-collection-${bio}`)).toBeVisible();
    await expectNoSeriousA11y(page, 'the 컬렉션에 추가 menu open');
  } finally {
    await app.close();
  }
});
