import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LibraryRepository, migrate, openDatabase, type Db } from '@learn/db';
import {
  Importer, assetKeyFile, checkLibrary, cleanStaging, cleanUnreferenced, corruptCopies, ensureLayout, libraryLayout, managedRelativePath,
  refreshAvailability, refreshLinkedAvailability, relinkAsset, resolveAssetPath, type ImportHooks,
} from '../src/index';
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
async function imported(importer: Importer, src: string, mode: 'managed' | 'linked' = 'managed') {
  const out = await importer.importOne(src, { mode });
  if (out.status !== 'imported') throw new Error(out.status);
  return out.item;
}
/** A file of `bytes` (a size: zero-filled) at `file`, its folders made. */
function put(file: string, bytes: number | string | Buffer): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof bytes === 'number' ? Buffer.alloc(bytes, 7) : bytes);
  return file;
}
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const SHA = 'c'.repeat(64);
const ORPHAN_ID = '0a1b2c3d-4e5f-4061-8172-8394a5b6c7d8';
const EDIT = '단백질 접힘 정리 (수정본 2026-10-18 2210).pdf';

describe('checkLibrary (M6 spec 7, P-16)', () => {
  it('finds nothing in a clean library: its items counted, nothing to act on, the same fingerprint every time', async () => {
    const { layout, repo, importer } = setup();
    await imported(importer, writePdf(tempDir('src'), 'a.pdf', 'a'));
    const first = await checkLibrary(layout, repo);
    expect(first).toMatchObject({
      items: 1, staging: { count: 0, bytes: 0 }, unreferenced: { keys: [], bytes: 0 }, missingManaged: { itemIds: [] }, missingLinked: { itemIds: [] },
      corrupt: { count: 0, bytes: 0, files: [] }, orphanEdits: { count: 0, bytes: 0, copies: [] }, actionable: false,
    });
    expect(first.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect((await checkLibrary(layout, repo)).fingerprint).toBe(first.fingerprint);
  });

  it('counts a stopped import\'s .part files and their size — never .DS_Store, a dot file, a folder or another name — and corrupt copies apart; deletes nothing', async () => {
    const { layout, repo } = setup();
    put(path.join(layout.stagingDir, '11111111-1111-4111-8111-111111111111.part'), 300);
    put(path.join(layout.stagingDir, '22222222-2222-4222-8222-222222222222.part'), 200);
    put(path.join(layout.stagingDir, '.DS_Store'), 6148);
    put(path.join(layout.stagingDir, '._33333333.part'), 4096);
    put(path.join(layout.stagingDir, 'notes.txt'), 10);
    fs.mkdirSync(path.join(layout.stagingDir, 'folder.part'));
    const corrupt = `corrupt-${SHA}-44444444-4444-4444-8444-444444444444`;
    put(path.join(layout.stagingDir, corrupt), 42);
    const check = await checkLibrary(layout, repo);
    expect(check.staging).toEqual({ count: 2, bytes: 500 });
    expect(check.corrupt).toEqual({ count: 1, bytes: 42, files: [corrupt] });
    expect(check.actionable).toBe(true);
    expect(fs.readdirSync(layout.stagingDir)).toHaveLength(7);
  });

  it('leaves out the .part an import is writing now (Importer.stagingInUse)', async () => {
    const { layout, repo } = setup();
    put(path.join(layout.stagingDir, 'live.part'), 10);
    put(path.join(layout.stagingDir, 'dead.part'), 20);
    expect((await checkLibrary(layout, repo, { stagingInUse: new Set(['live.part']) })).staging).toEqual({ count: 1, bytes: 20 });
  });

  it('lists the files under assets/ that no asset holds, by key and size, past dot files and folders; deletes nothing', async () => {
    const { layout, repo, importer } = setup();
    const item = await imported(importer, writePdf(tempDir('src'), 'a.pdf', 'a'));
    const key = `assets/cc/${SHA}`;
    put(path.join(layout.root, key), 96);
    put(path.join(layout.assetsDir, 'cc', '.DS_Store'), 6148);
    put(path.join(layout.assetsDir, '.DS_Store'), 6148);
    fs.mkdirSync(path.join(layout.assetsDir, 'dd', 'nested'), { recursive: true });
    const check = await checkLibrary(layout, repo);
    expect(check.unreferenced).toEqual({ keys: [key], bytes: 96 });
    expect(fs.existsSync(path.join(layout.root, key))).toBe(true);
    expect(repo.getItem(item.id)!.availability).toBe('available');
  });

  it('flags live items whose managed copy vanished and marks the asset missing (a trashed item\'s asset too, but no row for it); a copy put back is available again', async () => {
    const { layout, repo, importer } = setup();
    const live = await imported(importer, writePdf(tempDir('src'), 'a.pdf', 'a'));
    const trashed = await imported(importer, writePdf(tempDir('src'), 'b.pdf', 'b'));
    repo.trash([trashed.id]);
    const copyOf = (assetId: string) => resolveAssetPath(layout, repo.getAsset(assetId)!);
    const kept = path.join(tempDir('kept'), 'a.bin');
    fs.copyFileSync(copyOf(live.assetId), kept);
    fs.rmSync(copyOf(live.assetId));
    fs.rmSync(copyOf(trashed.assetId));
    const check = await checkLibrary(layout, repo);
    expect(check.missingManaged.itemIds).toEqual([live.id]);
    expect(check.actionable).toBe(true);
    expect(repo.getAsset(live.assetId)!.availability).toBe('missing');
    expect(repo.getAsset(trashed.assetId)!.availability).toBe('missing');
    fs.copyFileSync(kept, copyOf(live.assetId));
    expect((await checkLibrary(layout, repo)).missingManaged.itemIds).toEqual([]);
    expect(repo.getAsset(live.assetId)!.availability).toBe('available');
  });

  it('lists the live linked items found missing (their availability), which alone is nothing to act on (spec 7.1)', async () => {
    const { layout, repo, importer } = setup();
    const dir = tempDir('src');
    const src = writePdf(dir, 'paper.pdf', 'paper');
    const item = await imported(importer, src, 'linked');
    fs.renameSync(src, path.join(dir, 'moved.pdf'));
    expect(await refreshLinkedAvailability(layout, repo)).toEqual([item.assetId]);
    expect(await refreshLinkedAvailability(layout, repo)).toEqual([]); // nothing changed the second time
    const check = await checkLibrary(layout, repo);
    expect(check.missingLinked.itemIds).toEqual([item.id]);
    expect(check.actionable).toBe(false);
  });

  it('counts edited copies whose asset has no row (주인 없는 수정본), with their size — not those of a trashed item, not a named copy or a dot file', async () => {
    const { layout, repo, importer } = setup();
    const trashed = await imported(importer, writePdf(tempDir('src'), 'b.pdf', 'b'));
    repo.trash([trashed.id]);
    put(path.join(layout.derivedDir, 'open', trashed.assetId, EDIT), 30);
    put(path.join(layout.derivedDir, 'open', ORPHAN_ID, EDIT), 31);
    put(path.join(layout.derivedDir, 'open', ORPHAN_ID, '.DS_Store'), 6148);
    put(path.join(layout.derivedDir, 'open', ORPHAN_ID, 'named copy.pdf'), 99);
    const check = await checkLibrary(layout, repo);
    expect(check.orphanEdits).toEqual({ count: 1, bytes: 31, copies: [{ assetId: ORPHAN_ID, name: EDIT }] });
    expect(check.actionable).toBe(true);
  });

  it('interrupts the jobs left running only when asked to (at startup)', async () => {
    const { layout, db, repo, importer } = setup();
    await imported(importer, writePdf(tempDir('src'), 'a.pdf', 'a'));
    db.prepare(`UPDATE jobs SET state = 'running'`).run();
    await checkLibrary(layout, repo);
    expect(db.prepare(`SELECT state FROM jobs`).pluck().get()).toBe('running');
    await checkLibrary(layout, repo, { interruptJobs: true });
    expect(db.prepare(`SELECT state FROM jobs`).pluck().get()).toBe('interrupted');
  });

  it('fingerprints what may open the sheet by itself: a new leftover changes it; a linked file gone or one more item does not', async () => {
    const { layout, repo, importer } = setup();
    put(path.join(layout.stagingDir, 'a.part'), 1);
    const before = (await checkLibrary(layout, repo)).fingerprint;
    const dir = tempDir('src');
    const src = writePdf(dir, 'paper.pdf', 'paper');
    await imported(importer, src, 'linked');
    await imported(importer, writePdf(dir, 'more.pdf', 'more'));
    fs.rmSync(src);
    await refreshLinkedAvailability(layout, repo);
    expect((await checkLibrary(layout, repo)).fingerprint).toBe(before);
    put(path.join(layout.stagingDir, 'b.part'), 1);
    expect((await checkLibrary(layout, repo)).fingerprint).not.toBe(before);
  });
});

describe('the check sheet\'s cleanups (spec 7.2)', () => {
  it('임시 파일 정리 removes staging .part files only — never one in use, .DS_Store, a dot file, a corrupt copy or another name', async () => {
    const { layout } = setup();
    for (const n of ['dead.part', 'live.part', '.DS_Store', '._x.part', `corrupt-${SHA}-1`, 'notes.txt']) put(path.join(layout.stagingDir, n), 5);
    expect(await cleanStaging(layout, new Set(['live.part']))).toEqual({ removed: 1, failed: 0 });
    expect(fs.readdirSync(layout.stagingDir).sort()).toEqual(['._x.part', '.DS_Store', `corrupt-${SHA}-1`, 'live.part', 'notes.txt'].sort());
  });

  it('정리 removes the unreferenced copies it is given, keeps one an asset holds again, and refuses a key that is not under assets/', async () => {
    const { layout, repo, importer } = setup();
    const orphan = `assets/cc/${SHA}`;
    put(path.join(layout.root, orphan), 9);
    const item = await imported(importer, writePdf(tempDir('src'), 'a.pdf', 'a'));
    const held = repo.getAsset(item.assetId)!.relativePath!;
    const outside = put(path.join(layout.root, 'library-notes.txt'), 3);
    const r = await cleanUnreferenced(layout, (key) => repo.managedPathInUse(key), [orphan, held, '../library-notes.txt', 'assets/cc/.DS_Store', 'assets/../library.sqlite']);
    expect(r).toEqual({ removed: 1, failed: 3 });
    expect(fs.existsSync(path.join(layout.root, orphan))).toBe(false);
    expect(fs.existsSync(path.join(layout.root, held))).toBe(true);
    expect(fs.existsSync(outside)).toBe(true);
    expect(fs.existsSync(layout.dbFile)).toBe(true);
  });

  it('names the corrupt copies set aside as files in name order, and maps a key to its file only under assets/', async () => {
    const { layout } = setup();
    const b = put(path.join(layout.stagingDir, `corrupt-${SHA}-b`), 1);
    const a = put(path.join(layout.stagingDir, `corrupt-${SHA}-a`), 1);
    put(path.join(layout.stagingDir, 'x.part'), 1);
    expect(await corruptCopies(layout)).toEqual([a, b]);
    expect(assetKeyFile(layout, `assets/cc/${SHA}`)).toBe(path.join(layout.assetsDir, 'cc', SHA));
    for (const bad of ['assets/cc', 'assets/../x', 'assets/.x/y', 'staging/a.part', '/etc/passwd', `assets/cc/${SHA}/more`]) expect(assetKeyFile(layout, bad), bad).toBeNull();
  });
});

describe('Importer: the staging names it writes, and a vanished copy put back (다시 연결…, spec 7.2)', () => {
  it('names the .part it is writing while it writes it, and none after', async () => {
    let inUse: ReadonlySet<string> = new Set();
    const seen: boolean[] = [];
    const { importer } = setup({ afterStage: (staging) => void seen.push(inUse.has(path.basename(staging))) });
    inUse = importer.stagingInUse();
    await imported(importer, writePdf(tempDir('src'), 'a.pdf', 'a'));
    expect(seen).toEqual([true]);
    expect([...importer.stagingInUse()]).toEqual([]);
  });

  it('puts a vanished managed copy back from a file with the same bytes; the asset is available again and staging is empty', async () => {
    const { layout, repo, importer } = setup();
    const src = writePdf(tempDir('src'), 'a.pdf', 'a');
    const item = await imported(importer, src);
    const asset = repo.getAsset(item.assetId)!;
    fs.rmSync(resolveAssetPath(layout, asset));
    await checkLibrary(layout, repo);
    expect(repo.getAsset(asset.id)!.availability).toBe('missing');
    await importer.restoreCopy(src, asset.id);
    expect(fs.readFileSync(resolveAssetPath(layout, asset)).equals(fs.readFileSync(src))).toBe(true);
    expect(asset.relativePath).toBe(managedRelativePath(sha256(fs.readFileSync(src))));
    expect(repo.getAsset(asset.id)!.availability).toBe('available');
    expect(fs.readdirSync(layout.stagingDir)).toEqual([]);
  });

  it('refuses other bytes, a linked asset and a file that is not there, and places nothing', async () => {
    const { layout, repo, importer } = setup();
    const dir = tempDir('src');
    const src = writePdf(dir, 'a.pdf', 'a');
    const item = await imported(importer, src);
    const asset = repo.getAsset(item.assetId)!;
    fs.rmSync(resolveAssetPath(layout, asset));
    await expect(importer.restoreCopy(writePdf(dir, 'other.pdf', 'other'), asset.id)).rejects.toMatchObject({
      code: 'HASH_MISMATCH', message: '선택한 파일의 내용이 원래 자료와 다릅니다. 같은 파일을 선택하세요.',
    });
    await expect(importer.restoreCopy(path.join(dir, 'gone.pdf'), asset.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const linked = await imported(importer, writePdf(dir, 'paper.pdf', 'paper'), 'linked');
    await expect(importer.restoreCopy(src, linked.assetId)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(fs.existsSync(resolveAssetPath(layout, asset))).toBe(false);
    expect(fs.readdirSync(layout.stagingDir)).toEqual([]);
  });
});

describe('linked availability and relink', () => {
  it('marks a moved linked file missing, then relinks only to identical content', async () => {
    const { layout, repo, importer } = setup();
    const dir = tempDir('src');
    const src = writePdf(dir, 'paper.pdf', 'paper');
    const out = await importer.importOne(src, { mode: 'linked' });
    if (out.status !== 'imported') throw new Error(out.status);
    const moved = path.join(dir, 'paper (moved).pdf');
    fs.renameSync(src, moved);

    expect(await refreshLinkedAvailability(layout, repo)).toEqual([out.item.assetId]);
    expect(repo.getItem(out.item.id)!.availability).toBe('missing');

    const other = writePdf(dir, 'other.pdf', 'different');
    await expect(relinkAsset(repo, out.item.assetId, other)).rejects.toMatchObject({ code: 'HASH_MISMATCH' });

    await relinkAsset(repo, out.item.assetId, moved);
    expect(repo.getAsset(out.item.assetId)).toMatchObject({ externalPath: moved, availability: 'available' });
    expect(await refreshAvailability(layout, repo, repo.getAsset(out.item.assetId)!)).toBe('available');
  });

  it('refuses to relink managed assets', async () => {
    const { repo, importer } = setup();
    const src = writePdf(tempDir('src'), 'a.pdf', 'a');
    const out = await importer.importOne(src, { mode: 'managed' });
    if (out.status !== 'imported') throw new Error(out.status);
    await expect(relinkAsset(repo, out.item.assetId, src)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});
