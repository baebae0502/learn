// Drag and drop (M5 spec 8, design-spec 7.2): rows onto collections (add, move, undo, markers), collections onto
// collections, tag chips onto rows, Finder's files onto sidebar rows, the overlay beside the sidebar, and the four
// behaviours of the tree under its Virtualizer that the product has to settle (c–f).
// A real hand's drag (esc, ⌘, the preview on a Retina screen) is on the real-Mac list.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  FIXTURES, addToCollection, assignTag, closeSheet, createCollection, createCollectionTree, createTag, expandAll, expectWindow, importPaths, launch,
  organizeSnapshot, rowByTitle, runMenuCommand, seedLibrary, selectRows, showItemPanel, specialRow, tagChip, treeRow, type Session,
} from './helpers';
import {
  MOVE_KEY, beginDrag, cancelDrag, dragTo, failOnce, finderDrag, frames, hover, marked, point, previews, recordPreviews, release, tableTitles,
} from './dnd-helpers';

const PDF = path.join(FIXTURES, 'sample.pdf');
const KO_PDF = path.join(FIXTURES, '한글 경로 (테스트) #1.pdf');
const MP4 = path.join(FIXTURES, 'sample-h264-aac.mp4');
const MP4_B = path.join(FIXTURES, 'sample-mpeg4part2.mp4');

const count = (page: Page, collectionId: string) => treeRow(page, collectionId).locator('.count');
const open = (page: Page, collectionId: string) => treeRow(page, collectionId).locator('.disclosure').click();
const members = async (page: Page, collectionId: string) => (await organizeSnapshot(page)).members[collectionId] ?? [];
const libraryCount = (page: Page) => page.evaluate(async () => (await window.learn.library.list().then((r) => (r.ok ? r.data.length : -1))));

