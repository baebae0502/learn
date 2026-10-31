import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CollectionsRepository, LibraryRepository, migrate, openDatabase, type Db } from '@learn/db';
import { Importer, ensureLayout, libraryLayout, managedRelativePath, resolveAssetPath, sha256File, type ImportHooks, type LibraryLayout } from '../src/index';
import { cleanupTemp, tempDir, writeMp4, writePdf } from './helpers';

/** Every fsync the importer asks for, in order, with the renames between them (the durability tests read it). */
const durability = vi.hoisted(() => ({ log: [] as string[][], failFile: null as string | null }));
vi.mock('../src/fsync', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/fsync')>();
  return {
    fsyncFile: async (p: string) => {
      durability.log.push(['fsyncFile', p]);
      const code = durability.failFile;
      durability.failFile = null;
      if (code !== null) throw Object.assign(new Error(code), { code });
      return real.fsyncFile(p);
    },
    fsyncDir: async (p: string) => {
      durability.log.push(['fsyncDir', p]);
      return real.fsyncDir(p);
    },
  };
});

const dbs: Db[] = [];
afterEach(() => {
  durability.log.length = 0;
  durability.failFile = null;
  vi.restoreAllMocks();
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
const jobs = (db: Db) => db.prepare('SELECT kind, dedupe_key, state FROM jobs').all();

describe('managed import', () => {
  it('copies into assets/, records item/asset/revision/job, and leaves the source untouched', async () => {
    const { layout, repo, db, importer } = setup();
    const src = writePdf(tempDir('src'), 'Chapter 06.pdf', 'chapter six');
    const before = fs.readFileSync(src);
    const out = await importer.importOne(src, { mode: 'managed' });
    expect(out.status).toBe('imported');
    if (out.status !== 'imported') return;
    expect(out.item).toMatchObject({ title: 'Chapter 06', type: 'pdf', storageMode: 'managed', availability: 'available', originalName: 'Chapter 06.pdf' });
    const asset = repo.getAsset(out.item.assetId)!;
    const stored = resolveAssetPath(layout, asset);
    expect(await sha256File(stored)).toBe(asset.sha256);
    expect(fs.readFileSync(src)).toEqual(before);
    expect(fs.readdirSync(layout.stagingDir)).toEqual([]);
    expect(jobs(db)).toEqual([{ kind: 'extract', dedupe_key: `extract:${asset.sha256}:text-v0`, state: 'queued' }]);
  });

  it('keeps working after the original file is moved away (AC01)', async () => {
    const { layout, repo, importer } = setup();
    const dir = tempDir('src');
    const src = writeMp4(dir, 'Lecture 04.mp4', 'lecture four');
    const out = await importer.importOne(src, { mode: 'managed' });
    if (out.status !== 'imported') throw new Error(out.status);
    fs.renameSync(src, path.join(dir, 'moved.mp4'));
    const stored = resolveAssetPath(layout, repo.getAsset(out.item.assetId)!);
    expect(fs.existsSync(stored)).toBe(true);
  });

  it('handles Korean, spaces and special characters in paths', async () => {
    const { importer } = setup();
    const dir = path.join(tempDir('src'), '강의 자료 (1) #&');
    fs.mkdirSync(dir);
    const out = await importer.importOne(writePdf(dir, '신호 전달 #2 [최종].pdf', 'ko'), { mode: 'managed' });
    expect(out.status === 'imported' && out.item.title).toBe('신호 전달 #2 [최종]');
  });
  it('stores the title and the original name in NFC (macOS hands names over in NFD); the path stays as the disk has it', async () => {
    const { repo, importer } = setup();
    const nfc = '신호 전달 정리';
    for (const mode of ['managed', 'linked'] as const) {
      const dir = tempDir('src');
      const src = writePdf(dir, `${nfc.normalize('NFD')}.pdf`, `nfd ${mode}`);
      expect(fs.readdirSync(dir)).toEqual([`${nfc.normalize('NFD')}.pdf`]); // the disk keeps the decomposed name
      const out = await importer.importOne(src, { mode });
      if (out.status !== 'imported') throw new Error(out.status);
      expect(out.item.title, mode).toBe(nfc);
      expect(out.item.originalName, mode).toBe(`${nfc}.pdf`);
      const asset = repo.getAsset(out.item.assetId)!;
      expect(asset.originalName, mode).toBe(`${nfc}.pdf`);
      if (mode === 'linked') expect(asset.externalPath).toBe(src);
    }
  });
});

describe('duplicates (AC02)', () => {
  it('reports a duplicate without writing anything and never deletes the source', async () => {
    const { repo, importer } = setup();
    const src = writePdf(tempDir('src'), 'a.pdf', 'same');
    const first = await importer.importOne(src, { mode: 'managed' });
    const second = await importer.importOne(src, { mode: 'managed' });
    expect(second).toEqual({ status: 'duplicate', path: src, existingItemId: first.status === 'imported' ? first.item.id : '' });
    expect(repo.counts()).toMatchObject({ items: 1, assets: 1, revisions: 1 });
    expect(fs.existsSync(src)).toBe(true);
  });

  it('adds a new item sharing the asset when allowDuplicate is set', async () => {
    const { repo, importer } = setup();
    const src = writePdf(tempDir('src'), 'a.pdf', 'same');
    await importer.importOne(src, { mode: 'managed' });
    const again = await importer.importOne(src, { mode: 'managed', allowDuplicate: true });
    expect(again.status).toBe('imported');
    expect(repo.counts()).toMatchObject({ items: 2, assets: 1, revisions: 1 });
  });

  it('detects duplicates by content even under a different name', async () => {
    const { importer } = setup();
    const dir = tempDir('src');
    await importer.importOne(writePdf(dir, 'a.pdf', 'same'), { mode: 'managed' });
    const out = await importer.importOne(writePdf(dir, 'renamed copy.pdf', 'same'), { mode: 'linked' });
    expect(out.status).toBe('duplicate');
  });
});

describe('linked import', () => {
  it('records the external path without copying', async () => {
    const { layout, repo, importer } = setup();
    const src = writePdf(tempDir('src'), 'linked.pdf', 'linked');
    const out = await importer.importOne(src, { mode: 'linked' });
    if (out.status !== 'imported') throw new Error(out.status);
    expect(repo.getAsset(out.item.assetId)).toMatchObject({ storageMode: 'linked', externalPath: src, relativePath: null });
    expect(fs.readdirSync(layout.assetsDir)).toEqual([]);
  });
});

describe('failures', () => {
  it('rejects unsupported and missing files with codes', async () => {
    const { importer } = setup();
    const dir = tempDir('src');
    const txt = path.join(dir, 'notes.txt');
    fs.writeFileSync(txt, 'hello');
    // Cause, then the next step; "PDF와 동영상" and "가져올 수" stay together (U+00A0) when a toast wraps the line.
    expect(await importer.importOne(txt, { mode: 'managed' })).toMatchObject({
      status: 'failed',
      code: 'UNSUPPORTED_TYPE',
      message: '지원하지 않는 형식입니다. 지금은 PDF와\u00a0동영상(MP4\u00a0·\u00a0MOV\u00a0·\u00a0WebM)을 가져올\u00a0수 있습니다.',
    });
    expect(await importer.importOne(path.join(dir, 'nope.pdf'), { mode: 'managed' })).toMatchObject({ status: 'failed', code: 'NOT_FOUND' });
    expect(await importer.importOne(dir, { mode: 'managed' })).toMatchObject({ status: 'failed', code: 'UNSUPPORTED_TYPE', message: '일반 파일만 가져올\u00a0수 있습니다.' });
  });

  it('leaves no DB rows and no staging file when copying fails after staging', async () => {
    const { layout, repo, importer } = setup({ afterStage: () => { throw new Error('disk yanked'); } });
    const out = await importer.importOne(writePdf(tempDir('src'), 'a.pdf', 'x'), { mode: 'managed' });
    expect(out).toMatchObject({ status: 'failed', code: 'INTERNAL' });
    expect(repo.counts()).toMatchObject({ items: 0, assets: 0, revisions: 0 });
    expect(fs.readdirSync(layout.stagingDir)).toEqual([]);
  });

  it('leaves no DB rows when the commit step fails; the placed file is reused on retry', async () => {
    let fail = true;
    const { layout, repo, importer } = setup({ beforeCommit: () => { if (fail) throw new Error('crash before commit'); } });
    const src = writePdf(tempDir('src'), 'a.pdf', 'x');
    expect((await importer.importOne(src, { mode: 'managed' })).status).toBe('failed');
    expect(repo.counts().items).toBe(0);
    const sha256 = await sha256File(src);
    const target = path.join(layout.root, ...managedRelativePath(sha256).split('/'));
    expect(fs.existsSync(target)).toBe(true);
    const inodeBefore = fs.statSync(target).ino;
    fail = false;
    const retry = await importer.importOne(src, { mode: 'managed' });
    expect(retry.status).toBe('imported');
    expect(repo.counts()).toMatchObject({ items: 1, assets: 1, revisions: 1 });
    expect(fs.statSync(target).ino).toBe(inodeBefore);
    expect(fs.readdirSync(layout.stagingDir)).toEqual([]);
  });

  it('imports many files sequentially and reports each outcome', async () => {
    const { importer } = setup();
    const dir = tempDir('src');
    const outs = await importer.importMany([writePdf(dir, 'a.pdf', 'a'), writeMp4(dir, 'b.mp4', 'b'), path.join(dir, 'missing.pdf')], { mode: 'managed' });
    expect(outs.map((o) => o.status)).toEqual(['imported', 'imported', 'failed']);
  });
});

describe('integrity branches', () => {
  it('(a) quarantines a corrupt target and places a verified copy', async () => {
    const { layout, repo, importer } = setup();
    const src = writePdf(tempDir('src'), 'a.pdf', 'x');
    const sha256 = await sha256File(src);
    const target = path.join(layout.root, ...managedRelativePath(sha256).split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'wrong bytes');
    const out = await importer.importOne(src, { mode: 'managed' });
    expect(out.status).toBe('imported');
    expect(await sha256File(target)).toBe(sha256);
    const quarantined = fs.readdirSync(layout.stagingDir);
    expect(quarantined).toHaveLength(1);
    expect(quarantined[0]).toMatch(new RegExp(`^corrupt-${sha256}-`));
    expect(fs.readFileSync(path.join(layout.stagingDir, quarantined[0]!), 'utf8')).toBe('wrong bytes');
    expect(repo.counts()).toMatchObject({ items: 1, assets: 1, revisions: 1 });
  });

  it('(a2) reuse path quarantines a corrupted placed file and restores it', async () => {
    const { layout, repo, importer } = setup();
    const dir = tempDir('src');
    const src = writePdf(dir, 'a.pdf', 'same');
    const out1 = await importer.importOne(src, { mode: 'managed' });
    if (out1.status !== 'imported') throw new Error(out1.status);
    const sha256 = repo.getAsset(out1.item.assetId)!.sha256;
    const target = path.join(layout.root, ...managedRelativePath(sha256).split('/'));
    fs.writeFileSync(target, 'rotten');
    const out2 = await importer.importOne(src, { mode: 'managed', allowDuplicate: true });
    expect(out2.status).toBe('imported');
    expect(await sha256File(target)).toBe(sha256);
    const quarantined = fs.readdirSync(layout.stagingDir);
    expect(quarantined).toHaveLength(1);
    expect(quarantined[0]).toMatch(new RegExp(`^corrupt-${sha256}-`));
    expect(fs.readFileSync(path.join(layout.stagingDir, quarantined[0]!), 'utf8')).toBe('rotten');
    expect(repo.counts()).toMatchObject({ items: 2, assets: 1, revisions: 1 });
  });

  it('(b) detects source change mid-copy', async () => {
    const { layout, repo, importer } = setup();
    const src = writePdf(tempDir('src'), 'a.pdf', 'x');
    const spy = vi.spyOn(fsp, 'copyFile').mockImplementationOnce(async (s, d) => {
      await fsp.writeFile(d as string, 'changed during copy');
    });
    const out = await importer.importOne(src, { mode: 'managed' });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ status: 'failed', code: 'HASH_MISMATCH' });
    expect(repo.counts()).toMatchObject({ items: 0, assets: 0, revisions: 0 });
    expect(fs.readdirSync(layout.stagingDir)).toEqual([]);
    vi.restoreAllMocks();
  });

  it('(c) afterPlace hook throwing leaves DB clean', async () => {
    const { layout, repo, importer } = setup({ afterPlace: () => { throw new Error('unexpected error'); } });
    const out = await importer.importOne(writePdf(tempDir('src'), 'a.pdf', 'x'), { mode: 'managed' });
    expect(out).toMatchObject({ status: 'failed', code: 'INTERNAL' });
    expect(repo.counts()).toMatchObject({ items: 0, assets: 0, revisions: 0 });
  });
});

