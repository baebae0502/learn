import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { LearnError, newId, nowIso, toLearnError, type StorageMode } from '@learn/domain';
import { LATEST_SCHEMA_VERSION, LibraryRepository, currentVersion, migrate, openDatabase, snapshotDatabase, type Db, type LibraryCounts } from '@learn/db';
import { sha256File } from './hash';
import { SHA256_HEX, ensureLayout, libraryLayout, managedRelativePath, type LibraryLayout } from './layout';

export interface BackupAssetEntry {
  assetId: string;
  sha256: string;
  storageMode: StorageMode;
  relativePath: string | null;
  externalPath: string | null;
  size: number;
  /** Linked assets are never included: external paths are not portable. */
  included: boolean;
}

export interface BackupManifest {
  format: 'learn-backup';
  formatVersion: 1;
  createdAt: string;
  schemaVersion: number;
  counts: LibraryCounts;
  assets: BackupAssetEntry[];
}

export interface RestoreResult {
  verifiedAssets: number;
  missingAssets: string[];
  hashMismatches: string[];
  /**
   * Assets whose row in the restored database disagrees with the manifest (sha256, storage mode, relative path), or that
   * only the database lists (spec 9.2). A managed one is marked missing: its row cannot be trusted to find the file.
   */
  recordMismatches: string[];
  counts: LibraryCounts;
  countsMatch: boolean;
}

const BackupAssetEntrySchema = z.object({
  assetId: z.string().uuid(),
  sha256: z.string(),
  storageMode: z.enum(['managed', 'linked']),
  relativePath: z.string().nullable(),
  externalPath: z.string().nullable(),
  size: z.number().int().nonnegative(),
  included: z.boolean(),
});

const BackupManifestSchema = z.object({
  format: z.literal('learn-backup'),
  formatVersion: z.literal(1),
  createdAt: z.string(),
  schemaVersion: z.number().int().nonnegative(),
  counts: z.object({
    items: z.number().int().nonnegative(),
    assets: z.number().int().nonnegative(),
    revisions: z.number().int().nonnegative(),
    collections: z.number().int().nonnegative().optional(),
    collectionItems: z.number().int().nonnegative().optional(),
    tags: z.number().int().nonnegative().optional(),
    itemTags: z.number().int().nonnegative().optional(),
    readingPositions: z.number().int().nonnegative().optional(),
  }),
  assets: z.array(BackupAssetEntrySchema),
});

