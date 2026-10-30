// The sidebar (M5 spec 3.2, 3.3): the special views, the collection tree under React Aria's Virtualizer, its keys and its menu.
import path from 'node:path';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { commandById, type CommandId } from '../../packages/domain/src/commands';
import { expectNoSeriousA11y } from './a11y';
import {
  FIXTURES, addToCollection, createCollection, createCollectionTree, expandAll, importPaths, launch, openItem, organizeSnapshot, recordedPopupPoints, recordedPopups, runMenuCommand,
  specialRow, stubContextMenu, treeRow, type CollectionTree,
} from './helpers';

const PDF = path.join(FIXTURES, 'sample.pdf');
const KO_PDF = path.join(FIXTURES, '한글 경로 (테스트) #1.pdf');
const dirs = (testInfo: TestInfo) => [testInfo.outputPath('library'), testInfo.outputPath('userdata')] as const;
const L = (id: CommandId) => commandById(id).label;
const title = (page: Page) => page.getByTestId('toolbar-title');
/** The key of the tree row that has the focus (a collection's id, or scope:…), or null. */
const focusedKey = (page: Page) => page.evaluate(() => document.activeElement?.closest('[role="row"][data-key]')?.getAttribute('data-key') ?? null);
const nameOf = (tree: CollectionTree, id: string) => `과목 ${String(tree.ids.indexOf(id)).padStart(3, '0')}`;
/** The rows of an everything-open tree, top to bottom: depth first, children in name (= creation) order. */
function visibleOrder(tree: CollectionTree): string[] {
  const out: string[] = [];
  const walk = (id: string) => {
    out.push(id);
    for (const child of tree.children[id]!) walk(child);
  };
  for (const id of tree.ids) if (tree.parent[id] === null) walk(id);
  return out;
}
/** The row is wholly inside the tree's scroll area. */
async function inView(tree: Locator, row: Locator): Promise<boolean> {
  const [t, r] = [await tree.boundingBox(), await row.boundingBox()];
  return t !== null && r !== null && r.y >= t.y - 0.5 && r.y + r.height <= t.y + t.height + 0.5;
}

test('special views appear with content and 내 라이브러리 always; the one being viewed stays until another is chosen (spec 3.2)', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    const [pdf, ko] = await importPaths(page, [PDF, KO_PDF]);
    await expect(specialRow(page, 'all').locator('.count')).toHaveText('2');
    for (const kind of ['recent', 'unfiled', 'duplicates'] as const) await expect(specialRow(page, kind), kind).toHaveCount(0);
    await expect(page.getByTestId('sidebar-hint')).toHaveText('컬렉션이 없습니다. 자료를 묶으려면 새\u00a0컬렉션을 만드세요.');

    // 최근 연 자료: once an item was opened (the reader reports it); no number on its row.
    await openItem(page, pdf!.title);
    await expect(page.getByTestId('viewer-title')).toBeVisible();
    await runMenuCommand(app, 'nav.back');
    await expect(specialRow(page, 'recent')).toBeVisible();
    await expect(specialRow(page, 'recent').locator('.count')).toHaveCount(0);

    // 미분류: needs a collection, and the items in none of them.
    const a = await createCollection(page, '가');
    await expect(specialRow(page, 'unfiled').locator('.count')).toHaveText('2');
    await addToCollection(page, a, [pdf!.id]);
    await expect(specialRow(page, 'unfiled').locator('.count')).toHaveText('1');
    await specialRow(page, 'unfiled').click();
    await expect(title(page)).toHaveText('미분류');
    await expect(page.getByTestId('item-row')).toHaveCount(1);
    await addToCollection(page, a, [ko!.id]);
    await expect(specialRow(page, 'unfiled')).toBeVisible(); // being viewed: the row stays after its last item went
    await expect(specialRow(page, 'unfiled').locator('.count')).toHaveCount(0);
    await expect(page.getByTestId('scope-empty-unfiled')).toContainText('모든\u00a0자료가 컬렉션에 들어 있습니다');
    await expectNoSeriousA11y(page, 'an empty special view');
    await specialRow(page, 'all').click();
    await expect(specialRow(page, 'unfiled')).toHaveCount(0);

    // 중복 항목: items that share a file.
    await page.evaluate((p) => window.learn.library.import({ paths: [p], mode: 'managed', allowDuplicate: true }), PDF);
    await expect(specialRow(page, 'duplicates').locator('.count')).toHaveText('2');
    await specialRow(page, 'duplicates').click();
    await expect(page.getByTestId('item-row')).toHaveCount(2);
    await expectNoSeriousA11y(page, 'the special views');
  } finally {
    await app.close();
  }
});