test.describe('rows, collections and tag chips', () => {
  test.describe.configure({ mode: 'serial' });
  let s: Session;
  let ITEMS: Awaited<ReturnType<typeof importPaths>>;

  test.beforeAll(async ({}, testInfo) => {
    s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
    ITEMS = await importPaths(s.page, [PDF, KO_PDF, MP4, MP4_B]);
    await expect(s.page.getByTestId('item-row')).toHaveCount(4);
  });
  test.afterAll(async () => {
    await s?.app.close();
  });

  test('rows onto collection rows: an unselected row is picked first, an add is silent, and no marker shows on the viewed collection, a special view or a collection that holds them all — a descendant takes them', async () => {
    const { page } = s;
    const [a, b, c] = ITEMS;
    const bio = await createCollection(page, '끌기 분자생물학');
    const c6 = await createCollection(page, '끌기 6장', bio);
    const stat = await createCollection(page, '끌기 통계');
    await addToCollection(page, bio, [a!.id, b!.id, c!.id]);
    await open(page, bio);
    await treeRow(page, bio).click();
    await expect(page.getByTestId('item-row')).toHaveCount(3);

    // The row is not selected: pressing it to drag selects it first (the same rule as the right click).
    await beginDrag(page, rowByTitle(page, a!.title), 'items');
    await expect(rowByTitle(page, a!.title)).toHaveAttribute('aria-selected', 'true');
    await hover(page, treeRow(page, bio));
    expect(await marked(page), 'the viewed collection').toEqual([]);
    await hover(page, specialRow(page, 'all'));
    expect(await marked(page), 'a special view').toEqual([]);
    await hover(page, treeRow(page, c6));
    expect(await marked(page), 'a descendant of the viewed collection').toEqual([`nav-collection-${c6}`]);
    await hover(page, treeRow(page, stat));
    expect(await marked(page)).toEqual([`nav-collection-${stat}`]);
    await release(page);
    await expect(count(page, stat)).toHaveText('1');
    await expect(page.getByTestId('undo-toast'), 'an add is silent').toHaveCount(0);
    await expect(page.getByTestId('action-error')).toHaveCount(0);
    await expect(page.getByTestId('item-row'), 'nothing left the view').toHaveCount(3);
    expect(await members(page, stat)).toEqual([a!.id]);

    // 통계 holds it now: no marker there. The other collection still takes it.
    await beginDrag(page, rowByTitle(page, a!.title), 'items');
    await hover(page, treeRow(page, stat));
    expect(await marked(page), 'a collection that holds everything dragged').toEqual([]);
    await hover(page, treeRow(page, c6));
    expect(await marked(page)).toEqual([`nav-collection-${c6}`]);
    await cancelDrag(page);
  });

  test('the drag image is the first row — its kind and title — with a "자료 N개" badge from two rows on, and a press inside a multiple selection keeps it', async () => {
    const { page } = s;
    const [a, b, c, d] = ITEMS;
    await specialRow(page, 'all').click();
    await recordPreviews(page);
    await selectRows(page, [c!.title, a!.title, b!.title]);
    const order = await tableTitles(page);
    const first = order.find((title) => [a!.title, b!.title, c!.title].includes(title))!;

    // Pressing the middle row of the three: all three stay selected and go.
    await beginDrag(page, rowByTitle(page, a!.title), 'items');
    await expect(page.locator('[data-testid="item-row"][aria-selected="true"]')).toHaveCount(3);
    expect((await previews(page)).at(-1)).toEqual({ title: first, badge: '자료 3개' });
    const made = await page.evaluate(() => performance.getEntriesByName('learn:dnd:preview', 'measure').at(-1)?.duration ?? null);
    expect(made, 'the image was timed').not.toBeNull();
    expect(made!, 'and quick (a few ms in practice)').toBeLessThan(100);
    await cancelDrag(page);

    // One row: no badge.
    await rowByTitle(page, d!.title).click();
    await beginDrag(page, rowByTitle(page, d!.title), 'items');
    expect((await previews(page)).at(-1)).toEqual({ title: d!.title, badge: null });
    await cancelDrag(page);

    // A press and release without a drag is a click: the selection becomes that row.
    await selectRows(page, [a!.title, b!.title]);
    await rowByTitle(page, b!.title).click();
    await expect(page.locator('[data-testid="item-row"][aria-selected="true"]')).toHaveCount(1);
    await expect(rowByTitle(page, b!.title)).toHaveAttribute('aria-selected', 'true');
  });

  test('the move key moves out of the viewed collection and everything below it: the toast says where, 실행 취소 puts it back; outside a collection the key only adds', async () => {
    const { page } = s;
    const [a, b, c] = ITEMS;
    const bio = await createCollection(page, '이동 시험');
    const c6 = await createCollection(page, '이동 장', bio);
    const stat = await createCollection(page, '이동 통계');
    await addToCollection(page, bio, [a!.id, b!.id, c!.id]);
    await open(page, bio);
    await treeRow(page, bio).click();
    await expect(page.getByTestId('item-row')).toHaveCount(3);
    const toast = page.getByTestId('undo-toast');

    // Out of the viewed collection, into another top-level one.
    await dragTo(page, rowByTitle(page, a!.title), 'items', treeRow(page, stat), { key: MOVE_KEY });
    await expect(toast).toContainText('자료 1개를 ‘이동 통계’로 옮겼습니다.');
    await expect(page.getByTestId('item-row')).toHaveCount(2);
    expect(await members(page, bio)).not.toContain(a!.id);
    expect(await members(page, stat)).toEqual([a!.id]);
    await page.getByTestId('undo-action').click();
    await expect(page.getByTestId('item-row')).toHaveCount(3);
    expect(await members(page, bio)).toContain(a!.id);
    expect(await members(page, stat)).toEqual([]);
    await expect(toast).toHaveCount(0);

    // Into a descendant: it leaves 이동 시험 itself and stays in the view through 이동 장.
    await dragTo(page, rowByTitle(page, a!.title), 'items', treeRow(page, c6), { key: MOVE_KEY });
    await expect(toast).toContainText('자료 1개를 ‘이동 장’으로 옮겼습니다.');
    await expect(page.getByTestId('item-row')).toHaveCount(3);
    expect(await members(page, bio)).not.toContain(a!.id);
    expect(await members(page, c6)).toEqual([a!.id]);
    await expect(toast).toHaveCount(0, { timeout: 10_000 }); // the toast closes by itself

    // Outside a collection the key moves nothing: the item is added, stays where it was, and nobody is asked.
    await specialRow(page, 'all').click();
    await dragTo(page, rowByTitle(page, b!.title), 'items', treeRow(page, stat), { key: MOVE_KEY });
    await expect.poll(() => members(page, stat)).toEqual([b!.id]);
    expect(await members(page, bio)).toContain(b!.id);
    await expect(toast).toHaveCount(0);
  });

  test('esc cancels a drag: no marker stays and nothing changes; a drop on nothing changes nothing either', async () => {
    const { page } = s;
    const [a] = ITEMS;
    const stat = await createCollection(page, '취소 통계');
    await specialRow(page, 'all').click();
    await beginDrag(page, rowByTitle(page, a!.title), 'items');
    await hover(page, treeRow(page, stat));
    expect(await marked(page)).toEqual([`nav-collection-${stat}`]);
    await cancelDrag(page);
    await expect(page.locator('[data-drop-target]'), 'the sweep after the drag ended').toHaveCount(0);
    await expect(page.locator('html')).not.toHaveAttribute('data-dnd');
    expect(await members(page, stat)).toEqual([]);

    const url = page.url();
    await dragTo(page, rowByTitle(page, a!.title), 'items', page.locator('.titlebar').first());
    expect(page.url(), 'the window did not navigate').toBe(url);
    await expect(page.locator('html')).not.toHaveAttribute('data-dnd');
    await expect(page.getByTestId('undo-toast')).toHaveCount(0);
    await expect(page.getByTestId('action-error')).toHaveCount(0);
    expect(await members(page, stat)).toEqual([]);
  });

  test('a collection onto a collection: itself, its parent and its descendants get no marker; the 컬렉션 heading makes it top-level; the open rows are kept', async () => {
    const { page } = s;
    const a = await createCollection(page, '옮김 A');
    const a1 = await createCollection(page, '옮김 A-1', a);
    const a2 = await createCollection(page, '옮김 A-2', a);
    const a11 = await createCollection(page, '옮김 A-1-1', a1);
    const b = await createCollection(page, '옮김 B');
    await open(page, a);
    await open(page, a1);
    const parentOf = async (id: string) => (await organizeSnapshot(page)).collections.find((c) => c.id === id)!.parentId;

    await beginDrag(page, treeRow(page, a1), 'collection');
    for (const [why, id] of [['itself', a1], ['its parent', a], ['its child', a11]] as const) {
      await hover(page, treeRow(page, id));
      expect(await marked(page), why).toEqual([]);
    }
    await hover(page, treeRow(page, b));
    expect(await marked(page)).toEqual([`nav-collection-${b}`]);
    await release(page);
    await expect.poll(() => parentOf(a1)).toBe(b);
    // The row being moved is the view (pressing it chose it): its new parent opens so that it stays on screen; A stays open.
    await expect(treeRow(page, b)).toHaveAttribute('aria-expanded', 'true');
    await expect(treeRow(page, a1)).toBeVisible();
    const stored = await page.evaluate(() => window.learn.settings.get({ key: 'sidebar.expanded' }));
    expect(stored.ok && stored.data).toEqual(expect.arrayContaining([a, a1]));

    // The heading is the top level: a nested collection can go there, a top-level one gets no marker.
    const heading = page.getByTestId('collections-heading');
    await beginDrag(page, treeRow(page, b), 'collection');
    await hover(page, heading);
    expect(await marked(page), 'already top-level').toEqual([]);
    await cancelDrag(page);
    await beginDrag(page, treeRow(page, a2), 'collection');
    await hover(page, heading);
    expect(await marked(page)).toEqual(['collections-heading-drop']);
    await release(page);
    await expect.poll(() => parentOf(a2)).toBeNull();
  });

  test('a tag chip onto rows: a row inside the selection means all of it, outside means that row; no marker where all have the tag; the item panel\'s chips drag too', async () => {
    const { page, app } = s;
    const [a, b, c, d] = ITEMS;
    const exam = await createTag(page, '끌기 시험');
    const must = await createTag(page, '끌기 중요');
    await assignTag(page, exam, [a!.id]);
    await assignTag(page, must, [a!.id]); // so that its chip is in the view
    await specialRow(page, 'all').click();
    const tagged = async (tagId: string) => ((await organizeSnapshot(page)).tagged[tagId] ?? []).slice().sort();
    const sorted = (...ids: string[]) => ids.slice().sort();

    // Inside the selection {b, c}: one marker, on the row under the pointer; the drop reaches both — and a still has it.
    await selectRows(page, [b!.title, c!.title]);
    await beginDrag(page, tagChip(page, exam), 'tag');
    await hover(page, rowByTitle(page, b!.title));
    expect(await marked(page)).toEqual([b!.id]);
    await release(page);
    await expect.poll(() => tagged(exam)).toEqual(sorted(a!.id, b!.id, c!.id));

    // Outside the selection {b, c}: that row alone.
    await dragTo(page, tagChip(page, must), 'tag', rowByTitle(page, d!.title));
    await expect.poll(() => tagged(must)).toEqual(sorted(a!.id, d!.id));
    expect(await tagged(exam), 'the selection was not touched').toEqual(sorted(a!.id, b!.id, c!.id));

    // Everything it would reach has the tag: no marker. The one that lacks it takes the marker.
    await rowByTitle(page, a!.title).click();
    await beginDrag(page, tagChip(page, exam), 'tag');
    await hover(page, rowByTitle(page, a!.title));
    expect(await marked(page), 'a has 시험').toEqual([]);
    await hover(page, rowByTitle(page, b!.title));
    expect(await marked(page), 'b has 시험 and is outside the selection {a}: it alone').toEqual([]);
    await hover(page, rowByTitle(page, d!.title));
    expect(await marked(page), 'd lacks it').toEqual([d!.id]);
    await cancelDrag(page);

    // The chip on an item in the item panel is a source as well; the drop goes on the row it is dropped on.
    await showItemPanel(app, page);
    await rowByTitle(page, a!.title).click();
    const own = page.getByTestId('tags-section').getByTestId(`tag-chip-${exam}`);
    await dragTo(page, own, 'tag', rowByTitle(page, d!.title));
    await expect.poll(() => tagged(exam)).toEqual(sorted(a!.id, b!.id, c!.id, d!.id));
  });
});

