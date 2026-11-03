import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RESTORE_COPY, newId, nowIso } from '@learn/domain';
import { CollectionsRepository, LATEST_SCHEMA_VERSION, LibraryRepository, migrate, openDatabase, type Db } from '@learn/db';
import { Importer, createBackup, datedFolderName, ensureLayout, libraryLayout, managedRelativePath, resolveAssetPath, readBackupManifest, restoreBackup, sha256File, type BackupProgress, type RestoreProgress } from '../src/index';
import { cleanupTemp, tempDir, writeMp4, writePdf } from './helpers';

/** Every fsync createBackup asks for, with the renames between them, in one order (the durability test reads it). */
const durability = vi.hoisted(() => ({ log: [] as string[][] }));
vi.mock('../src/fsync', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/fsync')>();
  return {
    fsyncFile: async (p: string) => {
      durability.log.push(['fsyncFile', p]);
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
  vi.restoreAllMocks();
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

/** A test that edits a backup's database on purpose: the manifest is made to agree with the edit, so what is under test is not the hash check. */
async function rehash(dir: string): Promise<void> {
  const file = path.join(dir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  manifest.databaseSha256 = await sha256File(path.join(dir, 'library.sqlite'));
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2));
}

describe('backup and restore (AC15 — files part)', () => {
  it('restores into an empty profile with matching hashes and counts', async () => {
    const { layout, db, repo } = await populated();
    const dest = path.join(tempDir('bk'), 'backup-1');
    const { manifest } = await createBackup({ layout, db, repo, destDir: dest, includeAssets: true });
    expect(manifest).toMatchObject({ format: 'learn-backup', formatVersion: 1, schemaVersion: LATEST_SCHEMA_VERSION, counts: { items: 3, assets: 3, revisions: 3, collections: 0, collectionItems: 0, tags: 0, itemTags: 0, readingPositions: 0 } });
    expect(manifest.assets.filter((a) => a.included)).toHaveLength(2); // linked is reference-only

    const target = path.join(tempDir('restore'), 'Library');
    const result = await restoreBackup({ backupDir: dest, targetRoot: target });
    expect(result).toEqual({ verifiedAssets: 2, missingAssets: [], hashMismatches: [], recordMismatches: [], counts: { items: 3, assets: 3, revisions: 3, collections: 0, collectionItems: 0, tags: 0, itemTags: 0, readingPositions: 0, trashedItems: 0, trashedCollections: 0 }, countsMatch: true, backupCreatedAt: manifest.createdAt, managedFiles: 2, problemItems: [] });

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
    const { manifest } = await createBackup({ layout, db, repo, destDir: dest, includeAssets: true });
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
    const { manifest } = await createBackup({ layout, db, repo, destDir: dest, includeAssets: true });
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
    const { manifest } = await createBackup({ layout, db, repo, destDir: dest, includeAssets: true });
    const old = { ...manifest, schemaVersion: 1, counts: { items: 3, assets: 3, revisions: 3 } };
    fs.writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify(old, null, 2));
    const target = path.join(tempDir('restore'), 'Library');
    const result = await restoreBackup({ backupDir: dest, targetRoot: target });
    expect(result.countsMatch).toBe(true);
  });

  it('rejects manifest from a newer schema version', async () => {
    const { layout, db, repo } = await populated();
    const dest = path.join(tempDir('bk'), 'backup-newer-schema');
    const { manifest } = await createBackup({ layout, db, repo, destDir: dest, includeAssets: true });

    const tampered = { ...manifest, schemaVersion: 99 };
    fs.writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify(tampered, null, 2));

    const target = path.join(tempDir('restore'), 'Library');
    await expect(restoreBackup({ backupDir: dest, targetRoot: target })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', message: /더 새로운 버전/ });
  });

  it('cleans up temp dir on restore failure', async () => {
    const { layout, db, repo } = await populated();
    const dest = path.join(tempDir('bk'), 'backup-fail-restore');
    const { manifest } = await createBackup({ layout, db, repo, destDir: dest, includeAssets: true });

    // A manifest that lists an asset its database never had: refused after the copies, so there is a folder to clean up.
    const stranger = { ...manifest.assets.find((a) => a.included)!, assetId: newId(), included: false };
    fs.writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify({ ...manifest, assets: [...manifest.assets, stranger] }, null, 2));

    const target = path.join(tempDir('restore'), 'Library-fail');
    await expect(restoreBackup({ backupDir: dest, targetRoot: target })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', message: RESTORE_COPY.unknownFormat });

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
    const { manifest } = await createBackup({ layout, db, repo, destDir: dest, includeAssets: true });

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
    await rehash(dest);
    const probe = openDatabase(':memory:');
    probe.close();
    const close = vi.spyOn(Object.getPrototypeOf(probe) as { close(): unknown }, 'close');
    const target = path.join(tempDir('restore'), 'Library');
    try {
      await expect(restoreBackup({ backupDir: dest, targetRoot: target })).rejects.toMatchObject({
        code: 'VALIDATION_FAILED', message: RESTORE_COPY.damagedDatabase,
      });
      expect(close).toHaveBeenCalledTimes(1);
      expect((close.mock.contexts[0] as { open: boolean }).open).toBe(false);
      expect(fs.existsSync(target)).toBe(false);
      expect(fs.readdirSync(path.dirname(target)).filter((e) => e.includes('.restoring-'))).toEqual([]);
    } finally {
      close.mockRestore();
    }
  });

  it('a backup whose database opens but is corrupt inside is refused as the backup\'s fault, whichever page is broken — never as the open library (not "restore from a backup")', async () => {
    const { layout, db, repo } = await populated();
    const dest = path.join(tempDir('bk'), 'backup-corrupt-inside');
    await createBackup({ layout, db, repo, destDir: dest, includeAssets: true });
    const PAGE = 4096;
    const whole = fs.readFileSync(path.join(dest, 'library.sqlite'));
    const refused: number[] = [];
    // Page 1 (the header and the schema) stays valid so the file opens; each later page in turn is garbage. Some pages
    // are only read by migrate, some by the first reads, some by the counts: all of them are the backup's damage.
    for (let page = 1; page < whole.length / PAGE; page++) {
      const broken = path.join(tempDir('bk'), `page-${page}`);
      fs.cpSync(dest, broken, { recursive: true });
      const bytes = Buffer.from(whole);
      bytes.fill(0xff, page * PAGE, (page + 1) * PAGE);
      fs.writeFileSync(path.join(broken, 'library.sqlite'), bytes);
      await rehash(broken);
      const target = path.join(tempDir('restore'), 'Library');
      const outcome = await restoreBackup({ backupDir: broken, targetRoot: target }).then(
        () => 'restored',
        (e: unknown) => e,
      );
      expect(outcome, `page ${page}`).toMatchObject({ code: 'VALIDATION_FAILED', message: RESTORE_COPY.damagedDatabase });
      expect(fs.existsSync(target), `page ${page}`).toBe(false);
      expect(fs.readdirSync(path.dirname(target)).filter((e) => e.includes('.restoring-')), `page ${page}`).toEqual([]);
      refused.push(page);
    }
    expect(refused.length).toBeGreaterThan(0);
  });

  it('records the hash of the snapshot it wrote, and a restore refuses a database that no longer matches it before opening it', async () => {
    const { layout, db, repo } = await populated();
    const dest = path.join(tempDir('bk'), 'backup-hash');
    const { manifest } = await createBackup({ layout, db, repo, destDir: dest, includeAssets: true });
    expect(manifest.databaseSha256).toBe(await sha256File(path.join(dest, 'library.sqlite')));
    expect((await readBackupManifest(dest)).databaseSha256).toBe(manifest.databaseSha256);

    const changed = path.join(tempDir('bk'), 'changed');
    fs.cpSync(dest, changed, { recursive: true });
    const edit = openDatabase(path.join(changed, 'library.sqlite'));
    edit.pragma('application_id = 4242');
    edit.close();
    const target = path.join(tempDir('restore'), 'Library');
    await expect(restoreBackup({ backupDir: changed, targetRoot: target })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED', message: RESTORE_COPY.damagedDatabase,
    });
    expect(fs.existsSync(target)).toBe(false);

    const old = path.join(tempDir('bk'), 'old');
    fs.cpSync(dest, old, { recursive: true });
    const { databaseSha256: _drop, ...without } = manifest;
    fs.writeFileSync(path.join(old, 'manifest.json'), JSON.stringify(without));
    const edited = openDatabase(path.join(old, 'library.sqlite'));
    edited.pragma('application_id = 4242');
    edited.close();
    await expect(restoreBackup({ backupDir: old, targetRoot: path.join(tempDir('restore'), 'Library') })).resolves.toBeDefined();
  });

  it('a backup whose database holds a row pointing nowhere is refused as damaged (foreign_key_check)', async () => {
    const { layout, db, repo } = await populated();
    const dest = path.join(tempDir('bk'), 'backup-orphan');
    const { manifest } = await createBackup({ layout, db, repo, destDir: dest, includeAssets: true });
    const file = path.join(dest, 'library.sqlite');
    const edit = openDatabase(file);
    edit.pragma('foreign_keys = OFF');
    edit.prepare('INSERT INTO collection_items (collection_id, item_id) VALUES (?, ?)').run(newId(), newId());
    edit.close();
    // The manifest agrees with the edited file, so only the database's own checks can notice.
    fs.writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify({ ...manifest, databaseSha256: await sha256File(file) }));
    await expect(restoreBackup({ backupDir: dest, targetRoot: path.join(tempDir('restore'), 'Library') })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED', message: RESTORE_COPY.damagedDatabase,
    });
  });

  it('a disk that fills up while the restored database is read is not reported as a damaged backup', async () => {
    const { layout, db, repo } = await populated();
    const dest = path.join(tempDir('bk'), 'backup-full');
    await createBackup({ layout, db, repo, destDir: dest, includeAssets: true });
    const full = Object.assign(new Error('database or disk is full'), { code: 'SQLITE_FULL' });
    vi.spyOn(LibraryRepository.prototype, 'counts').mockImplementation(() => {
      throw full;
    });
    const target = path.join(tempDir('restore'), 'Library');
    const outcome = await restoreBackup({ backupDir: dest, targetRoot: target }).then(
      () => 'restored',
      (e: unknown) => e,
    );
    expect(outcome).toBe(full);
    expect(outcome).not.toMatchObject({ message: RESTORE_COPY.damagedDatabase });
    expect(fs.existsSync(target)).toBe(false);
    expect(fs.readdirSync(path.dirname(target)).filter((e) => e.includes('.restoring-'))).toEqual([]);
  });

  it('a folder where a managed copy should be counts as missing, like an absent file, and does not fail the restore', async () => {
    const { layout, db, repo } = await populated();
    const dest = path.join(tempDir('bk'), 'backup-dir-for-file');
    const { manifest } = await createBackup({ layout, db, repo, destDir: dest, includeAssets: true });
    const victim = manifest.assets.find((a) => a.included)!;
    const file = path.join(dest, ...victim.relativePath!.split('/'));
    fs.rmSync(file);
    fs.mkdirSync(file);
    const target = path.join(tempDir('restore'), 'Library');
    const result = await restoreBackup({ backupDir: dest, targetRoot: target });
    expect(result).toMatchObject({ verifiedAssets: 1, missingAssets: [victim.assetId], hashMismatches: [] });
    expect(fs.existsSync(target)).toBe(true);
    expect(fs.readdirSync(path.dirname(target)).filter((e) => e.includes('.restoring-'))).toEqual([]);
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
    const { manifest } = await createBackup({ layout, db, repo, destDir: dest, includeAssets: true });
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
    const { manifest } = await createBackup({ layout, db, repo, destDir: dest, includeAssets: true });
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
    await rehash(dest);

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

describe('the backup job\'s copy: real bytes, read back, counted, stoppable, flushed (spec 8.1, 8.3, Q-2d)', () => {
  it('reports its bytes — each copy written, then read back — and its files, ending at its totals; sums up what it holds', async () => {
    const { layout, db, repo } = await populated();
    const managed = repo.assetsByMode('managed');
    const dest = path.join(tempDir('bk'), 'progress');
    const seen: BackupProgress[] = [];
    const { manifest, summary } = await createBackup({ layout, db, repo, destDir: dest, includeAssets: true, onProgress: (p) => seen.push(p) });
    const bytes = managed.reduce((n, a) => n + a.size, 0);
    expect(seen[0]).toEqual({ bytesDone: 0, bytesTotal: 2 * bytes, filesDone: 0, filesTotal: 2 });
    expect(seen.at(-1)).toEqual({ bytesDone: 2 * bytes, bytesTotal: 2 * bytes, filesDone: 2, filesTotal: 2 });
    for (let i = 1; i < seen.length; i++) expect(seen[i]!.bytesDone).toBeGreaterThanOrEqual(seen[i - 1]!.bytesDone);
    expect(summary).toEqual({ folder: dest, createdAt: manifest.createdAt, items: 3, trashedItems: 0, files: 2, bytes, linkedItems: 1, missingItems: 0 });
    // A real copy: its own file, not a link to the library's.
    for (const a of managed) {
      const copy = path.join(dest, ...managedRelativePath(a.sha256).split('/'));
      expect(fs.statSync(copy).ino).not.toBe(fs.statSync(resolveAssetPath(layout, a)).ino);
    }
  });

  it('holds the trash: its items and collections are counted apart and its copies are in it; a restore compares those counts too', async () => {
    const { layout, db, repo } = await populated();
    const pdf = repo.listItems().find((i) => i.storageMode === 'managed' && i.type === 'pdf')!;
    repo.trash([pdf.id]);
    const cols = new CollectionsRepository(db);
    cols.softDelete(cols.create({ name: '지운 묶음' }).id);
    const dest = path.join(tempDir('bk'), 'with-trash');
    const { manifest, summary } = await createBackup({ layout, db, repo, destDir: dest, includeAssets: true });
    expect(manifest.counts).toMatchObject({ items: 2, trashedItems: 1, collections: 0, trashedCollections: 1 });
    const entry = manifest.assets.find((a) => a.assetId === pdf.assetId)!;
    expect(entry.included).toBe(true);
    expect(await sha256File(path.join(dest, ...entry.relativePath!.split('/')))).toBe(entry.sha256);
    expect(summary).toMatchObject({ items: 2, trashedItems: 1, files: 2, linkedItems: 1, missingItems: 0 });
    const result = await restoreBackup({ backupDir: dest, targetRoot: path.join(tempDir('restore'), 'Library') });
    expect(result.counts).toMatchObject({ trashedItems: 1, trashedCollections: 1 });
    expect(result.countsMatch).toBe(true);
  });

  it('a managed copy already gone from the library is left out and counted by its items; a linked file is a location only', async () => {
    const { layout, db, repo } = await populated();
    const [gone] = repo.assetsByMode('managed');
    fs.unlinkSync(resolveAssetPath(layout, gone!));
    const { manifest, summary } = await createBackup({ layout, db, repo, destDir: path.join(tempDir('bk'), 'missing'), includeAssets: true });
    expect(manifest.assets.find((a) => a.assetId === gone!.id)).toMatchObject({ included: false });
    expect(summary).toMatchObject({ files: 1, missingItems: 1, linkedItems: 1 });
  });

  it('a copy that reads back different fails the whole backup with HASH_MISMATCH and leaves no folder', async () => {
    const { layout, db, repo } = await populated();
    const parent = tempDir('bk');
    const changed = { afterCopy: (file: string) => fs.appendFileSync(file, 'changed on the way') };
    await expect(createBackup({ layout, db, repo, destDir: path.join(parent, 'mismatch'), includeAssets: true, hooks: changed })).rejects.toMatchObject({ code: 'HASH_MISMATCH' });
    expect(fs.readdirSync(parent)).toEqual([]);
  });

  it('stops when its signal aborts — before it starts, or between a copy and its read-back — and leaves no folder', async () => {
    const { layout, db, repo } = await populated();
    const parent = tempDir('bk');
    await expect(createBackup({ layout, db, repo, destDir: path.join(parent, 'never'), includeAssets: true, signal: AbortSignal.abort() })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fs.readdirSync(parent)).toEqual([]);
    const stop = new AbortController();
    await expect(
      createBackup({ layout, db, repo, destDir: path.join(parent, 'stopped'), includeAssets: true, signal: stop.signal, hooks: { afterCopy: () => stop.abort() } }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fs.readdirSync(parent)).toEqual([]);
  });

  it('stops in the middle of one file\'s stream, after its first chunk, and leaves no folder', async () => {
    const { layout, db, repo } = await populated();
    await new Importer({ layout, repo }).importOne(writePdf(tempDir('big'), 'big.pdf', 'x'.repeat(4 * 1024 * 1024)), { mode: 'managed' });
    const size = repo.assetsByMode('managed').find((a) => a.size > 4 * 1024 * 1024)!.size;
    const parent = tempDir('bk');
    const stop = new AbortController();
    const seen: number[] = [];
    await expect(
      createBackup({
        layout,
        db,
        repo,
        destDir: path.join(parent, 'midstream'),
        includeAssets: true,
        signal: stop.signal,
        onProgress: (p) => {
          seen.push(p.bytesDone);
          // The other files are a few bytes: the first report past 1 MB is the first chunk of the big one, still being written.
          if (p.bytesDone >= 1024 * 1024) stop.abort();
        },
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(Math.max(...seen)).toBeLessThan(size); // not even one copy was written whole, let alone read back
    expect(fs.readdirSync(parent)).toEqual([]);
  });

  it('flushes the database, every copy, their folders and the manifest before the folder takes its name, then the folder it is in', async () => {
    const { layout, db, repo } = await populated();
    const parent = tempDir('bk');
    const dest = path.join(parent, 'durable');
    const realRename = fsp.rename;
    vi.spyOn(fsp, 'rename').mockImplementation(async (from, to) => {
      durability.log.push(['rename', String(from), String(to)]);
      return realRename(from, to);
    });
    durability.log.length = 0;
    const { manifest } = await createBackup({ layout, db, repo, destDir: dest, includeAssets: true });
    const temp = path.dirname(durability.log[0]![1]!);
    expect(path.basename(temp)).toMatch(/^durable\.partial-[0-9a-f-]{36}$/);
    const copies = manifest.assets.filter((a) => a.included).map((a) => path.join(temp, ...a.relativePath!.split('/')));
    expect(durability.log).toEqual([
      ['fsyncFile', path.join(temp, 'library.sqlite')],
      ...copies.map((f) => ['fsyncFile', f]),
      ...[...new Set(copies.map((f) => path.dirname(f)))].map((d) => ['fsyncDir', d]),
      ['fsyncDir', path.join(temp, 'assets')],
      ['fsyncFile', path.join(temp, 'manifest.json')],
      ['fsyncDir', temp],
      ['rename', temp, dest],
      ['fsyncDir', parent],
    ]);
  });
});

describe('datedFolderName (spec 8.1, 9.1)', () => {
  it('names a folder by the local minute, then 2, 3 … past the names taken', () => {
    const when = new Date(2026, 9, 30, 21, 41, 59);
    expect(datedFolderName('Learn 백업', when, () => false)).toBe('Learn 백업 2026-10-30 2141');
    const taken = new Set(['Learn 백업 2026-10-30 2141', 'Learn 백업 2026-10-30 2141 2']);
    expect(datedFolderName('Learn 백업', when, (n) => taken.has(n))).toBe('Learn 백업 2026-10-30 2141 3');
    expect(datedFolderName('Learn 복원', new Date(2026, 0, 5, 9, 7), () => false)).toBe('Learn 복원 2026-01-05 0907');
  });
});

describe('restore: checked first, real copies read back, stoppable, flushed before the folder takes its name; what its problems touch (spec 9, Q-2d)', () => {
  it('readBackupManifest: a backup folder\'s manifest, or why it is not one — before anything is copied', async () => {
    const { layout, db, repo } = await populated();
    const dest = path.join(tempDir('bk'), 'read');
    const { manifest } = await createBackup({ layout, db, repo, destDir: dest, includeAssets: true });
    expect(await readBackupManifest(dest)).toMatchObject({ format: 'learn-backup', createdAt: manifest.createdAt, assets: manifest.assets });

    const empty = tempDir('not-a-backup');
    await expect(readBackupManifest(empty)).rejects.toMatchObject({ code: 'VALIDATION_FAILED', message: RESTORE_COPY.unknownFormat });
    const garbled = path.join(tempDir('bk'), 'garbled');
    fs.cpSync(dest, garbled, { recursive: true });
    fs.writeFileSync(path.join(garbled, 'manifest.json'), '{ not json');
    await expect(readBackupManifest(garbled)).rejects.toMatchObject({ message: RESTORE_COPY.unknownFormat });
    const newer = path.join(tempDir('bk'), 'newer');
    fs.cpSync(dest, newer, { recursive: true });
    fs.writeFileSync(path.join(newer, 'manifest.json'), JSON.stringify({ ...manifest, schemaVersion: 99 }));
    await expect(readBackupManifest(newer)).rejects.toMatchObject({ code: 'VALIDATION_FAILED', message: RESTORE_COPY.newerVersion });
    const headless = path.join(tempDir('bk'), 'no-database');
    fs.cpSync(dest, headless, { recursive: true });
    fs.rmSync(path.join(headless, 'library.sqlite'));
    await expect(readBackupManifest(headless)).rejects.toMatchObject({ message: RESTORE_COPY.unknownFormat });
  });

  it('reports its bytes — each copy written, then read back — and its files; says when the backup was made and how many copies it lists; copies are real', async () => {
    const { layout, db, repo } = await populated();
    const dest = path.join(tempDir('bk'), 'progress');
    const { manifest } = await createBackup({ layout, db, repo, destDir: dest, includeAssets: true });
    const included = manifest.assets.filter((a) => a.included);
    const bytes = included.reduce((n, a) => n + a.size, 0);
    const seen: RestoreProgress[] = [];
    const target = path.join(tempDir('restore'), 'Library');
    const result = await restoreBackup({ backupDir: dest, targetRoot: target, onProgress: (p) => seen.push(p) });
    expect(seen[0]).toEqual({ bytesDone: 0, bytesTotal: 2 * bytes, filesDone: 0, filesTotal: 2 });
    expect(seen.at(-1)).toEqual({ bytesDone: 2 * bytes, bytesTotal: 2 * bytes, filesDone: 2, filesTotal: 2 });
    for (let i = 1; i < seen.length; i++) expect(seen[i]!.bytesDone).toBeGreaterThanOrEqual(seen[i - 1]!.bytesDone);
    expect(result).toMatchObject({ verifiedAssets: 2, backupCreatedAt: manifest.createdAt, managedFiles: 2, problemItems: [] });
    for (const a of included) {
      const copy = path.join(target, ...a.relativePath!.split('/'));
      expect(fs.statSync(copy).ino).not.toBe(fs.statSync(path.join(dest, ...a.relativePath!.split('/'))).ino);
    }
  });

  it('a file the backup lists but no longer holds is missing, not a failure; a changed one is set aside as damaged — never left where its hash says; both name their items, the trash\'s last', async () => {
    const { layout, db, repo } = await populated();
    const [pdf, mp4] = repo.assetsByMode('managed');
    const mp4Item = repo.listItems().find((i) => i.assetId === mp4!.id)!;
    repo.trash([mp4Item.id]);
    const dest = path.join(tempDir('bk'), 'problems');
    await createBackup({ layout, db, repo, destDir: dest, includeAssets: true });
    fs.rmSync(path.join(dest, ...managedRelativePath(pdf!.sha256).split('/')));
    fs.appendFileSync(path.join(dest, ...managedRelativePath(mp4!.sha256).split('/')), 'changed on the way');

    const target = path.join(tempDir('restore'), 'Library');
    const result = await restoreBackup({ backupDir: dest, targetRoot: target });
    expect(result).toMatchObject({ verifiedAssets: 0, missingAssets: [pdf!.id], hashMismatches: [mp4!.id], recordMismatches: [], managedFiles: 2 });
    const pdfItem = repo.listItems().find((i) => i.assetId === pdf!.id)!;
    expect(result.problemItems).toEqual([
      { assetId: pdf!.id, itemId: pdfItem.id, title: pdfItem.title, trashed: false },
      { assetId: mp4!.id, itemId: mp4Item.id, title: mp4Item.title, trashed: true },
    ]);
    // The changed copy waits in staging for the library check (corrupt-…); nothing is where its hash says.
    expect(fs.readdirSync(path.join(target, 'staging'))).toEqual([expect.stringMatching(new RegExp(`^corrupt-${mp4!.sha256}-[0-9a-f-]{36}$`))]);
    for (const a of [pdf!, mp4!]) expect(fs.existsSync(path.join(target, ...managedRelativePath(a.sha256).split('/'))), a.id).toBe(false);
    const rdb = openDatabase(libraryLayout(target).dbFile);
    dbs.push(rdb);
    const restored = new LibraryRepository(rdb);
    for (const a of [pdf!, mp4!]) expect(restored.getAsset(a.id)!.availability, a.id).toBe('missing');
  });

  it('stops when its signal aborts — before it starts, or between a copy and its read-back — and leaves no folder', async () => {
    const { layout, db, repo } = await populated();
    const dest = path.join(tempDir('bk'), 'stop');
    await createBackup({ layout, db, repo, destDir: dest, includeAssets: true });
    const parent = tempDir('restore');
    await expect(restoreBackup({ backupDir: dest, targetRoot: path.join(parent, 'never'), signal: AbortSignal.abort() })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fs.readdirSync(parent)).toEqual([]);
    const stop = new AbortController();
    await expect(
      restoreBackup({ backupDir: dest, targetRoot: path.join(parent, 'stopped'), signal: stop.signal, hooks: { afterCopy: () => stop.abort() } }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fs.readdirSync(parent)).toEqual([]);
  });

  it('flushes the database, every copy, their folders, the database after its marks and the folder before it takes its name; then the folder it is in', async () => {
    const { layout, db, repo } = await populated();
    const dest = path.join(tempDir('bk'), 'durable');
    const { manifest } = await createBackup({ layout, db, repo, destDir: dest, includeAssets: true });
    const parent = tempDir('restore');
    const target = path.join(parent, 'Library');
    const realRename = fsp.rename;
    vi.spyOn(fsp, 'rename').mockImplementation(async (from, to) => {
      durability.log.push(['rename', String(from), String(to)]);
      return realRename(from, to);
    });
    durability.log.length = 0;
    await restoreBackup({ backupDir: dest, targetRoot: target });
    const temp = path.dirname(durability.log[0]![1]!);
    expect(path.basename(temp)).toMatch(/^Library\.restoring-[0-9a-f-]{36}$/);
    const copies = manifest.assets.filter((a) => a.included).map((a) => path.join(temp, ...a.relativePath!.split('/')));
    expect(durability.log).toEqual([
      ['fsyncFile', path.join(temp, 'library.sqlite')],
      ...copies.map((f) => ['fsyncFile', f]),
      ...[...new Set(copies.map((f) => path.dirname(f)))].map((d) => ['fsyncDir', d]),
      ['fsyncDir', path.join(temp, 'assets')],
      ['fsyncFile', path.join(temp, 'library.sqlite')],
      ['fsyncDir', temp],
      ['rename', temp, target],
      ['fsyncDir', parent],
    ]);
  });
});

describe('two managed rows that share a hash (a library edited by hand or imported by an older version)', () => {
  /** A second managed asset row for the first managed asset's bytes, with an item of its own. */
  function addTwin(db: Db, repo: LibraryRepository) {
    // The schema allows one managed asset per hash; a library edited by hand may not.
    db.exec('DROP INDEX assets_managed_sha256');
    const first = repo.assetsByMode('managed')[0]!;
    const now = nowIso();
    repo.insertImported({
      item: { id: newId(), type: 'pdf', title: 'twin', createdAt: now },
      asset: { ...first, id: newId(), createdAt: now, checkedAt: now },
      assetIsNew: true,
      revision: { id: newId(), createdAt: now },
      job: { id: newId(), kind: 'extract', dedupeKey: `extract:twin:${newId()}`, payload: {} },
      collectionId: null,
    });
    return first;
  }

  it('backs up one copy for the pair, lists both rows as included, and counts the file once', async () => {
    const { layout, db, repo } = await populated();
    const first = addTwin(db, repo);
    const dest = path.join(tempDir('bk'), 'backup-twin');
    const { manifest, summary } = await createBackup({ layout, db, repo, destDir: dest, includeAssets: true });
    const twins = manifest.assets.filter((a) => a.sha256 === first.sha256);
    expect(twins).toHaveLength(2);
    expect(twins.every((a) => a.included)).toBe(true);
    expect(summary.files).toBe(2); // the pair's one copy and the video
    expect(summary.missingItems).toBe(0);
  });

  it('restores the pair from its one copy: both rows verified, no failure', async () => {
    const { layout, db, repo } = await populated();
    addTwin(db, repo);
    const dest = path.join(tempDir('bk'), 'backup-twin');
    await createBackup({ layout, db, repo, destDir: dest, includeAssets: true });
    const progress: RestoreProgress[] = [];
    const result = await restoreBackup({ backupDir: dest, targetRoot: path.join(tempDir('restore'), 'Library'), onProgress: (p) => progress.push(p) });
    expect(result).toMatchObject({ verifiedAssets: 3, missingAssets: [], hashMismatches: [], countsMatch: true });
    expect(progress.at(-1)).toMatchObject({ filesDone: 2, filesTotal: 2 });
  });
});