test('counts include the sub-collections\' items once, zero shows no number, and a row opens by its chevron or a double click', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    const [pdf, ko] = await importPaths(page, [PDF, KO_PDF]);
    const bio = await createCollection(page, '분자생물학');
    const c6 = await createCollection(page, '6장', bio);
    const empty = await createCollection(page, '학회 준비');
    await addToCollection(page, c6, [pdf!.id]);
    await addToCollection(page, bio, [ko!.id, pdf!.id]);
    await expect(treeRow(page, bio).locator('.count')).toHaveText('2'); // pdf is in both: counted once
    await expect(treeRow(page, empty).locator('.count')).toHaveCount(0);
    await expect(treeRow(page, c6)).toHaveCount(0); // the parent is closed
    await treeRow(page, bio).locator('.disclosure').click();
    await expect(treeRow(page, c6)).toBeVisible();
    await expect(treeRow(page, c6).locator('.count')).toHaveText('1');
    await expect(treeRow(page, bio)).toHaveAttribute('aria-expanded', 'true');
    await expect(treeRow(page, c6).locator('.disclosure')).toHaveCount(0); // a leaf draws no chevron, the gutter stays
    await treeRow(page, bio).dblclick();
    await expect(treeRow(page, c6)).toHaveCount(0);
    await treeRow(page, bio).dblclick();
    await expect(treeRow(page, c6)).toBeVisible();
    await treeRow(page, c6).click();
    await expect(treeRow(page, c6)).toHaveAttribute('aria-selected', 'true');
    await expect(title(page)).toHaveText('6장');
    await expect(page.getByTestId('item-row')).toHaveCount(1);
    await expectNoSeriousA11y(page, 'the tree open with a selection');
  } finally {
    await app.close();
  }
});

test('200 collections: the tree is virtual and its keys follow the model — Home/End, →/← by first child and parent, no type-ahead, one Tab stop', async ({}, testInfo) => {
  test.setTimeout(240_000);
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await importPaths(page, [PDF]);
    const tree = await createCollectionTree(page, 200);
    await expandAll(page, tree);
    const scroller = page.getByTestId('sidebar-tree');
    const drawn = await page.locator('[data-testid="sidebar-tree"] [role="row"][data-key]').count();
    expect(drawn, 'rows in the DOM').toBeLessThan(90);
    // And more than the tree folded would have (its top-level rows and the special views): the expand-all took.
    expect(drawn, 'rows in the DOM, all open').toBeGreaterThan(tree.ids.filter((id) => tree.parent[id] === null).length + 4);
    // The "컬렉션" heading is 36 px, starting where the special views end (12 gap + 24 label), whatever the density.
    const g = await page.evaluate(() => {
      const specials = [...document.querySelectorAll('[data-testid^="nav-scope-"]')];
      const heading = document.querySelector('.sidebar-tree .tree-heading')!.getBoundingClientRect();
      return { lastSpecialBottom: specials.at(-1)!.getBoundingClientRect().bottom, headingTop: heading.top, headingHeight: heading.height };
    });
    expect(g.headingTop).toBeCloseTo(g.lastSpecialBottom, 0);
    expect(g.headingHeight).toBe(36);

    // F6 lands on the selected row; ↑↓ run on through the special views into the tree and the view follows.
    await page.keyboard.press('F6');
    expect(await focusedKey(page)).toBe('scope:all');
    await page.keyboard.press('ArrowDown');
    await expect(title(page)).toHaveText('미분류');
    await page.keyboard.press('ArrowDown');
    const first = tree.ids[0]!;
    expect(await focusedKey(page)).toBe(first);
    await expect(title(page)).toHaveText('과목 000');

    // → on an open row: its first child, named by the model. ← folds an open row, then goes to the parent.
    const child = tree.children[first]![0]!;
    await page.keyboard.press('ArrowRight');
    expect(await focusedKey(page)).toBe(child);
    await expect(title(page)).toHaveText(nameOf(tree, child));
    await page.keyboard.press('ArrowLeft');
    await expect(treeRow(page, child)).toHaveAttribute('aria-expanded', 'false');
    expect(await focusedKey(page)).toBe(child);
    await page.keyboard.press('ArrowLeft');
    expect(await focusedKey(page)).toBe(first);
    await expect(title(page)).toHaveText('과목 000');

    // No type-ahead: a letter or a Hangul syllable moves nothing.
    // Playwright's press() knows no Hangul key: the syllable is sent as the keydown a Korean layout sends.
    const cdp = await page.context().newCDPSession(page);
    // The syllables are the first letters of rows type-ahead would go to from here (내 라이브러리, 미분류): without the
    // wrapper's block the cursor and the view would move. A search lasts 1 s, so the probes are apart.
    for (const key of ['내', '미', 'a']) {
      for (const type of ['keyDown', 'keyUp'] as const) await cdp.send('Input.dispatchKeyEvent', { type, key, text: type === 'keyDown' ? key : undefined });
      await page.waitForTimeout(1100);
      expect(await focusedKey(page), key).toBe(first);
      await expect(title(page)).toHaveText('과목 000');
    }

    // End is the last row of the tree and scrolls to it; Home goes back to 내 라이브러리 and to the top.
    const last = visibleOrder(tree).at(-1)!;
    await page.keyboard.press('End');
    expect(await focusedKey(page)).toBe(last);
    await expect(treeRow(page, last)).toBeVisible();
    expect(await inView(scroller, treeRow(page, last))).toBe(true);
    await expect(title(page)).toHaveText(nameOf(tree, last));
    await page.keyboard.press('Home');
    expect(await focusedKey(page)).toBe('scope:all');
    await expect(title(page)).toHaveText('내 라이브러리');
    expect(await scroller.evaluate((e) => e.scrollTop)).toBe(0);

    // The tree is one Tab stop: Tab leaves it.
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => (document.activeElement?.closest('[data-testid="sidebar-tree"]') ?? null) !== null)).toBe(false);

    // → at the bottom edge: the open row is the last one fully in view, so its first child may not be mounted yet.
    const order = visibleOrder(tree);
    const parentId = tree.ids.filter((id) => tree.parent[id] === null)[5]!;
    const firstChild = tree.children[parentId]![0]!;
    const specials = await page.locator('[data-testid^="nav-scope-"]').count();
    const rowHeight = (await specialRow(page, 'all').boundingBox())!.height;
    const clientHeight = await scroller.evaluate((e) => e.clientHeight);
    const rowTop = specials * rowHeight + 36 + order.indexOf(parentId) * rowHeight;
    await scroller.evaluate((e, top) => void (e.scrollTop = top), rowTop + rowHeight - clientHeight);
    await expect(treeRow(page, parentId)).toBeVisible();
    test.info().annotations.push({ type: 'first child mounted before →', description: String(await treeRow(page, firstChild).count()) });
    await treeRow(page, parentId).click();
    await page.keyboard.press('ArrowRight');
    expect(await focusedKey(page)).toBe(firstChild);
    await expect(title(page)).toHaveText(nameOf(tree, firstChild));
    await expect(treeRow(page, firstChild)).toBeFocused();
  } finally {
    await app.close();
  }
});