describe('reused managed assets', () => {
  it('restores missing managed asset file and marks available', async () => {
    const { layout, repo, importer } = setup();
    const dir = tempDir('src');
    const src1 = writePdf(dir, 'a.pdf', 'same');
    const out1 = await importer.importOne(src1, { mode: 'managed' });
    if (out1.status !== 'imported') throw new Error(out1.status);
    const asset = repo.getAsset(out1.item.assetId)!;
    const target = path.join(layout.root, ...managedRelativePath(asset.sha256).split('/'));
    expect(fs.existsSync(target)).toBe(true);
    fs.unlinkSync(target);
    expect(fs.existsSync(target)).toBe(false);
    repo.setAvailability(asset.id, 'missing', '2026-01-01T00:00:00Z');
    const src2 = writePdf(dir, 'b.pdf', 'same');
    const out2 = await importer.importOne(src2, { mode: 'managed', allowDuplicate: true });
    expect(out2.status).toBe('imported');
    if (out2.status !== 'imported') return;
    expect(fs.existsSync(target)).toBe(true);
    expect(await sha256File(target)).toBe(asset.sha256);
    const refreshed = repo.getAsset(asset.id)!;
    expect(refreshed.availability).toBe('available');
    expect(out1.item.availability).toBe('available');
    expect(out2.item.availability).toBe('available');
  });

  it('linked reuse path unchanged', async () => {
    const { repo, importer } = setup();
    const dir = tempDir('src');
    const src = writePdf(dir, 'a.pdf', 'same');
    const out1 = await importer.importOne(src, { mode: 'linked' });
    if (out1.status !== 'imported') throw new Error(out1.status);
    const asset1 = repo.getAsset(out1.item.assetId)!;
    const out2 = await importer.importOne(src, { mode: 'linked', allowDuplicate: true });
    expect(out2.status).toBe('imported');
    if (out2.status !== 'imported') return;
    const asset2 = repo.getAsset(out2.item.assetId)!;
    expect(asset1.id).toBe(asset2.id);
    expect(asset2.externalPath).toBe(src);
  });
});

