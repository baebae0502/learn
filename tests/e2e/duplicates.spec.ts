// M6 중복 정리 (spec 5): 하나만 남기고 휴지통으로 (the 중복 항목 row menu, the palette) and 중복 N묶음 모두 정리 (the view's
// button, the palette); the 남김 mark, the rows grouped whatever the sort with a line between groups, and 실행 취소 that
// undoes the trash and the merge together.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { LibraryItem } from '../../packages/domain/src/library';
import { expectNoSeriousA11y } from './a11y';
import {
  FIXTURES, addToCollection, assignTag, createCollection, createTag, distinctPdfs, importPaths, launch, organizeSnapshot, recordedPopups, runMenuCommand,
  runPalette, specialRow, stubContextMenu,
} from './helpers';

const PDF = path.join(FIXTURES, 'sample.pdf');
const row = (page: Page, id: string) => page.locator(`[data-testid="item-row"][data-item-id="${id}"]`);
/** The rows' ids in table order (data-index: a virtual body may hold its rows in any DOM order). */
const rowIds = (page: Page) =>
  page.getByTestId('item-row').evaluateAll((rows) =>
    rows
      .map((r) => [Number((r as HTMLElement).dataset['index']), (r as HTMLElement).dataset['itemId']!] as const)
      .sort((a, b) => a[0] - b[0])
      .map(([, id]) => id));
async function liveIds(page: Page): Promise<string[]> {
  const r = await page.evaluate(() => window.learn.library.list());
  if (!r.ok) throw new Error(`library.list failed: ${r.code}`);
  return r.data.map((i) => i.id).sort();
}
/** The item that stays (spec 5): the earliest import, then the id. */
const earliest = (items: readonly LibraryItem[]): string =>
  [...items].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1))[0]!.id;
/** The table's default sort: 추가일, newest first. */
const newestFirst = (items: readonly LibraryItem[]): string[] => [...items].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map((i) => i.id);

/** Two duplicate groups the default sort interleaves (imported p, q, p, q, p): sample.pdf three times, another PDF twice. */
async function twoGroups(page: Page, dir: string): Promise<{ p: LibraryItem[]; q: LibraryItem[] }> {
  const [other] = distinctPdfs(dir, 1);
  const p = [...(await importPaths(page, [PDF]))];
  const q = [...(await importPaths(page, [other!]))];
  p.push(...(await importPaths(page, [PDF], { allowDuplicate: true })));
  q.push(...(await importPaths(page, [other!], { allowDuplicate: true })));
  p.push(...(await importPaths(page, [PDF], { allowDuplicate: true })));
  return { p, q };
}

test('하나만 남기고 휴지통으로 from a row menu of 중복 항목: the group keeps its earliest import with the collections and tags of the rest, the rows stay grouped with 남김, and 실행 취소 undoes both', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const { p, q } = await twoGroups(page, testInfo.outputPath('in'));
    const keepP = earliest(p);
    const keepQ = earliest(q);
    const [goes1, goes2] = p.map((i) => i.id).filter((id) => id !== keepP) as [string, string];
    const coll = await createCollection(page, '강의');
    await addToCollection(page, coll, [goes1]);
    const tag = await createTag(page, '복습');
    await assignTag(page, tag, [goes2]);

    // Outside 중복 항목 the row menu has no such line (absent, not greyed).
    await stubContextMenu(app, null);
    await row(page, goes1).click({ button: 'right' });
    await expect.poll(async () => (await recordedPopups(app)).length).toBe(1);
    expect((await recordedPopups(app))[0]!.map((i) => i.label)).not.toContain('하나만 남기고 휴지통으로');

    await specialRow(page, 'duplicates').click();
    await expect(page.getByTestId('item-row')).toHaveCount(5);
    // Grouped whatever the sort: the group of the newest row first, each group newest first; one line, above q's first row.
    await expect.poll(() => rowIds(page)).toEqual([...newestFirst(p), ...newestFirst(q)]);
    await expect(page.locator('[data-testid="item-row"][data-group-start]')).toHaveCount(1);
    await expect(row(page, newestFirst(q)[0]!)).toHaveAttribute('data-group-start', 'true');
    const top = async (id: string) => Math.round((await row(page, id).boundingBox())!.y);
    const [p3, p2, p1] = newestFirst(p) as [string, string, string];
    const step = (await top(p2)) - (await top(p3));
    expect((await top(newestFirst(q)[0]!)) - (await top(p1))).toBe(step + 9); // the 4 + 1 + 4 px gap of the line
    // 남김 on the earliest of each group, nowhere else; two groups: the view's button.
    await expect(page.getByTestId('kept-mark')).toHaveCount(2);
    for (const id of [keepP, keepQ]) await expect(row(page, id).getByTestId('kept-mark')).toHaveText('남김');
    await expect(page.getByTestId('keep-all-duplicates')).toHaveText('중복 2묶음 모두 정리');
    await expectNoSeriousA11y(page, 'the duplicates view with 남김, the group line and 모두 정리');

    await stubContextMenu(app, '하나만 남기고 휴지통으로');
    await row(page, goes1).click({ button: 'right' });
    await expect(page.getByTestId('undo-toast')).toContainText('중복 항목 2개를 휴지통으로 옮겼습니다');
    // The line sits in the menu's last group, right before 휴지통으로 이동 (design-spec 7.3: what moves to the trash is last).
    const menu = (await recordedPopups(app)).at(-1)!;
    const at = menu.findIndex((i) => i.label === '하나만 남기고 휴지통으로');
    expect(menu[at - 1]!.type).toBe('separator');
    expect(menu[at + 1]!.label).toBe('휴지통으로 이동');
    // The other group is left: the view stays with its two rows, and one group needs no button.
    await expect(page.getByTestId('item-row')).toHaveCount(2);
    await expect(specialRow(page, 'duplicates')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('keep-all-duplicates')).toHaveCount(0);
    expect(await liveIds(page)).toEqual([keepP, ...q.map((i) => i.id)].sort());
    let snapshot = await organizeSnapshot(page);
    expect(snapshot.members[coll]).toEqual([keepP]);
    expect(snapshot.tagged[tag]).toEqual([keepP]);

    // 실행 취소: both back, and the kept one loses what the clean-up gave it (it had neither before).
    await page.getByTestId('undo-action').click();
    await expect(page.getByTestId('undo-toast')).toHaveCount(0);
    await expect(page.getByTestId('item-row')).toHaveCount(5);
    snapshot = await organizeSnapshot(page);
    expect(snapshot.members[coll]).toEqual([goes1]);
    expect(snapshot.tagged[tag]).toEqual([goes2]);
  } finally {
    await app.close();
  }
});