test('a chevron only folds or unfolds: the view and the selected row stay, unless the fold hides the viewed row, which moves the view to the folded collection', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    const [pdf] = await importPaths(page, [PDF]);
    const bio = await createCollection(page, '분자생물학');
    const c6 = await createCollection(page, '6장', bio);
    const stats = await createCollection(page, '통계');
    await createCollection(page, '회귀', stats);
    await addToCollection(page, c6, [pdf!.id]);
    await treeRow(page, bio).locator('.disclosure').click();
    await treeRow(page, c6).click();
    await expect(title(page)).toHaveText('6장');

    // A collection that is not viewed: its chevron unfolds it and the view stays.
    await expect(treeRow(page, stats)).toHaveAttribute('aria-expanded', 'false');
    await treeRow(page, stats).locator('.disclosure').click();
    await expect(treeRow(page, stats)).toHaveAttribute('aria-expanded', 'true');
    await expect(title(page)).toHaveText('6장');
    await expect(treeRow(page, c6)).toHaveAttribute('aria-selected', 'true');
    await expect(treeRow(page, stats)).toHaveAttribute('aria-selected', 'false');
    await treeRow(page, stats).locator('.disclosure').click();
    await expect(treeRow(page, stats)).toHaveAttribute('aria-expanded', 'false');
    await expect(title(page)).toHaveText('6장');

    // Folding an ancestor of the viewed collection hides its row: the view goes to the folded one.
    await treeRow(page, bio).locator('.disclosure').click();
    await expect(treeRow(page, bio)).toHaveAttribute('aria-expanded', 'false');
    await expect(title(page)).toHaveText('분자생물학');
    await expect(treeRow(page, bio)).toHaveAttribute('aria-selected', 'true');
  } finally {
    await app.close();
  }
});