describe('import into a collection', () => {
  const members = (db: Db, collectionId: string) =>
    (db.prepare('SELECT item_id FROM collection_items WHERE collection_id = ?').all(collectionId) as { item_id: string }[]).map((r) => r.item_id);

  it('files each imported item in the collection and says so in its outcome', async () => {
    const { db, importer } = setup();
    const coll = new CollectionsRepository(db).create({ name: '강의' });
    const dir = tempDir('src');
    const outs = await importer.importMany([writePdf(dir, 'a.pdf', 'one'), writeMp4(dir, 'b.mp4', 'two')], { mode: 'managed', collectionId: coll.id });
    const ids = outs.map((o) => (o.status === 'imported' ? o.item.id : ''));
    expect(outs.map((o) => o.status === 'imported' && o.collectionId)).toEqual([coll.id, coll.id]);
    expect(members(db, coll.id).sort()).toEqual([...ids].sort());
  });

  it('imports without a membership when the collection was deleted before the import', async () => {
    const { db, repo, importer } = setup();
    const cols = new CollectionsRepository(db);
    const coll = cols.create({ name: '곧 지울 것' });
    cols.softDelete(coll.id);
    const out = await importer.importOne(writePdf(tempDir('src'), 'a.pdf', 'x'), { mode: 'managed', collectionId: coll.id });
    expect(out.status).toBe('imported');
    expect(out.status === 'imported' && 'collectionId' in out).toBe(false);
    expect(repo.counts()).toMatchObject({ items: 1, collectionItems: 0 });
    expect(members(db, coll.id)).toEqual([]);
  });

  it('skips the membership when the collection is deleted between the file copy and the commit', async () => {
    let cols!: CollectionsRepository;
    let coll!: { id: string };
    // The hook is fixed when the importer is made, before the collection exists: both are assigned right after.
    const { db, repo, importer } = setup({ beforeCommit: () => cols.softDelete(coll.id) });
    cols = new CollectionsRepository(db);
    coll = cols.create({ name: '가져오는 중에 지움' });
    const out = await importer.importOne(writePdf(tempDir('src'), 'a.pdf', 'mid'), { mode: 'managed', collectionId: coll.id });
    expect(out.status).toBe('imported');
    expect(out.status === 'imported' && 'collectionId' in out).toBe(false);
    expect(repo.counts()).toMatchObject({ items: 1, collectionItems: 0 });
  });

  it('files nothing for a duplicate that is not imported, and files the new item when allowDuplicate adds it', async () => {
    const { db, importer } = setup();
    const coll = new CollectionsRepository(db).create({ name: 'c' });
    const src = writePdf(tempDir('src'), 'a.pdf', 'same');
    const first = await importer.importOne(src, { mode: 'managed' });
    expect(first.status === 'imported' && 'collectionId' in first).toBe(false); // none asked for, none reported
    const dup = await importer.importOne(src, { mode: 'managed', collectionId: coll.id });
    expect(dup.status).toBe('duplicate');
    expect(members(db, coll.id)).toEqual([]);
    const again = await importer.importOne(src, { mode: 'managed', allowDuplicate: true, collectionId: coll.id });
    expect(again.status === 'imported' && again.collectionId).toBe(coll.id);
    expect(members(db, coll.id)).toEqual([again.status === 'imported' ? again.item.id : '']);
  });
});

