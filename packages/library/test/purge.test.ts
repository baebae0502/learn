import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LibraryRepository, migrate, openDatabase, type Db, type PurgedAsset } from '@learn/db';
import { Importer, ensureLayout, isAside, libraryLayout, openableFile, removePurgedFiles, resolveAssetPath, type ImportHooks } from '../src/index';
import { cleanupTemp, tempDir, writePdf } from './helpers';

const dbs: Db[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  cleanupTemp();
});

function setup(hooks?: ImportHooks) {
  const layout = libraryLayout(path.join(tempDir(), 'Library'));
  ensureLayout(layout);
  const db = openDatabase(layout.dbFile);
  dbs.push(db);
  migrate(db, { dbFile: layout.dbFile });
  const repo = new LibraryRepository(db);
  return { layout, db, repo, importer: new Importer({ layout, repo, hooks }) };
}
type Lib = ReturnType<typeof setup>;

async function imported(lib: Lib, file: string, mode: 'managed' | 'linked' = 'managed', allowDuplicate = false) {
  const out = await lib.importer.importOne(file, { mode, allowDuplicate });
  if (out.status !== 'imported') throw new Error(`import: ${out.status}`);
  const asset = lib.repo.getAsset(out.item.assetId)!;
  return { item: out.item, asset, stored: resolveAssetPath(lib.layout, asset) };
}
/** The named copy 기본 앱으로 열기 makes (derived/open/<assetId>/<title>.pdf). */
const namedCopy = (lib: Lib, x: Awaited<ReturnType<typeof imported>>) => openableFile(lib.layout, x.asset, x.item.title, x.stored);
const purged = (lib: Lib, itemIds: string[]) => {
  lib.repo.trash(itemIds);
  return lib.repo.purge({ itemIds, collectionIds: [] }).assets;
};
const openDir = (lib: Lib, assetId: string) => path.join(lib.layout.derivedDir, 'open', assetId);