test('the open collections and the view are remembered across a restart', async ({}, testInfo) => {
  const [library, userData] = dirs(testInfo);
  let s = await launch(library, userData);
  let bio = '';
  let c6 = '';
  try {
    bio = await createCollection(s.page, '분자생물학');
    c6 = await createCollection(s.page, '6장', bio);
    await treeRow(s.page, bio).locator('.disclosure').click();
    await treeRow(s.page, c6).click();
    const stored = (key: 'sidebar.expanded' | 'library.view') => s.page.evaluate(async (k) => {
      const r = await window.learn.settings.get({ key: k });
      return r.ok ? r.data : null;
    }, key);
    await expect.poll(() => stored('sidebar.expanded')).toEqual([bio]);
    await expect.poll(() => stored('library.view')).toEqual({ kind: 'collection', id: c6 });
  } finally {
    await s.app.close();
  }
  s = await launch(library, userData);
  try {
    await expect(treeRow(s.page, c6)).toBeVisible(); // bio was open
    await expect(treeRow(s.page, c6)).toHaveAttribute('aria-selected', 'true');
    await expect(title(s.page)).toHaveText('6장');
  } finally {
    await s.app.close();
  }
});

test('a right click selects the collection first and opens its menu — the spec\'s rows only; ⇧F10 opens it under the focused row; the special views have none', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await importPaths(page, [PDF]);
    const bio = await createCollection(page, '분자생물학');
    await stubContextMenu(app, null);
    await treeRow(page, bio).click({ button: 'right' });
    await expect(title(page)).toHaveText('분자생물학');
    await expect.poll(async () => (await recordedPopups(app)).length).toBe(1);
    const rows = (await recordedPopups(app))[0]!.map((i) => (i.type === 'separator' ? '—' : i.label));
    expect(rows).toEqual([L('collection.newChild'), L('collection.rename'), '—', L('collection.importInto'), '—', L('collection.delete')]);

    await treeRow(page, bio).focus();
    await page.keyboard.press('Shift+F10');
    await expect.poll(async () => (await recordedPopups(app)).length).toBe(2);
    const at = (await recordedPopupPoints(app))[1]!;
    const box = (await treeRow(page, bio).boundingBox())!;
    expect(Math.abs(at.x - (box.x + Math.min(box.width / 2, 48)))).toBeLessThan(2);
    expect(Math.abs(at.y - (box.y + box.height))).toBeLessThan(2);

    await specialRow(page, 'all').click({ button: 'right' });
    await specialRow(page, 'all').focus();
    await page.keyboard.press('Shift+F10');
    await page.waitForTimeout(300);
    expect((await recordedPopups(app)).length).toBe(2);
  } finally {
    await app.close();
  }
});

test('in the reader the sidebar is the way back: a row returns to the library at that collection, and moving the cursor changes no view', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    const [pdf] = await importPaths(page, [PDF]);
    const a = await createCollection(page, '가');
    await addToCollection(page, a, [pdf!.id]);
    await openItem(page, pdf!.title);
    await expect(page.getByTestId('viewer-title')).toBeVisible();
    await specialRow(page, 'all').focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('viewer-title')).toBeVisible(); // still the reader
    await runMenuCommand(app, 'nav.back');
    await expect(title(page)).toHaveText('내 라이브러리'); // the cursor moved, the view did not
    await openItem(page, pdf!.title);
    await treeRow(page, a).click();
    await expect(page.getByTestId('viewer-title')).toHaveCount(0);
    await expect(title(page)).toHaveText('가');
    await expect(page.getByTestId('item-row')).toHaveCount(1);
    // ↩ on a collection row is the way back too, not a rename (renaming is for the library view).
    await specialRow(page, 'all').click();
    await openItem(page, pdf!.title);
    await expect(page.getByTestId('viewer-title')).toBeVisible();
    await treeRow(page, a).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('viewer-title')).toHaveCount(0);
    await expect(page.getByTestId('rename-input')).toHaveCount(0);
    await expect(title(page)).toHaveText('가');
  } finally {
    await app.close();
  }
});

test('a library with items and no collection shows the hint under the 컬렉션 heading, and a new library only 내 라이브러리', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await expect(specialRow(page, 'all')).toBeVisible();
    await expect(page.getByTestId('sidebar-hint')).toBeVisible(); // the empty library too (library-empty.html)
    await expect(page.getByTestId('collections-heading')).toHaveText('컬렉션');
    await importPaths(page, [PDF]);
    await expect(page.getByTestId('sidebar-hint')).toBeVisible();
    await expectNoSeriousA11y(page, 'the sidebar hint');
    expect((await organizeSnapshot(page)).collections).toEqual([]);
  } finally {
    await app.close();
  }
});
