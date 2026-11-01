// The trash's data through the real app, before any screen draws it: the trash view and the sidebar's count, 영구 삭제
// removing the library's copy after its commit while a linked original stays as it was, 휴지통 비우기, and 하나만 남기고
// 휴지통으로 with its undo. Everything goes through the page's preload API (window.learn), as the screens will call it.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { KeepOneResult, KeepOneUndo, LibraryItem, PurgedRows, TrashView } from '../../packages/domain/src/library';
import {
  FIXTURES, addToCollection, assignTag, createCollection, createTag, distinctPdfs, importPaths, launch, organizeSnapshot, seedLibrary, trashItems,
} from './helpers';

const dirs = (i: { outputPath(...p: string[]): string }) => [i.outputPath('library'), i.outputPath('userdata')] as const;

test.beforeAll(() => {
  if (!fs.existsSync(path.join(FIXTURES, 'sample.pdf'))) throw new Error('fixture missing: sample.pdf — run `pnpm fixtures`');
});

/** One call of the page's API that must succeed. */
async function learn<T>(page: Page, call: (input: unknown) => Promise<{ ok: true; data: T } | { ok: false; code: string }>, input?: unknown): Promise<T> {
  const r = await page.evaluate(call, input);
  if (!r.ok) throw new Error(`call failed: ${r.code}`);
  return r.data;
}
const list = (page: Page) => learn<LibraryItem[]>(page, () => window.learn.library.list());
const trashView = (page: Page) => learn<TrashView>(page, () => window.learn.library.trashView());
const shaOf = async (page: Page, itemId: string) => (await learn<{ file: { sha256: string } }>(page, (i) => window.learn.library.detail(i as { itemId: string }), { itemId })).file.sha256;

test('the trash view and its count; 영구 삭제 removes the copy after the commit and never a linked original; 휴지통 비우기 takes the rest', async ({}, testInfo) => {
  const [lib, ud] = dirs(testInfo);
  const src = testInfo.outputPath('src');
  const s = await launch(lib, ud);
  try {
    const [a, b] = await importPaths(s.page, distinctPdfs(src, 2));
    const original = path.join(src, 'linked original.pdf');
    fs.copyFileSync(path.join(FIXTURES, 'sample.pdf'), original);
    const before = fs.readFileSync(original);
    const [linked] = (await importPaths(s.page, [original], { mode: 'linked' })) as [LibraryItem];
    expect(linked).toMatchObject({ storageMode: 'linked' });
    const sha = await shaOf(s.page, a!.id);
    const copy = path.join(lib, 'assets', sha.slice(0, 2), sha);
    expect(fs.existsSync(copy)).toBe(true);
    const lecture = await createCollection(s.page, '강의');
    await addToCollection(s.page, lecture, [a!.id]);

    expect(await trashItems(s.page, [a!.id, linked.id])).toBe(2);
    await learn(s.page, (i) => window.learn.collections.remove(i as { collectionId: string }), { collectionId: lecture });
    const view = await trashView(s.page);
    expect(view.items.map((i) => i.id).sort()).toEqual([a!.id, linked.id].sort());
    expect(view.items.every((i) => /^\d{4}-\d{2}-\d{2}T/.test(i.deletedAt))).toBe(true);
    expect(view.collections.map((c) => [c.name, c.itemCount])).toEqual([['강의', 0]]); // a is in the trash: not counted
    expect((await organizeSnapshot(s.page)).trashCount).toBe(3);

    const purged = await learn<PurgedRows>(s.page, (i) => window.learn.library.purge(i as { itemIds: string[]; collectionIds: string[] }), {
      itemIds: [a!.id, linked.id, b!.id], // b is live: left alone
      collectionIds: [],
    });
    expect(purged.itemIds.sort()).toEqual([a!.id, linked.id].sort());
    await expect.poll(() => fs.existsSync(copy), { message: 'the managed copy goes after the commit' }).toBe(false);
    expect(fs.readFileSync(original)).toEqual(before);
    expect((await list(s.page)).map((i) => i.id)).toEqual([b!.id]);
    expect((await organizeSnapshot(s.page)).trashCount).toBe(1); // the collection row

    await trashItems(s.page, [b!.id]);
    const emptied = await learn<PurgedRows>(s.page, () => window.learn.library.emptyTrash());
    expect(emptied).toEqual({ itemIds: [b!.id], collectionIds: [lecture] });
    expect(await trashView(s.page)).toEqual({ collections: [], items: [] });
    expect((await organizeSnapshot(s.page)).trashCount).toBe(0);
    expect(fs.readFileSync(original)).toEqual(before);
  } finally {
    await s.app.close();
  }
});

test('하나만 남기고 휴지통으로 keeps the item imported first and gives it the others\' collections and tags; the undo puts every one back', async ({}, testInfo) => {
  const [lib, ud] = dirs(testInfo);
  const s = await launch(lib, ud);
  try {
    const [imported] = await importPaths(s.page, [path.join(FIXTURES, 'sample.pdf')]);
    await seedLibrary(s.app, { count: 3, from: imported! }); // the same file, "imported" earlier (seedRows' clock)
    const group = (await organizeSnapshot(s.page)).duplicates;
    expect(group.map((g) => g.length)).toEqual([4]);
    const first = (await list(s.page)).sort((x, y) => x.createdAt.localeCompare(y.createdAt) || x.id.localeCompare(y.id))[0]!;
    const exam = await createCollection(s.page, '시험 범위');
    await addToCollection(s.page, exam, [imported!.id]);
    const important = await createTag(s.page, '중요');
    await assignTag(s.page, important, [imported!.id]);

    const result = await learn<KeepOneResult>(s.page, (i) => window.learn.library.keepOneOfDuplicates(i as { itemIds: string[] }), { itemIds: [imported!.id] });
    expect(result.kept).toEqual([first.id]);
    expect(result.trashed).toHaveLength(3);
    expect(result.undo).toMatchObject({ memberships: [[exam, first.id]], tags: [[important, first.id]] });
    const after = await organizeSnapshot(s.page);
    expect(after.duplicates).toEqual([]);
    expect(after.members[exam]).toEqual([first.id]);
    expect(after.tagged[important]).toEqual([first.id]);
    expect(after.trashCount).toBe(3);

    expect(await learn<number>(s.page, (u) => window.learn.library.undoKeepOne(u as KeepOneUndo), result.undo)).toBe(3);
    const back = await organizeSnapshot(s.page);
    expect(back.members[exam]).toEqual([imported!.id]);
    expect(back.tagged[important]).toEqual([imported!.id]);
    expect(back.duplicates.map((g) => [...g].sort())).toEqual(group.map((g) => [...g].sort()));
    expect(back.trashCount).toBe(0);
  } finally {
    await s.app.close();
  }
});