test('the viewed collection takes the drop marker like any target — the ring over the soft accent fill — while the tree holds the focus', async ({}, testInfo) => {
  const t = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const { page } = t;
    await importPaths(page, [PDF]);
    const viewed = await createCollection(page, '표시 보는 곳');
    await treeRow(page, viewed).click();
    await expect(treeRow(page, viewed)).toHaveAttribute('aria-selected', 'true');
    await expect(treeRow(page, viewed)).toBeFocused();
    // Finder's files over the row being viewed (a drag of ours cannot get there: pressing a row to drag it makes it the view).
    const files = await finderDrag(page, MP4);
    await files.send('dragEnter', page.getByTestId('content'));
    await files.send('dragOver', treeRow(page, viewed));
    expect(await marked(page)).toEqual([`nav-collection-${viewed}`]);
    const look = await treeRow(page, viewed).evaluate((row) => {
      const probe = (css: string) => {
        const el = document.createElement('div');
        el.style.cssText = css;
        row.parentElement!.append(el);
        const style = getComputedStyle(el);
        const out = { background: style.backgroundColor, shadow: style.boxShadow };
        el.remove();
        return out;
      };
      const style = getComputedStyle(row);
      return {
        background: style.backgroundColor,
        shadow: style.boxShadow,
        soft: probe('background: var(--accent-soft)').background,
        accent: probe('background: var(--accent)').background,
        ring: probe('box-shadow: inset 0 0 0 2px var(--accent-ring)').shadow,
      };
    });
    expect(look.background, 'the soft fill, not the accent selection').toBe(look.soft);
    expect(look.background).not.toBe(look.accent);
    expect(look.shadow, 'the --accent-ring ring').toBe(look.ring);
    await files.cancel();
    await files.close();
  } finally {
    await t.app.close();
  }
});