async function assertEmptyDir(dir: string, message: string): Promise<void> {
  try {
    if ((await fs.readdir(dir)).length > 0) throw new LearnError('VALIDATION_FAILED', message);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
}

/** Consistent DB snapshot (VACUUM INTO) + managed asset copies + manifest. */
export async function createBackup(args: {
  layout: LibraryLayout; db: Db; repo: LibraryRepository; destDir: string; includeAssets: boolean;
}): Promise<BackupManifest> {
  const { layout, db, repo, destDir, includeAssets } = args;
  await assertEmptyDir(destDir, '백업 폴더가 비어 있지 않습니다. 새\u00a0폴더를 선택하세요.');

  const tempDir = `${path.resolve(destDir)}.partial-${newId()}`;
  await fs.mkdir(tempDir, { recursive: true });

  try {
    const tempDbFile = path.join(tempDir, 'library.sqlite');
    snapshotDatabase(db, tempDbFile);

    // Captured immediately after snapshotDatabase with no awaits in between.
    // This relies on the main process owning the only connection (single write queue),
    // so no import can interleave and cause disagreement between snapshot and metadata.
    const allAssets = repo.allAssets();
    const countsAtSnapshot = repo.counts();
    const schemaVersion = currentVersion(db);

    const assets: BackupAssetEntry[] = [];
    for (const a of allAssets) {
      // A managed copy is found from its hash, where the importer put it, never from the path its row claims (spec 8.1).
      // The manifest says where the bytes for that hash are; restore checks the row against it (9.2).
      const rel = a.storageMode === 'managed' && SHA256_HEX.test(a.sha256) ? managedRelativePath(a.sha256) : null;
      let included = false;
      if (includeAssets && rel !== null) {
        const dst = path.join(tempDir, ...rel.split('/'));
        try {
          await fs.mkdir(path.dirname(dst), { recursive: true });
          await fs.copyFile(path.join(layout.root, ...rel.split('/')), dst);
          included = true;
        } catch (e) {
          // A copy already lost from the library is recorded as not included; restore marks it missing.
          if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
        }
      }
      assets.push({
        assetId: a.id, sha256: a.sha256, storageMode: a.storageMode, relativePath: rel ?? a.relativePath, externalPath: a.externalPath, size: a.size, included,
      });
    }

    const manifest: BackupManifest = {
      format: 'learn-backup', formatVersion: 1, createdAt: nowIso(), schemaVersion, counts: countsAtSnapshot, assets,
    };
    await fs.writeFile(path.join(tempDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    // Move temp to dest on success
    try {
      await fs.rmdir(destDir);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    await fs.rename(tempDir, destDir);

    return manifest;
  } catch (e) {
    await fs.rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

/** The backup's own database cannot be read: the backup is what is broken, not the library the user has open. */
function unreadableBackup(e: unknown): unknown {
  return toLearnError(e).code === 'LIBRARY_UNAVAILABLE'
    ? new LearnError('VALIDATION_FAILED', '백업의 라이브러리 데이터가 손상되었습니다. 다른\u00a0백업을 선택하세요.', { cause: e })
    : e;
}

export async function restoreBackup(args: { backupDir: string; targetRoot: string }): Promise<RestoreResult> {
  let manifestText: string;
  try {
    manifestText = await fs.readFile(path.join(args.backupDir, 'manifest.json'), 'utf8');
  } catch (e) {
    throw new LearnError('VALIDATION_FAILED', '알 수 없는 백업 형식입니다.');
  }

  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestText);
  } catch (e) {
    throw new LearnError('VALIDATION_FAILED', '알 수 없는 백업 형식입니다.');
  }

  const parseResult = BackupManifestSchema.safeParse(manifest);
  if (!parseResult.success) {
    throw new LearnError('VALIDATION_FAILED', '알 수 없는 백업 형식입니다.');
  }

  // Schema-inferred type: counts added in schema v2 stay optional for manifests written before them.
  const validatedManifest = parseResult.data;

  if (validatedManifest.schemaVersion > LATEST_SCHEMA_VERSION) {
    throw new LearnError('VALIDATION_FAILED', '이\u00a0백업은 더 새로운 버전의 앱에서 만들어졌습니다.');
  }

  await assertEmptyDir(args.targetRoot, '복원 대상 폴더가 비어 있지 않습니다. 빈 폴더를 선택하세요.');

  const tempDir = `${path.resolve(args.targetRoot)}.restoring-${newId()}`;
  await fs.mkdir(tempDir, { recursive: true });

  try {
    const tempLayout = libraryLayout(tempDir);
    ensureLayout(tempLayout);
    await fs.copyFile(path.join(args.backupDir, 'library.sqlite'), tempLayout.dbFile);

    let verifiedAssets = 0;
    const missingAssets: string[] = [];
    const hashMismatches: string[] = [];

    for (const entry of validatedManifest.assets) {
      if (entry.storageMode !== 'managed' || !entry.relativePath) continue;

      if (!entry.included) {
        missingAssets.push(entry.assetId);
        continue;
      }

      // Validate manifest paths to prevent traversal attacks
      if (!SHA256_HEX.test(entry.sha256)) {
        throw new LearnError('VALIDATION_FAILED', '백업 목록(manifest)이 손상되었습니다.');
      }

      const expectedPath = managedRelativePath(entry.sha256);
      if (entry.relativePath !== expectedPath) {
        throw new LearnError('VALIDATION_FAILED', '백업 목록(manifest)이 손상되었습니다.');
      }

      const dst = path.join(tempLayout.root, expectedPath);
      await fs.mkdir(path.dirname(dst), { recursive: true });
      await fs.copyFile(path.join(args.backupDir, ...expectedPath.split('/')), dst);

      if ((await sha256File(dst)) === entry.sha256) {
        verifiedAssets++;
      } else {
        hashMismatches.push(entry.assetId);
      }
    }

    let db: Db;
    try {
      db = openDatabase(tempLayout.dbFile);
    } catch (e) {
      throw unreadableBackup(e);
    }
    try {
      migrate(db, { dbFile: tempLayout.dbFile });
      const repo = new LibraryRepository(db);

      // Check that all entries in the manifest exist in the restored DB
      for (const entry of validatedManifest.assets) {
        if (!repo.getAsset(entry.assetId)) {
          throw new LearnError('VALIDATION_FAILED', '알 수 없는 백업 형식입니다.');
        }
      }

      // The database and the manifest describe the same assets (spec 9.2). A row that disagrees with its entry, or one the
      // manifest never listed, cannot be trusted to find its file: a managed one is shown as missing.
      const entries = new Map(validatedManifest.assets.map((e) => [e.assetId, e]));
      const recordMismatches: string[] = [];
      const unfound = new Set<string>([...missingAssets, ...hashMismatches]);
      for (const row of repo.allAssets()) {
        const entry = entries.get(row.id);
        if (entry && entry.sha256 === row.sha256 && entry.storageMode === row.storageMode && entry.relativePath === row.relativePath) continue;
        recordMismatches.push(row.id);
        if (row.storageMode === 'managed') unfound.add(row.id);
      }
      for (const id of unfound) repo.setAvailability(id, 'missing', nowIso());

      const counts = repo.counts();
      // Only compare fields the manifest has (older manifests lack the newer ones; counts() always fills every field).
      const expected = validatedManifest.counts;
      const countsMatch = (Object.keys(expected) as (keyof typeof expected)[]).every((k) => expected[k] === undefined || expected[k] === counts[k]);

      // Close DB before rename to ensure clean state
      db.close();

      // Move temp to target on success
      if (args.targetRoot) {
        try {
          await fs.rmdir(args.targetRoot);
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
        }
      }
      await fs.rename(tempDir, args.targetRoot);

      return {
        verifiedAssets,
        missingAssets: missingAssets.sort(),
        hashMismatches: hashMismatches.sort(),
        recordMismatches: recordMismatches.sort(),
        counts,
        countsMatch,
      };
    } catch (e) {
      if (db.open) db.close();
      throw e;
    }
  } catch (e) {
    await fs.rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}
