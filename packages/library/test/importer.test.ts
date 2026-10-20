import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LibraryRepository, migrate, openDatabase, type Db } from '@learn/db';
import { Importer, ensureLayout, libraryLayout, resolveAssetPath, sha256File, type ImportHooks } from '../src/index';
import { cleanupTemp, tempDir, writeMp4, writePdf } from './helpers';

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
});

describe('duplicates (AC02)', () => {
  it('reports a duplicate without writing anything and never deletes the source', async () => {
    const { repo, importer } = setup();
    const src = writePdf(tempDir('src'), 'a.pdf', 'same');
    const first = await importer.importOne(src, { mode: 'managed' });
    const second = await importer.importOne(src, { mode: 'managed' });
    expect(second).toEqual({ status: 'duplicate', path: src, existingItemId: first.status === 'imported' ? first.item.id : '' });
    expect(repo.counts()).toEqual({ items: 1, assets: 1, revisions: 1 });
    expect(fs.existsSync(src)).toBe(true);
  });

  it('adds a new item sharing the asset when allowDuplicate is set', async () => {
    const { repo, importer } = setup();
    const src = writePdf(tempDir('src'), 'a.pdf', 'same');
    await importer.importOne(src, { mode: 'managed' });
    const again = await importer.importOne(src, { mode: 'managed', allowDuplicate: true });
    expect(again.status).toBe('imported');
    expect(repo.counts()).toEqual({ items: 2, assets: 1, revisions: 1 });
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
    expect(await importer.importOne(txt, { mode: 'managed' })).toMatchObject({ status: 'failed', code: 'UNSUPPORTED_TYPE' });
    expect(await importer.importOne(path.join(dir, 'nope.pdf'), { mode: 'managed' })).toMatchObject({ status: 'failed', code: 'NOT_FOUND' });
    expect(await importer.importOne(dir, { mode: 'managed' })).toMatchObject({ status: 'failed', code: 'UNSUPPORTED_TYPE' });
  });

  it('leaves no DB rows and no staging file when copying fails after staging', async () => {
    const { layout, repo, importer } = setup({ afterStage: () => { throw new Error('disk yanked'); } });
    const out = await importer.importOne(writePdf(tempDir('src'), 'a.pdf', 'x'), { mode: 'managed' });
    expect(out).toMatchObject({ status: 'failed', code: 'INTERNAL' });
    expect(repo.counts()).toEqual({ items: 0, assets: 0, revisions: 0 });
    expect(fs.readdirSync(layout.stagingDir)).toEqual([]);
  });

  it('leaves no DB rows when the commit step fails; the placed file is reused on retry', async () => {
    let fail = true;
    const { repo, importer } = setup({ beforeCommit: () => { if (fail) throw new Error('crash before commit'); } });
    const src = writePdf(tempDir('src'), 'a.pdf', 'x');
    expect((await importer.importOne(src, { mode: 'managed' })).status).toBe('failed');
    expect(repo.counts().items).toBe(0);
    fail = false;
    const retry = await importer.importOne(src, { mode: 'managed' });
    expect(retry.status).toBe('imported');
    expect(repo.counts()).toEqual({ items: 1, assets: 1, revisions: 1 });
  });

  it('imports many files sequentially and reports each outcome', async () => {
    const { importer } = setup();
    const dir = tempDir('src');
    const outs = await importer.importMany([writePdf(dir, 'a.pdf', 'a'), writeMp4(dir, 'b.mp4', 'b'), path.join(dir, 'missing.pdf')], { mode: 'managed' });
    expect(outs.map((o) => o.status)).toEqual(['imported', 'imported', 'failed']);
  });
});
