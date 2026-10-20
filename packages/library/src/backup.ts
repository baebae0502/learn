import fs from 'node:fs/promises';
import path from 'node:path';
import { LearnError, nowIso, type StorageMode } from '@learn/domain';
import { LibraryRepository, currentVersion, migrate, openDatabase, snapshotDatabase, type Db, type LibraryCounts } from '@learn/db';
import { sha256File } from './hash';
import { ensureLayout, libraryLayout, type LibraryLayout } from './layout';
import { resolveAssetPath } from './resolve';

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
  counts: LibraryCounts;
  countsMatch: boolean;
}

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
  await assertEmptyDir(destDir, '백업 폴더가 비어 있지 않습니다. 새 폴더를 선택하세요.');
  await fs.mkdir(destDir, { recursive: true });
  snapshotDatabase(db, path.join(destDir, 'library.sqlite'));

  const assets: BackupAssetEntry[] = [];
  for (const a of repo.allAssets()) {
    let included = false;
    if (includeAssets && a.storageMode === 'managed' && a.relativePath) {
      const dst = path.join(destDir, ...a.relativePath.split('/'));
      await fs.mkdir(path.dirname(dst), { recursive: true });
      await fs.copyFile(resolveAssetPath(layout, a), dst);
      included = true;
    }
    assets.push({ assetId: a.id, sha256: a.sha256, storageMode: a.storageMode, relativePath: a.relativePath, externalPath: a.externalPath, size: a.size, included });
  }
  const manifest: BackupManifest = {
    format: 'learn-backup', formatVersion: 1, createdAt: nowIso(), schemaVersion: currentVersion(db), counts: repo.counts(), assets,
  };
  await fs.writeFile(path.join(destDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

export async function restoreBackup(args: { backupDir: string; targetRoot: string }): Promise<RestoreResult> {
  const manifest = JSON.parse(await fs.readFile(path.join(args.backupDir, 'manifest.json'), 'utf8')) as BackupManifest;
  if (manifest.format !== 'learn-backup' || manifest.formatVersion !== 1) {
    throw new LearnError('VALIDATION_FAILED', '알 수 없는 백업 형식입니다.');
  }
  await assertEmptyDir(args.targetRoot, '복원 대상 폴더가 비어 있지 않습니다. 빈 폴더를 선택하세요.');
  const layout = libraryLayout(args.targetRoot);
  ensureLayout(layout);
  await fs.copyFile(path.join(args.backupDir, 'library.sqlite'), layout.dbFile);

  let verifiedAssets = 0;
  const missingAssets: string[] = [];
  const hashMismatches: string[] = [];
  for (const entry of manifest.assets) {
    if (entry.storageMode !== 'managed' || !entry.relativePath) continue;
    if (!entry.included) {
      missingAssets.push(entry.assetId);
      continue;
    }
    const dst = path.join(layout.root, ...entry.relativePath.split('/'));
    await fs.mkdir(path.dirname(dst), { recursive: true });
    await fs.copyFile(path.join(args.backupDir, ...entry.relativePath.split('/')), dst);
    if ((await sha256File(dst)) === entry.sha256) verifiedAssets++;
    else hashMismatches.push(entry.assetId);
  }

  const db = openDatabase(layout.dbFile);
  try {
    migrate(db, { dbFile: layout.dbFile });
    const repo = new LibraryRepository(db);
    for (const id of [...missingAssets, ...hashMismatches]) repo.setAvailability(id, 'missing', nowIso());
    const counts = repo.counts();
    const countsMatch =
      counts.items === manifest.counts.items && counts.assets === manifest.counts.assets && counts.revisions === manifest.counts.revisions;
    return { verifiedAssets, missingAssets: missingAssets.sort(), hashMismatches: hashMismatches.sort(), counts, countsMatch };
  } finally {
    db.close();
  }
}