test('a refused drop is an error toast and changes nothing; a move whose second half is refused puts the first half back', async ({}, testInfo) => {
  const t = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const { page, app } = t;
    const [a, b] = await importPaths(page, [PDF, KO_PDF]);
    const bio = await createCollection(page, '거절 분자생물학');
    const c6 = await createCollection(page, '거절 장', bio);
    const stat = await createCollection(page, '거절 통계');
    await addToCollection(page, bio, [a!.id, b!.id]);
    await open(page, bio);
    await treeRow(page, bio).click();

    // An add that main refuses: the error toast, and the row is not in the collection.
    await failOnce(app, 'collections:addItems');
    await dragTo(page, rowByTitle(page, a!.title), 'items', treeRow(page, stat));
    await expect(page.getByTestId('action-error')).toHaveCount(1);
    expect(await members(page, stat)).toEqual([]);

    // A move whose removal main refuses: nothing was taken out, nothing put in.
    await failOnce(app, 'collections:removeItems');
    await dragTo(page, rowByTitle(page, a!.title), 'items', treeRow(page, c6), { key: MOVE_KEY });
    await expect(page.getByTestId('action-error')).toHaveCount(2);
    expect((await members(page, bio)).sort()).toEqual([a!.id, b!.id].sort());
    expect(await members(page, c6)).toEqual([]);
    await expect(page.getByTestId('undo-toast')).toHaveCount(0);

    // A move whose adding main refuses: the removal is put back (the put-back is the next call, which goes through).
    await failOnce(app, 'collections:addItems');
    await dragTo(page, rowByTitle(page, a!.title), 'items', treeRow(page, c6), { key: MOVE_KEY });
    await expect(page.getByTestId('action-error')).toHaveCount(3);
    await expect.poll(async () => (await members(page, bio)).sort()).toEqual([a!.id, b!.id].sort());
    expect(await members(page, c6)).toEqual([]);
    await expect(page.getByTestId('undo-toast')).toHaveCount(0);
  } finally {
    await t.app.close();
  }
});

test('Finder\'s files onto sidebar rows: a collection imports into it, 내 라이브러리 without a collection, the other special views refuse, ⌥ links, and a held window ignores it', async ({}, testInfo) => {
  const t = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const { page, app } = t;
    await importPaths(page, [KO_PDF]);
    const bio = await createCollection(page, '가져오기 시험');
    const c6 = await createCollection(page, '가져올 장', bio);
    await open(page, bio);
    await treeRow(page, bio).click();
    const overlay = page.getByTestId('drop-overlay');
    const content = page.getByTestId('content');

    // From the table into the sidebar: the overlay yields, the collection row is the target; the unfiled view takes nothing.
    const mp4 = await finderDrag(page, MP4);
    await mp4.send('dragEnter', content);
    await mp4.send('dragOver', content);
    await expect(overlay).toBeVisible();
    await mp4.send('dragOver', treeRow(page, c6));
    await expect(overlay).toHaveCount(0);
    expect(await marked(page)).toEqual([`nav-collection-${c6}`]);
    await mp4.send('dragOver', specialRow(page, 'unfiled'));
    expect(await marked(page), 'a special view').toEqual([]);
    await mp4.send('dragOver', specialRow(page, 'all'));
    expect(await marked(page), '내 라이브러리 is a target of its own').toEqual(['nav-scope-all']);
    await mp4.send('dragOver', treeRow(page, c6));
    await mp4.send('drop', treeRow(page, c6));
    await expect(page.getByTestId('import-done').last()).toContainText('가져올 장');
    await expect.poll(() => libraryCount(page)).toBe(2);
    expect(await members(page, c6)).toHaveLength(1);
    await mp4.close();

    // 내 라이브러리: imported, and in no collection although a collection is viewed.
    const mp4b = await finderDrag(page, MP4_B);
    await mp4b.send('dragEnter', content);
    await mp4b.send('dragOver', specialRow(page, 'all'));
    await mp4b.send('drop', specialRow(page, 'all'));
    await expect.poll(() => libraryCount(page)).toBe(3);
    expect(await members(page, bio)).toHaveLength(0);
    expect(await members(page, c6)).toHaveLength(1);
    await mp4b.close();

    // ⌥ links the original instead of copying it (the cursor badge of ⌥ over a row on macOS is React Aria's, on the real-Mac list).
    const pdf = await finderDrag(page, PDF);
    await pdf.send('dragEnter', content);
    await pdf.send('dragOver', treeRow(page, c6), { alt: true });
    await pdf.send('drop', treeRow(page, c6), { alt: true });
    await expect(page.getByTestId('import-done').filter({ hasText: '연결했습니다' })).toBeVisible();
    const modes = () => page.evaluate(async () => (await window.learn.library.list().then((r) => (r.ok ? r.data.map((i) => i.storageMode).sort() : []))));
    await expect.poll(async () => (await modes()).join()).toBe('linked,managed,managed,managed');
    await pdf.close();

    // A sheet holds the window: no drag starts from a row, and Finder's files get no marker and import nothing.
    const sheet = await expectWindow(app, 'sheet', () => runMenuCommand(app, 'app.shortcuts'));
    const before = await libraryCount(page);
    const again = await finderDrag(page, KO_PDF);
    await again.send('dragEnter', content);
    await again.send('dragOver', treeRow(page, c6));
    expect(await marked(page)).toEqual([]);
    await again.send('drop', treeRow(page, c6));
    await page.waitForTimeout(500);
    expect(await libraryCount(page)).toBe(before);
    await again.close();
    // A row cannot be dragged either while the window is held.
    const p = await point(page.locator('[data-testid="item-row"]').first());
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x + 8, p.y + 5, { steps: 3 });
    await frames(page, 2);
    await expect(page.locator('html')).not.toHaveAttribute('data-dnd');
    await page.mouse.up();
    await closeSheet(sheet, 'Escape');
  } finally {
    await t.app.close();
  }
});