describe('durability: the staged copy reaches the disk before its name, the folder after (spec 10 fsync)', () => {
  const realRename = fsp.rename;
  /** fs.rename calls go into the same log as the fsyncs, in one order. */
  function logRenames(): void {
    vi.spyOn(fsp, 'rename').mockImplementation(async (from, to) => {
      durability.log.push(['rename', String(from), String(to)]);
      return realRename(from, to);
    });
  }
  async function targetOf(layout: LibraryLayout, src: string): Promise<string> {
    return path.join(layout.root, ...managedRelativePath(await sha256File(src)).split('/'));
  }
  const staged = (): string => durability.log.find(([kind]) => kind === 'fsyncFile')![1]!;

  it('a new file in a new shard folder: the folder\'s parent, the staged copy, the rename, the shard folder', async () => {
    const { layout, importer } = setup();
    const src = writePdf(tempDir('src'), 'a.pdf', 'durable');
    const target = await targetOf(layout, src);
    durability.log.length = 0;
    logRenames();
    expect((await importer.importOne(src, { mode: 'managed' })).status).toBe('imported');
    expect(path.dirname(staged())).toBe(layout.stagingDir);
    expect(durability.log).toEqual([
      ['fsyncDir', layout.assetsDir],
      ['fsyncFile', staged()],
      ['rename', staged(), target],
      ['fsyncDir', path.dirname(target)],
    ]);
  });

  it('a file put back into a shard folder that exists: assets/ is not flushed again', async () => {
    const { layout, repo, importer } = setup();
    const src = writePdf(tempDir('src'), 'a.pdf', 'again');
    const first = await importer.importOne(src, { mode: 'managed' });
    if (first.status !== 'imported') throw new Error(first.status);
    const target = resolveAssetPath(layout, repo.getAsset(first.item.assetId)!);
    fs.unlinkSync(target);
    durability.log.length = 0;
    logRenames();
    expect((await importer.importOne(src, { mode: 'managed', allowDuplicate: true })).status).toBe('imported');
    expect(durability.log).toEqual([['fsyncFile', staged()], ['rename', staged(), target], ['fsyncDir', path.dirname(target)]]);
  });

  it('an intact file already in place is reused: nothing is flushed or renamed', async () => {
    const { importer } = setup();
    const src = writePdf(tempDir('src'), 'a.pdf', 'intact');
    expect((await importer.importOne(src, { mode: 'managed' })).status).toBe('imported');
    durability.log.length = 0;
    logRenames();
    expect((await importer.importOne(src, { mode: 'managed', allowDuplicate: true })).status).toBe('imported');
    expect(durability.log).toEqual([]);
  });

  it('a corrupt file in place: the flushed copy, the quarantine, the rename, then both folders', async () => {
    const { layout, importer } = setup();
    const src = writePdf(tempDir('src'), 'a.pdf', 'x');
    const target = await targetOf(layout, src);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'wrong bytes');
    durability.log.length = 0;
    logRenames();
    expect((await importer.importOne(src, { mode: 'managed' })).status).toBe('imported');
    const [quarantined] = fs.readdirSync(layout.stagingDir);
    expect(durability.log).toEqual([
      ['fsyncFile', staged()],
      ['rename', target, path.join(layout.stagingDir, quarantined!)],
      ['rename', staged(), target],
      ['fsyncDir', layout.stagingDir],
      ['fsyncDir', path.dirname(target)],
    ]);
  });

  it('a linked file is not copied: nothing to flush', async () => {
    const { importer } = setup();
    durability.log.length = 0;
    expect((await importer.importOne(writePdf(tempDir('src'), 'a.pdf', 'linked'), { mode: 'linked' })).status).toBe('imported');
    expect(durability.log).toEqual([]);
  });

  it('a staged copy that cannot be flushed is never renamed into place: the import fails and leaves nothing', async () => {
    const { layout, repo, importer } = setup();
    const src = writePdf(tempDir('src'), 'a.pdf', 'eio');
    const target = await targetOf(layout, src);
    durability.log.length = 0;
    durability.failFile = 'EIO';
    logRenames();
    expect(await importer.importOne(src, { mode: 'managed' })).toMatchObject({ status: 'failed', code: 'INTERNAL' });
    expect(durability.log.filter(([kind]) => kind === 'rename')).toEqual([]);
    expect(fs.existsSync(target)).toBe(false);
    expect(fs.readdirSync(layout.stagingDir)).toEqual([]);
    expect(repo.counts()).toMatchObject({ items: 0, assets: 0 });
  });
});

