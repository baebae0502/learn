import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LibraryRepository, migrate, openDatabase, type Db } from '@learn/db';
import { Importer, createBackup, ensureLayout, libraryLayout, resolveAssetPath, restoreBackup, sha256File } from '../src/index';
import { cleanupTemp, tempDir, writeMp4, writePdf } from './helpers';

const dbs: Db[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) if (db.open) db.close();
  cleanupTemp();
});

async function populated() {
  const layout = libraryLayout(path.join(tempDir(), 'Library'));
  ensureLayout(layout);
  const db = openDatabase(layout.dbFile);
  dbs.push(db);
  migrate(db, { dbFile: layout.dbFile });
  const repo = new LibraryRepository(db);
  const importer = new Importer({ layout, repo });
  const src = tempDir('src');
  await importer.importOne(writePdf(src, 'a.pdf', 'a'), { mode: 'managed' });
  await importer.importOne(writeMp4(src, 'b.mp4', 'b'), { mode: 'managed' });
  await importer.importOne(writePdf(src, 'c.pdf', 'c'), { mode: 'linked' });
  return { layout, db, repo };
}

describe('backup and restore (AC15 — files part)', () => {
  it('restores into an empty profile with matching hashes and counts', async () => {
    const { layout, db, repo } = await populated();
    const dest = path.join(tempDir('bk'), 'backup-1');
    const manifest = await createBackup({ layout, db, repo, destDir: dest, includeAssets: true });
    expect(manifest).toMatchObject({ format: 'learn-backup', formatVersion: 1, schemaVersion: 1, counts: { items: 3, assets: 3, revisions: 3 } });
    expect(manifest.assets.filter((a) => a.included)).toHaveLength(2); // linked is reference-only

    const target = path.join(tempDir('restore'), 'Library');
    const result = await restoreBackup({ backupDir: dest, targetRoot: target });
    expect(result).toEqual({ verifiedAssets: 2, missingAssets: [], hashMismatches: [], counts: { items: 3, assets: 3, revisions: 3 }, countsMatch: true });

    const rdb = openDatabase(libraryLayout(target).dbFile);
    dbs.push(rdb);
    const rrepo = new LibraryRepository(rdb);
    for (const a of rrepo.assetsByMode('managed')) {
      expect(await sha256File(resolveAssetPath(libraryLayout(target), a))).toBe(a.sha256);
    }
  });

  it('detects corrupted asset copies in a backup', async () => {
    const { layout, db, repo } = await populated();
    const dest = path.join(tempDir('bk'), 'backup-2');
    const manifest = await createBackup({ layout, db, repo, destDir: dest, includeAssets: true });
    const victim = manifest.assets.find((a) => a.included)!;
    fs.appendFileSync(path.join(dest, ...victim.relativePath!.split('/')), 'tampered');
    const result = await restoreBackup({ backupDir: dest, targetRoot: path.join(tempDir('restore'), 'Library') });
    expect(result.hashMismatches).toEqual([victim.assetId]);
  });

  it('records managed assets as missing when the backup excludes files', async () => {
    const { layout, db, repo } = await populated();
    const dest = path.join(tempDir('bk'), 'backup-3');
    await createBackup({ layout, db, repo, destDir: dest, includeAssets: false });
    const result = await restoreBackup({ backupDir: dest, targetRoot: path.join(tempDir('restore'), 'Library') });
    expect(result.missingAssets).toHaveLength(2);
    expect(result.verifiedAssets).toBe(0);
  });

  it('refuses non-empty destinations', async () => {
    const { layout, db, repo } = await populated();
    const dest = tempDir('bk');
    fs.writeFileSync(path.join(dest, 'keep.txt'), 'x');
    await expect(createBackup({ layout, db, repo, destDir: dest, includeAssets: true })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const good = path.join(tempDir('bk'), 'ok');
    await createBackup({ layout, db, repo, destDir: good, includeAssets: true });
    await expect(restoreBackup({ backupDir: good, targetRoot: dest })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});