test('the window overlay covers only the area right of the sidebar, and all of the window when the sidebar is hidden', async ({}, testInfo) => {
  const t = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const { page, app } = t;
    await importPaths(page, [KO_PDF]);
    const overlay = page.getByTestId('drop-overlay');
    const content = page.getByTestId('content');
    const finder = await finderDrag(page, MP4);

    await finder.send('dragEnter', content);
    await expect(overlay).toBeVisible();
    const side = (await page.locator('[data-sidebar-area]').boundingBox())!;
    const box = (await overlay.boundingBox())!;
    expect(Math.abs(box.x - (side.x + side.width)), 'starts at the sidebar\'s right edge').toBeLessThanOrEqual(1);
    expect(box.y).toBe(52);
    expect(box.x + box.width).toBeCloseTo(await page.evaluate(() => innerWidth), 0);
    // The sidebar keeps its own part of the window: over its top (traffic lights, toggle) there is no overlay.
    await finder.send('dragOver', page.getByTestId('sidebar-top'));
    await expect(overlay).toHaveCount(0);
    await finder.cancel();
    // A drag that comes into the window over the sidebar gets no overlay at all.
    const sidebarBody = page.locator('[data-pane="sidebar"]');
    await finder.send('dragEnter', sidebarBody);
    await finder.send('dragOver', sidebarBody);
    await expect(overlay).toHaveCount(0);
    await finder.cancel();
    // The sidebar's foot (the tag selector) is inside the sidebar column and is no drop target: no overlay there either, and a drop does nothing.
    await createTag(page, '오버레이 태그');
    const foot = page.getByTestId('tag-selector');
    const before = await libraryCount(page);
    await finder.send('dragEnter', foot);
    await finder.send('dragOver', foot);
    await expect(overlay).toHaveCount(0);
    await finder.send('drop', foot);
    await page.waitForTimeout(2000);
    expect(await libraryCount(page)).toBe(before);
    await finder.cancel();
    await finder.send('dragEnter', content);
    await finder.send('dragOver', content);
    await expect(overlay).toBeVisible();
    await finder.cancel();
    await expect(overlay).toHaveCount(0);

    await runMenuCommand(app, 'view.toggleSidebar');
    await expect(page.getByTestId('shell')).toHaveAttribute('data-sidebar', 'hidden');
    await finder.send('dragEnter', content);
    await expect(overlay).toBeVisible();
    expect((await overlay.boundingBox())!.x, 'with no sidebar it is the whole window as before').toBe(0);
    await finder.cancel();
    await finder.close();
  } finally {
    await t.app.close();
  }
});

test('the row being named takes no part in drag and drop: Finder\'s files get no marker over it and import nothing (the rule for rows, collections and tags is in rules.test)', async ({}, testInfo) => {
  const t = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const { page } = t;
    await importPaths(page, [PDF]);
    const named = await createCollection(page, '이름 짓기 통계');
    const other = await createCollection(page, '이름 짓기 다른');
    const content = page.getByTestId('content');
    await treeRow(page, named).click();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('rename-input')).toBeFocused();

    const files = await finderDrag(page, MP4);
    await files.send('dragEnter', content);
    await files.send('dragOver', treeRow(page, other));
    expect(await marked(page), 'a row that is not being named takes files').toEqual([`nav-collection-${other}`]);
    await files.send('dragOver', treeRow(page, named));
    expect(await marked(page), `the row being named takes none (named ${named}, other ${other})`).toEqual([]);
    await files.send('drop', treeRow(page, named));
    await page.waitForTimeout(500);
    expect(await libraryCount(page), 'and imports nothing').toBe(1);
    await files.cancel();
    await files.close();
    await expect(page.getByTestId('rename-input'), 'the drag did not end the naming').toBeFocused();
  } finally {
    await t.app.close();
  }
});