test('중복 N묶음 모두 정리 from the view button and the palette: every group keeps its earliest, the view goes to 내 라이브러리 once none is left, and 실행 취소 brings the rows back', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const { p, q } = await twoGroups(page, testInfo.outputPath('in'));
    const kept = [earliest(p), earliest(q)].sort();

    await specialRow(page, 'duplicates').click();
    await page.getByTestId('keep-all-duplicates').click();
    await expect(page.getByTestId('undo-toast')).toContainText('중복 항목 3개를 휴지통으로 옮겼습니다');
    await expect(specialRow(page, 'all')).toHaveAttribute('aria-selected', 'true');
    await expect(specialRow(page, 'duplicates')).toHaveCount(0);
    await expect(page.getByTestId('item-row')).toHaveCount(2);
    expect(await liveIds(page)).toEqual(kept);
    await page.getByTestId('undo-action').click();
    await expect(page.getByTestId('undo-toast')).toHaveCount(0);
    await expect(page.getByTestId('item-row')).toHaveCount(5);
    await expect(specialRow(page, 'duplicates')).toBeVisible();
    await expect(specialRow(page, 'all')).toHaveAttribute('aria-selected', 'true'); // the undo does not move the view back

    // From 내 라이브러리, the palette: named with the count; the row command is not offered outside 중복 항목.
    await page.getByTestId('item-row').first().click();
    await runMenuCommand(app, 'app.palette');
    await page.getByTestId('palette-input').fill('중복');
    await expect(page.locator('[data-testid="palette-item"][data-command-id="duplicates.keepOneAll"]')).toContainText('중복 2묶음 모두 정리');
    await expect(page.locator('[data-testid="palette-item"][data-command-id="duplicates.keepOne"]')).toHaveCount(0);
    await page.locator('[data-testid="palette-item"][data-command-id="duplicates.keepOneAll"]').click();
    await expect(page.getByTestId('undo-toast')).toContainText('중복 항목 3개를 휴지통으로 옮겼습니다');
    await expect(specialRow(page, 'all')).toHaveAttribute('aria-selected', 'true');
    expect(await liveIds(page)).toEqual(kept);
    await page.getByTestId('undo-action').click();
    await expect(page.getByTestId('item-row')).toHaveCount(5);

    // In 중복 항목 with a row of q selected, the palette cleans q's group only: p's group is left, so the view stays.
    await specialRow(page, 'duplicates').click();
    await row(page, newestFirst(q)[0]!).click();
    await runPalette(page, app, '하나만', 'duplicates.keepOne');
    await expect(page.getByTestId('undo-toast')).toContainText('중복 항목 1개를 휴지통으로 옮겼습니다');
    await expect(page.getByTestId('item-row')).toHaveCount(3);
    await expect(specialRow(page, 'duplicates')).toHaveAttribute('aria-selected', 'true');
  } finally {
    await app.close();
  }
});