describe('stopping a file at its checkpoints (spec 3.5)', () => {
  const MiB = 1024 * 1024;
  /** A file that sniffs as PDF, `size` bytes, unique per `seed`: big enough that hashing it takes many reads. */
  function bigPdf(dir: string, name: string, seed: string, size = 4 * MiB): string {
    const p = path.join(dir, name);
    const head = Buffer.from(`%PDF-1.4\n% ${seed}\n`);
    fs.writeFileSync(p, Buffer.concat([head, Buffer.alloc(size - head.length, 0x20)]));
    return p;
  }
  const filesUnder = (dir: string): string[] =>
    fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name);
  /** A stopped file leaves no staging copy, nothing in assets/ and no row. */
  function leftNothing(layout: LibraryLayout, repo: LibraryRepository): void {
    expect(fs.readdirSync(layout.stagingDir)).toEqual([]);
    expect(filesUnder(layout.assetsDir)).toEqual([]);
    expect(repo.counts()).toMatchObject({ items: 0, assets: 0, revisions: 0 });
  }
  const cancelled = (src: string) => ({ status: 'failed', path: src, code: 'CANCELLED', message: '가져오기를 취소했습니다.' });

  it('during the source hash: nothing is copied and nothing recorded', async () => {
    const { layout, repo, importer } = setup();
    const src = bigPdf(tempDir('src'), 'big.pdf', 'source');
    const copy = vi.spyOn(fsp, 'copyFile');
    const stop = new AbortController();
    expect(await importer.importOne(src, { mode: 'managed', signal: stop.signal, onBytes: () => stop.abort() })).toEqual(cancelled(src));
    expect(copy).not.toHaveBeenCalled();
    leftNothing(layout, repo);
  });

  it('right after the copy: the staging copy goes before it is checked (the copy itself is not cut short)', async () => {
    const afterStage = vi.fn();
    const { layout, repo, importer } = setup({ afterStage });
    const src = bigPdf(tempDir('src'), 'big.pdf', 'copied');
    const stop = new AbortController();
    const copyFile = fsp.copyFile;
    const copy = vi.spyOn(fsp, 'copyFile').mockImplementationOnce(async (from, to) => {
      await copyFile(from, to);
      stop.abort();
    });
    expect(await importer.importOne(src, { mode: 'managed', signal: stop.signal })).toEqual(cancelled(src));
    expect(copy).toHaveBeenCalledTimes(1);
    expect(afterStage).not.toHaveBeenCalled();
    leftNothing(layout, repo);
  });

  it('during the staging copy\'s hash: it stops part-way, before the copy is verified', async () => {
    const afterStage = vi.fn();
    const { layout, repo, importer } = setup({ afterStage });
    const src = bigPdf(tempDir('src'), 'big.pdf', 'verifying', 16 * MiB);
    const stop = new AbortController();
    const copyFile = fsp.copyFile;
    vi.spyOn(fsp, 'copyFile').mockImplementationOnce(async (from, to) => {
      await copyFile(from, to);
      // After the copy's own checkpoint has passed: the stop lands while the staging copy is read (256 reads of 64 KiB).
      setImmediate(() => stop.abort());
    });
    expect(await importer.importOne(src, { mode: 'managed', signal: stop.signal })).toEqual(cancelled(src));
    expect(afterStage).not.toHaveBeenCalled();
    leftNothing(layout, repo);
  });

  it('before the rename: the verified copy never reaches assets/', async () => {
    const stop = new AbortController();
    const afterPlace = vi.fn();
    const { layout, repo, importer } = setup({ afterStage: () => stop.abort(), afterPlace });
    const src = writePdf(tempDir('src'), 'a.pdf', 'renaming');
    expect(await importer.importOne(src, { mode: 'managed', signal: stop.signal })).toEqual(cancelled(src));
    expect(afterPlace).not.toHaveBeenCalled();
    leftNothing(layout, repo);
  });

  it('past the rename it goes on: a copy in assets/ is committed, never left without its row', async () => {
    const stop = new AbortController();
    const { repo, importer } = setup({ afterPlace: () => stop.abort() });
    const out = await importer.importOne(writePdf(tempDir('src'), 'a.pdf', 'placed'), { mode: 'managed', signal: stop.signal });
    expect(out.status).toBe('imported');
    expect(repo.counts()).toMatchObject({ items: 1, assets: 1, revisions: 1 });
  });

  it('a linked file stops during its hash, with no row', async () => {
    const { layout, repo, importer } = setup();
    const src = bigPdf(tempDir('src'), 'linked.pdf', 'linked');
    const stop = new AbortController();
    expect(await importer.importOne(src, { mode: 'linked', signal: stop.signal, onBytes: () => stop.abort() })).toEqual(cancelled(src));
    leftNothing(layout, repo);
  });

  it('a file whose import was stopped before it began reads nothing past its first checkpoint', async () => {
    const { layout, repo, importer } = setup();
    const src = writePdf(tempDir('src'), 'a.pdf', 'early');
    const copy = vi.spyOn(fsp, 'copyFile');
    const stop = new AbortController();
    stop.abort();
    expect(await importer.importOne(src, { mode: 'managed', signal: stop.signal })).toEqual(cancelled(src));
    expect(copy).not.toHaveBeenCalled();
    leftNothing(layout, repo);
  });

  it('a reused copy stops before its rename and leaves the copy it shares as it was', async () => {
    const stop = new AbortController();
    let armed = false;
    const { layout, repo, importer } = setup({ afterStage: () => { if (armed) stop.abort(); } });
    const dir = tempDir('src');
    const first = await importer.importOne(writePdf(dir, 'a.pdf', 'same'), { mode: 'managed' });
    if (first.status !== 'imported') throw new Error(first.status);
    const asset = repo.getAsset(first.item.assetId)!;
    armed = true;
    const again = writePdf(dir, 'b.pdf', 'same');
    expect(await importer.importOne(again, { mode: 'managed', allowDuplicate: true, signal: stop.signal })).toEqual(cancelled(again));
    expect(repo.counts()).toMatchObject({ items: 1, assets: 1, revisions: 1 });
    expect(repo.getAsset(asset.id)?.availability).toBe('available');
    expect(await sha256File(resolveAssetPath(layout, asset))).toBe(asset.sha256);
    expect(fs.readdirSync(layout.stagingDir)).toEqual([]);
  });

  it('reports the source bytes it hashes, once per file (the staging check is not counted again)', async () => {
    const { importer } = setup();
    const src = bigPdf(tempDir('src'), 'big.pdf', 'bytes', 2 * MiB);
    let read = 0;
    const out = await importer.importOne(src, { mode: 'managed', onBytes: (bytes) => { read += bytes; } });
    expect(out.status).toBe('imported');
    expect(read).toBe(2 * MiB);
  });

  it('names the item by the title asked for; a blank one falls back to the file name', async () => {
    const { importer } = setup();
    const dir = tempDir('src');
    const named = await importer.importOne(writePdf(dir, 'scan 0042.pdf', 'one'), { mode: 'managed', title: '신호 전달 (수정본 2026-10-31 0930)' });
    expect(named.status === 'imported' && named.item.title).toBe('신호 전달 (수정본 2026-10-31 0930)');
    const blank = await importer.importOne(writePdf(dir, 'scan 0043.pdf', 'two'), { mode: 'managed', title: '  ' });
    expect(blank.status === 'imported' && blank.item.title).toBe('scan 0043');
  });

  it('takes fault points after it was made (main\'s E2E pause), and lets them go again', async () => {
    const { importer } = setup();
    const beforeCommit = vi.fn();
    importer.setHooks({ beforeCommit });
    await importer.importOne(writePdf(tempDir('src'), 'a.pdf', 'hooked'), { mode: 'managed' });
    expect(beforeCommit).toHaveBeenCalledTimes(1);
    importer.setHooks(undefined);
    await importer.importOne(writePdf(tempDir('src'), 'b.pdf', 'unhooked'), { mode: 'managed' });
    expect(beforeCommit).toHaveBeenCalledTimes(1);
  });
});
