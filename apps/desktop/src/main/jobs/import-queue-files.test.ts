import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CollectionsRepository, LibraryRepository, migrate, openDatabase, type Db } from '@learn/db';
import { IDLE_IMPORT_STATE, type ImportReport } from '@learn/domain';
import { Importer, ensureLayout, libraryLayout } from '@learn/library';
import { cleanupTemp, tempDir, writePdf } from '../../../../../packages/library/test/helpers';
import { createImportQueue, type DuplicateQuestion, type ImportQueue, type ImportQueueDeps } from './import-queue';
import { createJobLane } from './lane';

const dbs: Db[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const db of dbs.splice(0)) db.close();
  cleanupTemp();
});

function library() {
  const layout = libraryLayout(path.join(tempDir('queue'), 'Library'));
  ensureLayout(layout);
  const db = openDatabase(layout.dbFile);
  dbs.push(db);
  migrate(db, { dbFile: layout.dbFile });
  const repo = new LibraryRepository(db);
  const importer = new Importer({ layout, repo });
  const deps: ImportQueueDeps = {
    lane: createJobLane(),
    importer: () => importer,
    card: (id) => {
      const item = repo.getItem(id);
      return item ? { title: item.title, type: item.type, size: item.size, createdAt: item.createdAt, storageMode: item.storageMode } : null;
    },
    ask: async () => {
      throw new Error('no question expected');
    },
    fileExisting: (collectionId, itemIds) => new CollectionsRepository(db).addItemsChanged(collectionId, itemIds).length,
    announce: () => {},
    warn: () => {},
  };
  return { layout, db, repo, importer, deps };
}
const nextReport = (queue: ImportQueue) =>
  new Promise<ImportReport>((resolve) => {
    const off = queue.onFinished((r) => {
      off();
      resolve(r);
    });
  });
const filesUnder = (dir: string): string[] =>
  fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name);

describe('the queue on a real library (spec 3.5, 15)', () => {
  it('취소 during the second of three files: the first stays, the second leaves no staging copy and no row, the third is never read', async () => {
    const lib = library();
    const queue = createImportQueue(lib.deps);
    const dir = tempDir('src');
    const files = [writePdf(dir, 'a.pdf', 'one'), writePdf(dir, 'b.pdf', 'two'), writePdf(dir, 'c.pdf', 'three')];
    const copyFile = fsp.copyFile;
    const copy = vi.spyOn(fsp, 'copyFile').mockImplementation(async (from, to, mode) => {
      await copyFile(from, to, mode);
      if (String(from).endsWith('b.pdf')) queue.cancel();
    });
    const done = nextReport(queue);
    queue.enqueue({ paths: files, mode: 'managed', collectionId: null, owner: 1 });
    expect(await done).toMatchObject({ imported: 1, requested: 3, cancelled: true, failed: [] });
    expect(copy.mock.calls.map(([from]) => path.basename(String(from)))).toEqual(['a.pdf', 'b.pdf']);
    expect(lib.repo.listItems().map((i) => i.title)).toEqual(['a']);
    expect(lib.repo.counts()).toMatchObject({ items: 1, assets: 1, revisions: 1 });
    expect(fs.readdirSync(lib.layout.stagingDir)).toEqual([]);
    expect(filesUnder(lib.layout.assetsDir)).toHaveLength(1);
    expect(queue.state()).toEqual(IDLE_IMPORT_STATE);
  });

  it('a duplicate the real importer finds is asked at the end; 새 자료로 추가 adds an item sharing the copy, filed into the collection', async () => {
    const lib = library();
    const coll = new CollectionsRepository(lib.db).create({ name: '강의' });
    const dir = tempDir('src');
    const first = await lib.importer.importOne(writePdf(dir, 'a.pdf', 'same'), { mode: 'managed' });
    if (first.status !== 'imported') throw new Error(first.status);
    const questions: DuplicateQuestion[] = [];
    const queue = createImportQueue({
      ...lib.deps,
      ask: async (_owner, q) => {
        questions.push(q);
        return { choice: 'add', applyToRest: false, askedOn: 1 };
      },
    });
    const done = nextReport(queue);
    queue.enqueue({ paths: [writePdf(dir, 'again.pdf', 'same'), writePdf(dir, 'new.pdf', 'new')], mode: 'managed', collectionId: coll.id, owner: 1 });
    expect(await done).toMatchObject({ imported: 2, filed: 2, requested: 2, cancelled: false, collectionId: coll.id });
    expect(questions).toEqual([{ fileName: 'again.pdf', existing: expect.objectContaining({ title: 'a' }), remaining: 0 }]);
    expect(lib.repo.counts()).toMatchObject({ items: 3, assets: 2, collectionItems: 2 });
  });

  it('건너뛰기 in an import into a collection puts the existing item in it', async () => {
    const lib = library();
    const coll = new CollectionsRepository(lib.db).create({ name: '학회 준비' });
    const dir = tempDir('src');
    const first = await lib.importer.importOne(writePdf(dir, 'a.pdf', 'same'), { mode: 'managed' });
    if (first.status !== 'imported') throw new Error(first.status);
    const queue = createImportQueue({ ...lib.deps, ask: async () => ({ choice: 'skip', applyToRest: false, askedOn: 1 }) });
    const done = nextReport(queue);
    queue.enqueue({ paths: [writePdf(dir, 'again.pdf', 'same')], mode: 'managed', collectionId: coll.id, owner: 1 });
    expect(await done).toMatchObject({ imported: 0, filedExisting: 1, requested: 1 });
    expect(new CollectionsRepository(lib.db).membershipsOf(first.item.id).map((c) => c.id)).toEqual([coll.id]);
  });
});