test('a click on a chevron leaves the tree\'s cursor on the viewed row: Tab out of the tree and back lands there', async ({}, testInfo) => {
  const t = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const { page } = t;
    await importPaths(page, [PDF]);
    const bio = await createCollection(page, '쐐기 분자생물학');
    await createCollection(page, '쐐기 장', bio);
    const stat = await createCollection(page, '쐐기 통계');
    await treeRow(page, stat).click();
    await expect(treeRow(page, stat)).toHaveAttribute('aria-selected', 'true');
    await open(page, bio);
    await expect(treeRow(page, stat), 'the chevron did not change the view').toHaveAttribute('aria-selected', 'true');
    await page.waitForTimeout(100);
    // Out of the tree by Tab, and back by Shift+Tab: the first stop in the tree is the viewed row, not the row whose chevron was pressed.
    await page.keyboard.press('Tab');
    await expect.poll(() => page.evaluate(() => document.activeElement?.closest('[data-testid="sidebar-tree"]') === null)).toBe(true);
    await page.keyboard.press('Shift+Tab');
    await expect(treeRow(page, stat)).toBeFocused();
  } finally {
    await t.app.close();
  }
});

// ---- the tree under its Virtualizer (c–f) ----------------------------------------------------------------------

test.describe('a tree of 120 collections under the Virtualizer', () => {
  test.describe.configure({ mode: 'serial' });
  let s: Session;
  let tree: Awaited<ReturnType<typeof createCollectionTree>>;
  let item: Awaited<ReturnType<typeof importPaths>>[number] | undefined;
  const parentOf = async (id: string) => (await organizeSnapshot(s.page)).collections.find((c) => c.id === id)!.parentId;
  const treeBox = () => s.page.getByTestId('sidebar-tree');

  test.beforeAll(async ({}, testInfo) => {
    s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
    [item] = await importPaths(s.page, [PDF]);
    await seedLibrary(s.app, { count: 300, from: item! });
    tree = await createCollectionTree(s.page, 120);
    await expandAll(s.page, tree);
    await specialRow(s.page, 'all').click();
    // Sixty rows at most are drawn although 120 collections are open: the tree is virtual.
    expect(await s.page.locator('[data-testid^="nav-collection-"]').count()).toBeLessThan(60);
  });
  test.afterAll(async () => {
    await s?.app.close();
  });

  test('(c) keyboard drag: ⌥→ (or → on a leaf) reaches the row\'s drag button; ↩, ↓…, ↩ moves a collection; esc cancels; the 컬렉션 heading is a stop (Tab)', async () => {
    const { page } = s;
    const leaf = tree.ids[40]!; // under 과목 008
    const target = tree.ids[9]!; // 과목 009, a neighbour of its parent
    await treeRow(page, leaf).click();
    await page.keyboard.press('ArrowRight'); // a leaf: React Aria's own → goes into the row's buttons
    await expect(page.getByTestId(`drag-handle-${leaf}`)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-dnd', 'collection');
    let found = false;
    for (let i = 0; i < 40 && !found; i++) {
      await page.keyboard.press('ArrowDown');
      await frames(page, 2);
      found = (await marked(page)).includes(`nav-collection-${target}`);
    }
    expect(found, 'the arrows reach 과목 009').toBe(true);
    await page.keyboard.press('Enter');
    await expect.poll(() => parentOf(leaf)).toBe(target);
    await expect(page.locator('html')).not.toHaveAttribute('data-dnd');

    // A collection with children: → opens or enters it, ⌥→ is the way to its drag button. esc ends the drag.
    const parent = tree.ids[8]!;
    await treeRow(page, parent).click();
    await page.keyboard.press('Alt+ArrowRight');
    await expect(page.getByTestId(`drag-handle-${parent}`)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-dnd', 'collection');
    await page.keyboard.press('Escape');
    await expect(page.locator('html')).not.toHaveAttribute('data-dnd');
    expect(await parentOf(parent)).toBe(tree.ids[0]);

    // The heading is a drop target of the keyboard drag too (it is a plain drop target of its own): Tab goes from one drop target to the
    // next (the tree, the heading), the arrows move inside the target that has the drag.
    const nested = tree.ids[41]!;
    await treeRow(page, nested).click();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    let atHeading = false;
    for (const key of ['Tab', 'Shift+Tab']) {
      for (let i = 0; i < 4 && !atHeading; i++) {
        await page.keyboard.press(key);
        await frames(page, 2);
        atHeading = (await marked(page)).includes('collections-heading-drop');
      }
      if (atHeading) break;
    }
    expect(atHeading, 'Tab reaches the 컬렉션 heading').toBe(true);
    await page.keyboard.press('Enter');
    await expect.poll(() => parentOf(nested)).toBeNull();
  });

  test('(d) spring-loading opens a collapsed row after about 800 ms of rest, and the tree scrolls by itself at its top and bottom edge', async () => {
    const { page } = s;
    const parent = tree.ids[0]!;
    await specialRow(page, 'all').click();
    await treeRow(page, parent).locator('.disclosure').click();
    await expect(treeRow(page, parent)).toHaveAttribute('aria-expanded', 'false');
    const [row] = await page.locator('[data-testid="item-row"]').all();
    await beginDrag(page, row!, 'items');
    await hover(page, treeRow(page, parent));
    await page.waitForTimeout(400);
    await expect(treeRow(page, parent), 'not yet at 400 ms').toHaveAttribute('aria-expanded', 'false');
    await expect(treeRow(page, parent)).toHaveAttribute('aria-expanded', 'true', { timeout: 1500 });
    await expect(treeRow(page, tree.children[parent]![0]!), 'its children are drawn').toBeVisible();

    // Edge autoscroll: the band is React Aria's 20 px. The pointer rests 10 px inside the edge and moves a pixel now and then.
    const scrollTop = () => treeBox().evaluate((e) => e.scrollTop);
    const box = (await treeBox().boundingBox())!;
    const hold = async (y: number) => {
      await page.mouse.move(box.x + 100, y, { steps: 4 });
      for (let i = 0; i < 24; i++) {
        await page.mouse.move(box.x + 100 + (i % 2) * 4, y);
        await page.waitForTimeout(40);
      }
    };
    const start = await scrollTop();
    await hold(box.y + box.height - 10);
    const down = await scrollTop();
    expect(down, 'scrolled down at the bottom edge').toBeGreaterThan(start);
    await hold(box.y + 10);
    expect(await scrollTop(), 'and back up at the top edge').toBeLessThan(down);
    await cancelDrag(page);
  });

  test('(e) a collection row is one drop target over its whole height, and no between-rows marker is ever drawn', async () => {
    const { page } = s;
    const rowId = tree.ids[9]!; // one of the first rows: drawn
    await specialRow(page, 'all').click();
    const [first] = await page.locator('[data-testid="item-row"]').all();
    await beginDrag(page, first!, 'items');
    const row = treeRow(page, rowId);
    const box = (await row.boundingBox())!;
    const samples: Array<{ dy: number; marks: string[] }> = [];
    await page.mouse.move(box.x + 60, box.y - 20, { steps: 3 });
    for (let dy = -6; dy <= box.height + 6; dy += 2) {
      await page.mouse.move(box.x + 60, box.y + dy, { steps: 2 });
      await page.mouse.move(box.x + 61, box.y + dy);
      await frames(page, 2);
      samples.push({ dy, marks: await marked(page) });
      expect(await page.locator('.react-aria-DropIndicator').count(), `no between marker at ${dy}`).toBe(0);
    }
    const inner = samples.filter((p) => p.dy >= 4 && p.dy < box.height - 4);
    const onRow = inner.filter((p) => p.marks.length === 1 && p.marks[0] === `nav-collection-${rowId}`).length;
    expect(onRow / inner.length, 'the row is the target over its inner height').toBeGreaterThanOrEqual(0.95);
    await cancelDrag(page);
  });

  test('(f) the drag goes on when its source row leaves the tree, and a drop after the table scrolled is delivered: nothing is left marked', async () => {
    const { page } = s;
    const src = tree.ids[44]!; // under 과목 009, near the top
    await treeBox().evaluate((e) => void (e.scrollTop = 0));
    const inViewIds = async (): Promise<string[]> => {
      const view = (await treeBox().boundingBox())!;
      const ids: string[] = [];
      for (const row of await page.locator('[data-testid^="nav-collection-"]').all()) {
        const box = await row.boundingBox();
        if (box && box.y >= view.y && box.y + box.height <= view.y + view.height) ids.push((await row.getAttribute('data-testid'))!.replace('nav-collection-', ''));
      }
      return ids;
    };
    // A collection in view with no children: moved under it, the source is below a folded row.
    let folded = '';
    for (const id of await inViewIds()) {
      if (id !== src && (await treeRow(page, id).getAttribute('aria-expanded')) === null) folded = id;
    }
    expect(folded, 'a leaf is in view').not.toBe('');
    await beginDrag(page, treeRow(page, src), 'collection');
    // The source goes under that folded leaf while it is dragged, so its row is taken out of the tree, as a scroll takes it out
    // of the virtual window. (A scroll cannot stand in here: a tree that is scrolled while a drag runs under Playwright is not
    // redrawn, and the keys do not reach the page — the Mac list has the real hand's autoscroll.)
    await page.evaluate((input) => window.learn.collections.move(input), { collectionId: src, parentId: folded });
    await expect(treeRow(page, src)).toHaveCount(0);
    await expect(page.locator('html')).toHaveAttribute('data-dnd', 'collection');
    // A row from the middle of those in view, not the folded leaf (the source is there already).
    const inView = await inViewIds();
    const candidates = inView.filter((id) => id !== folded && id !== src);
    const targetId = candidates[Math.floor(candidates.length / 2)]!;
    await hover(page, treeRow(page, targetId));
    expect(await marked(page)).toEqual([`nav-collection-${targetId}`]);
    await release(page);
    await expect.poll(() => parentOf(src)).toBe(targetId);
    await expect(page.locator('html')).not.toHaveAttribute('data-dnd');
    await expect(page.locator('[data-drop-target]')).toHaveCount(0);

    // The table's side: 300 rows scrolled while the drag runs. The virtualizer keeps a dragged row mounted, so the source does not leave
    // the page here; what is pinned is that a drop on a collection row after the scroll is delivered.
    await specialRow(page, 'all').click();
    await treeBox().evaluate((e) => void (e.scrollTop = 0));
    const row = page.locator('[data-testid="item-row"]').nth(5);
    const id = (await row.getAttribute('data-item-id'))!;
    await beginDrag(page, row, 'items');
    await page.getByTestId('library-table').evaluate((e) => void (e.scrollTop = 6000));
    await frames(page, 4);
    const to = (await page.locator('[data-testid^="nav-collection-"]').nth(2).getAttribute('data-testid'))!.replace('nav-collection-', '');
    await hover(page, treeRow(page, to));
    await release(page);
    await expect.poll(() => members(page, to)).toContain(id);
    await expect(page.locator('html')).not.toHaveAttribute('data-dnd');
  });
  test('(g) after a mouse drop on a row far from the viewed one the tree has not scrolled, no row shows a keyboard ring, and the next key acts at once', async () => {
    const { page } = s;
    await specialRow(page, 'all').click();
    await expect(specialRow(page, 'all')).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('library-table').evaluate((e) => void (e.scrollTop = 0));
    await treeBox().evaluate((e) => void (e.scrollTop = 1500));
    await frames(page, 4);
    const view = (await treeBox().boundingBox())!;
    const ids: string[] = [];
    for (const row of await page.locator('[data-testid^="nav-collection-"]').all()) {
      const box = await row.boundingBox();
      if (box && box.y >= view.y + 10 && box.y + box.height <= view.y + view.height - 10) ids.push((await row.getAttribute('data-testid'))!.replace('nav-collection-', ''));
    }
    const to = ids[Math.floor(ids.length / 2)]!;
    const before = await treeBox().evaluate((e) => e.scrollTop);
    expect(before, 'the viewed row is out of sight').toBeGreaterThan(1000);
    const row = page.locator('[data-testid="item-row"]').nth(3);
    const id = (await row.getAttribute('data-item-id'))!;
    await dragTo(page, row, 'items', treeRow(page, to));
    await expect.poll(() => members(page, to)).toContain(id);
    await page.waitForTimeout(300); // React Aria moves its focus about 50 ms after the drop
    expect(await treeBox().evaluate((e) => e.scrollTop), 'the tree did not scroll back to the viewed row').toBe(before);
    expect(await page.locator('[data-focus-visible]').count(), 'no row shows a keyboard ring after a mouse drop').toBe(0);
    await expect(specialRow(page, 'all'), 'the view stays').toHaveAttribute('aria-selected', 'true');
    // The key is the user's own, however soon: the cursor is on the viewed row, so ↓ goes to the next special view and the view follows.
    await page.keyboard.press('ArrowDown');
    await expect(specialRow(page, 'unfiled')).toHaveAttribute('aria-selected', 'true');
  });
  test('(h) the tree is as tall as its rows: scrolled to its end it draws the last rows', async () => {
    const { page } = s;
    await specialRow(page, 'all').click();
    await treeBox().evaluate((e) => void (e.scrollTop = 0));
    await frames(page, 3);
    const specials = await page.locator('[data-testid^="nav-scope-"]').count();
    const rowHeight = (await specialRow(page, 'all').boundingBox())!.height;
    // The collection rows (all 120 open), the special views and the 컬렉션 heading (36 px, sidebar/layout.ts).
    const expected = (specials + tree.ids.length) * rowHeight + 36;
    const total = await treeBox().evaluate((e) => e.scrollHeight);
    expect(Math.abs(total - expected), `scrollHeight ${total} for about ${expected}`).toBeLessThanOrEqual(rowHeight);

    await treeBox().evaluate((e) => void (e.scrollTop = e.scrollHeight));
    await frames(page, 4);
    const end = await treeBox().evaluate((e) => ({ top: e.scrollTop, height: e.clientHeight, size: e.scrollHeight }));
    const drawn = await page.locator('[data-testid^="nav-collection-"]').evaluateAll((rows) => rows.map((r) => r.getBoundingClientRect().bottom));
    const box = (await treeBox().boundingBox())!;
    expect(drawn.length, 'rows are drawn at the end').toBeGreaterThanOrEqual(Math.floor(end.height / rowHeight) - 2);
    expect(box.y + box.height - Math.max(...drawn), 'the last row ends at the tree\'s bottom').toBeLessThanOrEqual(rowHeight);
  });
});