describe('removePurgedFiles (spec 4.5, ADR-0006)', () => {
  it('removes the managed copy, the derived cache and the named copy, and the emptied folder', async () => {
    const lib = setup();
    const x = await imported(lib, writePdf(tempDir('src'), '세포 신호.pdf', 'one'));
    const copy = await namedCopy(lib, x);
    const cache = path.join(lib.layout.derivedDir, x.asset.id);
    fs.mkdirSync(cache);
    fs.writeFileSync(path.join(cache, 'pages.json'), '[]');
    fs.writeFileSync(path.join(openDir(lib, x.asset.id), '.DS_Store'), '');

    expect(await removePurgedFiles(lib.layout, purged(lib, [x.item.id]))).toEqual({ failed: 0 });
    expect([x.stored, copy, cache, openDir(lib, x.asset.id)].filter((p) => fs.existsSync(p))).toEqual([]);
    expect(fs.existsSync(lib.layout.assetsDir) && fs.existsSync(path.join(lib.layout.derivedDir, 'open'))).toBe(true);
  });

  it('keeps a copy another item still uses — a trashed one too — and removes it with the last', async () => {
    const lib = setup();
    const file = writePdf(tempDir('src'), 'a.pdf', 'shared');
    const a = await imported(lib, file);
    const b = await imported(lib, file, 'managed', true); // 새 자료로 추가: the same copy
    lib.repo.trash([b.item.id]);
    expect(purged(lib, [a.item.id])).toEqual([]); // b, in the trash, still uses it
    expect(fs.existsSync(a.stored)).toBe(true);
    const assets = lib.repo.purge({ itemIds: [b.item.id], collectionIds: [] }).assets;
    expect(await removePurgedFiles(lib.layout, assets)).toEqual({ failed: 0 });
    expect(fs.existsSync(a.stored)).toBe(false);
  });

  it('never touches a linked original, whatever its name; its named copy goes', async () => {
    const lib = setup();
    const dir = tempDir('src');
    const plain = await imported(lib, writePdf(dir, 'paper.pdf', 'linked one'), 'linked');
    const odd = await imported(lib, writePdf(dir, 'notes.bin', 'linked two'), 'linked'); // a PDF with a misleading extension
    const copy = await namedCopy(lib, odd);
    expect(path.dirname(copy)).toBe(openDir(lib, odd.asset.id));
    const before = [fs.readFileSync(plain.stored), fs.readFileSync(odd.stored)];

    const assets = purged(lib, [plain.item.id, odd.item.id]);
    expect(assets.map((a) => [a.storageMode, a.relativePath])).toEqual([['linked', null], ['linked', null]]);
    expect(await removePurgedFiles(lib.layout, assets)).toEqual({ failed: 0 });
    expect([fs.readFileSync(plain.stored), fs.readFileSync(odd.stored)]).toEqual(before);
    expect(fs.existsSync(copy)).toBe(false);
  });

  it('a linked asset never removes a file under assets/, even one that names a managed path', async () => {
    const lib = setup();
    const managed = await imported(lib, writePdf(tempDir('src'), 'm.pdf', 'managed'));
    const forged: PurgedAsset = { id: '00000000-0000-4000-8000-000000000001', storageMode: 'linked', relativePath: managed.asset.relativePath, size: 1 };
    expect(await removePurgedFiles(lib.layout, [forged])).toEqual({ failed: 0 });
    expect(fs.existsSync(managed.stored)).toBe(true);
  });

  it('keeps the edited copies and their folder: one kept aside, and a named copy edited in place, set aside now', async () => {
    const lib = setup();
    const x = await imported(lib, writePdf(tempDir('src'), '세포 신호.pdf', 'edit me'));
    const copy = await namedCopy(lib, x);
    const dir = path.dirname(copy);
    const aside = path.join(dir, '세포 신호 (수정본 2026-10-30 0900).pdf');
    fs.writeFileSync(aside, 'kept aside before');
    fs.chmodSync(copy, 0o644); // unlocked in another app and saved
    fs.appendFileSync(copy, '\n% my note\n');
    const edited = fs.readFileSync(copy);

    const now = () => new Date(2026, 9, 31, 10, 15);
    expect(await removePurgedFiles(lib.layout, purged(lib, [x.item.id]), { now })).toEqual({ failed: 0 });
    expect(fs.existsSync(x.stored)).toBe(false);
    const left = fs.readdirSync(dir).sort();
    expect(left).toEqual(['세포 신호 (수정본 2026-10-30 0900).pdf', '세포 신호 (수정본 2026-10-31 1015).pdf']);
    expect(left.every(isAside)).toBe(true);
    expect(fs.readFileSync(aside, 'utf8')).toBe('kept aside before');
    expect(fs.readFileSync(path.join(dir, left[1]!))).toEqual(edited);
  });

  it('a named copy of another size is kept aside too, even read-only', async () => {
    const lib = setup();
    const x = await imported(lib, writePdf(tempDir('src'), 'a.pdf', 'size'));
    const copy = await namedCopy(lib, x);
    fs.chmodSync(copy, 0o644);
    fs.appendFileSync(copy, 'more');
    fs.chmodSync(copy, 0o444); // an app that saves by replace and keeps the mode
    await removePurgedFiles(lib.layout, purged(lib, [x.item.id]));
    expect(fs.readdirSync(path.dirname(copy)).map(isAside)).toEqual([true]);
  });

  it('asks again right before the copy goes: a path a row holds by then stays', async () => {
    const lib = setup();
    const x = await imported(lib, writePdf(tempDir('src'), 'a.pdf', 'again'));
    const assets = purged(lib, [x.item.id]);
    const asked: string[] = [];
    expect(await removePurgedFiles(lib.layout, assets, { inUse: (rel) => (asked.push(rel), true) })).toEqual({ failed: 0 });
    expect(asked).toEqual([x.asset.relativePath]);
    expect(fs.existsSync(x.stored)).toBe(true);
    // A check that throws keeps it too, and counts it.
    expect(await removePurgedFiles(lib.layout, assets, { inUse: () => { throw new Error('database closed'); } })).toEqual({ failed: 1 });
    expect(fs.existsSync(x.stored)).toBe(true);
  });

  it('waits for an import of the same file between its look-up and its commit, then keeps the copy that import took', async () => {
    const hold: { on: boolean; reached?: () => void; release?: () => void } = { on: false };
    const lib = setup({
      beforeCommit: () => {
        if (!hold.on) return;
        hold.reached?.();
        return new Promise<void>((r) => (hold.release = r));
      },
    });
    const file = writePdf(tempDir('src'), 'a.pdf', 'race');
    const x = await imported(lib, file);
    const assets = purged(lib, [x.item.id]); // committed; the copy is still on disk
    hold.on = true;
    const reached = new Promise<void>((r) => (hold.reached = r));
    const again = lib.importer.importOne(file, { mode: 'managed' }); // finds no asset of the sha, keeps the copy in place
    await reached;
    let done = false;
    const removal = removePurgedFiles(lib.layout, assets, { inUse: (rel) => lib.repo.managedPathInUse(rel) }).then((r) => {
      done = true;
      return r;
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(done).toBe(false); // behind the import
    hold.release!();
    const out = await again;
    expect(await removal).toEqual({ failed: 0 });
    expect(out.status).toBe('imported');
    expect(fs.existsSync(x.stored)).toBe(true); // the new item's copy
    expect(out.status === 'imported' && lib.repo.getItem(out.item.id)?.availability).toBe('available');
  });

  it('refuses a managed path that would leave assets/ and an asset id that is not one', async () => {
    const lib = setup();
    const outside = path.join(lib.layout.root, 'library.sqlite');
    const other = path.join(lib.layout.derivedDir, 'open', '00000000-0000-4000-8000-000000000002');
    fs.mkdirSync(other, { recursive: true });
    fs.writeFileSync(path.join(other, 'x.pdf'), 'x');
    const assets: PurgedAsset[] = [
      { id: '00000000-0000-4000-8000-000000000003', storageMode: 'managed', relativePath: 'assets/../library.sqlite', size: 1 },
      { id: 'open', storageMode: 'linked', relativePath: null, size: 1 },
      { id: '../..', storageMode: 'linked', relativePath: null, size: 1 },
    ];
    expect(await removePurgedFiles(lib.layout, assets)).toEqual({ failed: 3 });
    expect(fs.existsSync(outside) && fs.existsSync(path.join(other, 'x.pdf'))).toBe(true);
  });

  it.skipIf(process.getuid?.() === 0)('a copy that cannot be removed is counted and left for the library check; the rest go on', async () => {
    const lib = setup();
    const dir = tempDir('src');
    const a = await imported(lib, writePdf(dir, 'a.pdf', 'stuck'));
    const b = await imported(lib, writePdf(dir, 'b.pdf', 'free'));
    const shard = path.dirname(a.stored);
    fs.chmodSync(shard, 0o555);
    try {
      expect(await removePurgedFiles(lib.layout, purged(lib, [a.item.id, b.item.id]))).toEqual({ failed: 1 });
      expect(fs.existsSync(a.stored)).toBe(true);
      expect(fs.existsSync(b.stored)).toBe(path.dirname(b.stored) === shard);
    } finally {
      fs.chmodSync(shard, 0o755);
    }
  });
});
