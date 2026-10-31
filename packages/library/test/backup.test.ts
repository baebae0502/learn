import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { newId, nowIso } from '@learn/domain';
import { LATEST_SCHEMA_VERSION, LibraryRepository, migrate, openDatabase, type Db } from '@learn/db';
import { Importer, createBackup, ensureLayout, libraryLayout, managedRelativePath, resolveAssetPath, restoreBackup, sha256File } from '../src/index';
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
    expect(manifest).toMatchObject({ format: 'learn-backup', formatVersion: 1, schemaVersion: LATEST_SCHEMA_VERSION, counts: { items: 3, assets: 3, revisions: 3, collections: 0, collectionItems: 0, tags: 0, itemTags: 0, readingPositions: 0 } });
    expect(manifest.assets.filter((a) => a.included)).toHaveLength(2); // linked is reference-only

    const target = path.join(tempDir('restore'), 'Library');
    const result = await restoreBackup({ backupDir: dest, targetRoot: target });
    expect(result).toEqual({ verifiedAssets: 2, missingAssets: [], hashMismatches: [], recordMismatches: [], counts: { items: 3, assets: 3, revisions: 3, collections: 0, collectionItems: 0, tags: 0, itemTags: 0, readingPositions: 0 }, countsMatch: true });

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

  it('rejects tampered manifest with path traversal', async () => {
    const { layout, db, repo } = await populated();
    const dest = path.join(tempDir('bk'), 'backup-tampered');
    const manifest = await createBackup({ layout, db, repo, destDir: dest, includeAssets: true });
    const victim = manifest.assets.find((a) => a.included)!;

    // Tamper manifest to include path traversal
    const tampered = { ...manifest, assets: manifest.assets.map((a) => a.assetId === victim.assetId ? { ...a, relativePath: '../../escape' } : a) };
    fs.writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify(tampered, null, 2));

    const target = path.join(tempDir('restore'), 'Library');
    await expect(restoreBackup({ backupDir: dest, targetRoot: target })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    // Verify no escape file was created outside
    expect(fs.existsSync(path.join(target, '..', 'escape'))).toBe(false);
  });

  it('rejects malformed manifest JSON', async () => {
    const { layout, db, repo } = await populated();
    const dest = path.join(tempDir('bk'), 'backup-bad-json');
    await createBackup({ layout, db, repo, destDir: dest, includeAssets: true });

    fs.writeFileSync(path.join(dest, 'manifest.json'), 'not json');

    const target = path.join(tempDir('restore'), 'Library');
    await expect(restoreBackup({ backupDir: dest, targetRoot: target })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('restores from an old manifest that lacks the optional counts', async () => {
    const { layout, db, repo } = await populated();
    const dest = path.join(tempDir('bk'), 'backup-old-manifest');
    const manifest = await createBackup({ layout, db, repo, destDir: dest, includeAssets: true });
    const old = { ...manifest, schemaVersion: 1, counts: { items: 3, assets: 3, revisions: 3 } };
    fs.writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify(old, null, 2));
    const target = path.join(tempDir('restore'), 'Library');
    const result = await restoreBackup({ backupDir: dest, targetRoot: target });
    expect(result.countsMatch).toBe(true);
  });

  it('rejects manifest from a newer schema version', async () => {
    const { layout, db, repo } = await populated();
    const dest = path.join(tempDir('bk'), 'backup-newer-schema');
    const manifest = await createBackup({ layout, db, repo, destDir: dest, includeAssets: true });

    const tampered = { ...manifest, schemaVersion: 99 };
    fs.writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify(tampered, null, 2));

    const target = path.join(tempDir('restore'), 'Library');
    await expect(restoreBackup({ backupDir: dest, targetRoot: target })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', message: /더 새로운 버전/ });
  });

  it('cleans up temp dir on restore failure', async () => {
    const { layout, db, repo } = await populated();
    const dest = path.join(tempDir('bk'), 'backup-fail-restore');
    const manifest = await createBackup({ layout, db, repo, destDir: dest, includeAssets: true });

    // Delete one included asset file to cause restore failure
    const victim = manifest.assets.find((a) => a.included)!;
    fs.unlinkSync(path.join(dest, ...victim.relativePath!.split('/')));

    const target = path.join(tempDir('restore'), 'Library-fail');
    await expect(restoreBackup({ backupDir: dest, targetRoot: target })).rejects.toBeDefined();

    // Verify targetRoot does not exist after failed restore
    expect(fs.existsSync(target)).toBe(false);

    // Verify no .restoring-* temp dir remains
    const parent = path.dirname(target);
    const entries = fs.readdirSync(parent);
    expect(entries.filter((e) => e.includes('.restoring-'))).toHaveLength(0);

    // Verify we can restore the same backup to the same target afterwards
    const goodDest = path.join(tempDir('bk'), 'backup-restore-ok');
    await createBackup({ layout, db, repo, destDir: goodDest, includeAssets: true });
    const goodResult = await restoreBackup({ backupDir: goodDest, targetRoot: target });
    expect(goodResult.verifiedAssets).toBe(2);
  });

  it('backs up successfully when a managed file is missing in the live library', async () => {
    const { layout, db, repo } = await populated();

    // Get the list of assets before deletion
    const allAssets = repo.allAssets();
    const managedAsset = allAssets.find((a) => a.storageMode === 'managed')!;

    // Delete the managed asset file from the live library
    const assetPath = resolveAssetPath(layout, managedAsset);
    fs.unlinkSync(assetPath);

    // Backup should succeed and record the lost file as not included
    const dest = path.join(tempDir('bk'), 'backup-lost-file');
    const manifest = await createBackup({ layout, db, repo, destDir: dest, includeAssets: true });

    const entry = manifest.assets.find((a) => a.assetId === managedAsset.id)!;
    expect(entry.included).toBe(false);

    // Restore should record it as missing
    const target = path.join(tempDir('restore'), 'Library-lost');
    const result = await restoreBackup({ backupDir: dest, targetRoot: target });
    expect(result.missingAssets).toContain(managedAsset.id);
  });
  it('refuses a backup whose database is not a database: the handle it opened is closed and no folder is left', async () => {
    const { layout, db, repo } = await populated();
    const dest = path.join(tempDir('bk'), 'backup-notadb');
    await createBackup({ layout, db, repo, destDir: dest, includeAssets: true });
    fs.writeFileSync(path.join(dest, 'library.sqlite'), 'not a database, '.repeat(64));
    const probe = openDatabase(':memory:');
    probe.close();
    const close = vi.spyOn(Object.getPrototypeOf(probe) as { close(): unknown }, 'close');
    const target = path.join(tempDir('restore'), 'Library');
    try {
      await expect(restoreBackup({ backupDir: dest, targetRoot: target })).rejects.toMatchObject({
        code: 'VALIDATION_FAILED', message: '백업의 라이브러리 데이터가 손상되었습니다. 다른\u00a0백업을 선택하세요.',
      });
      expect(close).toHaveBeenCalledTimes(1);
      expect((close.mock.contexts[0] as { open: boolean }).open).toBe(false);
      expect(fs.existsSync(target)).toBe(false);
      expect(fs.readdirSync(path.dirname(target)).filter((e) => e.includes('.restoring-'))).toEqual([]);
    } finally {
      close.mockRestore();
    }
  });

  it('copies each managed file from the path its hash names, not the path its row claims, and restore names the row', async () => {
    const { layout, db, repo } = await populated();
    // populated() imports the pdf before the mp4: assetsByMode orders by created_at, rowid.
    const managed = repo.assetsByMode('managed');
    const pdf = managed[0]!;
    const mp4 = managed[1]!;
    // The pdf's row now claims the mp4's file.
    db.prepare('UPDATE assets SET relative_path = ? WHERE id = ?').run(mp4.relativePath, pdf.id);
    const dest = path.join(tempDir('bk'), 'backup-derived');
    const manifest = await createBackup({ layout, db, repo, destDir: dest, includeAssets: true });
    expect(manifest.assets.find((a) => a.assetId === pdf.id)).toMatchObject({ included: true, relativePath: managedRelativePath(pdf.sha256) });
    expect(await sha256File(path.join(dest, ...managedRelativePath(pdf.sha256).split('/')))).toBe(pdf.sha256);

    const target = path.join(tempDir('restore'), 'Library');
    const result = await restoreBackup({ backupDir: dest, targetRoot: target });
    expect(result).toMatchObject({ verifiedAssets: 2, missingAssets: [], hashMismatches: [], recordMismatches: [pdf.id] });
    const rdb = openDatabase(libraryLayout(target).dbFile);
    dbs.push(rdb);
    const restored = new LibraryRepository(rdb);
    expect(restored.getAsset(pdf.id)!.availability).toBe('missing'); // its row points at another file
    expect(restored.getAsset(mp4.id)!.availability).toBe('available');
  });

  it('does not copy a managed row whose hash is not a sha256: it is recorded as not included', async () => {
    const { layout, db, repo } = await populated();
    const [pdf] = repo.assetsByMode('managed');
    const odd = 'g'.repeat(64);
    db.prepare('UPDATE assets SET sha256 = ? WHERE id = ?').run(odd, pdf!.id);
    const dest = path.join(tempDir('bk'), 'backup-odd-sha');
    const manifest = await createBackup({ layout, db, repo, destDir: dest, includeAssets: true });
    expect(manifest.assets.find((a) => a.assetId === pdf!.id)).toMatchObject({ included: false, sha256: odd });
    expect(fs.existsSync(path.join(dest, 'assets', 'gg'))).toBe(false);
  });

  it('restore cross-checks the database against the manifest: a changed hash, a changed path, a row the manifest never listed', async () => {
    const { layout, db, repo } = await populated();
    const dest = path.join(tempDir('bk'), 'backup-cross');
    await createBackup({ layout, db, repo, destDir: dest, includeAssets: true });
    const [a, b] = repo.assetsByMode('managed');
    const [linked] = repo.assetsByMode('linked');
    // Edit the backup's database, not the live one.
    const bdb = openDatabase(path.join(dest, 'library.sqlite'));
    bdb.prepare('UPDATE assets SET sha256 = ? WHERE id = ?').run('e'.repeat(64), a!.id);
    bdb.prepare('UPDATE assets SET relative_path = ? WHERE id = ?').run('assets/zz/elsewhere', b!.id);
    const extra = newId();
    const sha = 'd'.repeat(64);
    bdb.prepare(`INSERT INTO assets (id, sha256, storage_mode, relative_path, external_path, original_name, mime, size, availability, created_at, checked_at)
                 VALUES (?, ?, 'managed', ?, NULL, 'extra.pdf', 'application/pdf', 1, 'available', ?, ?)`).run(extra, sha, managedRelativePath(sha), nowIso(), nowIso());
    bdb.close();

    const target = path.join(tempDir('restore'), 'Library');
    const result = await restoreBackup({ backupDir: dest, targetRoot: target });
    expect(result.recordMismatches).toEqual([a!.id, b!.id, extra].sort());
    expect(result).toMatchObject({ verifiedAssets: 2, missingAssets: [], hashMismatches: [], countsMatch: false }); // one asset more than the manifest counted
    const rdb = openDatabase(libraryLayout(target).dbFile);
    dbs.push(rdb);
    const restored = new LibraryRepository(rdb);
    for (const id of [a!.id, b!.id, extra]) expect(restored.getAsset(id)!.availability, id).toBe('missing');
    expect(restored.getAsset(linked!.id)!.availability).toBe('available');
  });
});
