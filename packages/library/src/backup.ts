import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { LearnError, RESTORE_COPY, newId, nowIso, type StorageMode } from '@learn/domain';
import { LATEST_SCHEMA_VERSION, LibraryRepository, currentVersion, migrate, openDatabase, snapshotDatabase, type AssetItem, type Db, type LibraryCounts } from '@learn/db';
import { withManagedPath } from './asset-lock';
import { fsyncDir, fsyncFile } from './fsync';
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
  /** When the backup was made (its manifest's createdAt): the result sheet says which backup it was. */
  backupCreatedAt: string;
  /** Managed copies the manifest lists, included or not: the sheet's "N개 중 M개 확인" (spec 9.3). */
  managedFiles: number;
  /** The items, the trash's too, whose file a problem above touches — live ones first (the sheet names them). */
  problemItems: AssetItem[];
}

/** How far a restore is: every copy is written, then read back, so its bytes count twice (as a backup's). */
export interface RestoreProgress {
  bytesDone: number;
  bytesTotal: number;
  filesDone: number;
  filesTotal: number;
}

/** The backup's fault points serve the restore too (E2E: main/test-hooks.ts restorePause). Production passes none. */
export type RestoreHooks = BackupHooks;

export interface RestoreArgs {
  backupDir: string;
  /** A folder that does not exist yet (or is empty): the restore never writes into a library in use. */
  targetRoot: string;
  /** The work line's stop (취소, quitting): the restore ends at its next checkpoint and leaves nothing. */
  signal?: AbortSignal;
  onProgress?(progress: RestoreProgress): void;
  hooks?: RestoreHooks;
}

/** How far a backup is (spec 8.1): every copy is written, then read back, so its bytes count twice. */
export interface BackupProgress {
  bytesDone: number;
  bytesTotal: number;
  filesDone: number;
  filesTotal: number;
}

/** Fault points for tests (E2E: main/test-hooks.ts). Production passes none. */
export interface BackupHooks {
  /** A managed copy is written and flushed into the backup, not yet read back. */
  afterCopy?(file: string): void | Promise<void>;
}

/** What the result sheet says (spec 8.2): items by item, files by copy. */
export interface BackupSummary {
  folder: string;
  createdAt: string;
  items: number;
  trashedItems: number;
  files: number;
  bytes: number;
  /** Items whose file is a location only (linked), and items whose managed copy was already gone. */
  linkedItems: number;
  missingItems: number;
}

export interface BackupResult {
  manifest: BackupManifest;
  summary: BackupSummary;
}

export interface CreateBackupArgs {
  layout: LibraryLayout;
  db: Db;
  repo: LibraryRepository;
  destDir: string;
  includeAssets: boolean;
  /** The work line's stop (취소, quitting): the backup ends at its next checkpoint and leaves nothing. */
  signal?: AbortSignal;
  onProgress?(progress: BackupProgress): void;
  hooks?: BackupHooks;
  /** The moment the backup is of (the manifest's createdAt); the job names the folder from the same moment. */
  createdAt?: Date;
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
    trashedItems: z.number().int().nonnegative().optional(),
    trashedCollections: z.number().int().nonnegative().optional(),
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

/** Read and written in pieces this big: the bar moves inside a large file, and a stop is never far off. */
const COPY_CHUNK = 1024 * 1024;
/** Names tried after the plain one (" 2" … " 999"). */
const DATED_NAME_TRIES = 999;

/** `<prefix> YYYY-MM-DD HHmm` in local time, then ` 2`, ` 3` … while `taken` says the name is used (spec 8.1, 9.1). */
export function datedFolderName(prefix: string, when: Date, taken: (name: string) => boolean): string {
  const two = (n: number): string => String(n).padStart(2, '0');
  const base = `${prefix} ${when.getFullYear()}-${two(when.getMonth() + 1)}-${two(when.getDate())} ${two(when.getHours())}${two(when.getMinutes())}`;
  if (!taken(base)) return base;
  for (let n = 2; n <= DATED_NAME_TRIES; n++) {
    const name = `${base} ${n}`;
    if (!taken(name)) return name;
  }
  throw new LearnError('INTERNAL', '같은 이름의 폴더가 너무 많습니다. 다른 폴더를 고르세요.');
}

/**
 * A real copy of the bytes, never a clone (COPYFILE_FICLONE): a backup that shares its blocks with the library is not a
 * second copy. Counted chunk by chunk; the signal stops it between chunks.
 */
async function copyCounting(src: string, dst: string, signal: AbortSignal | undefined, onBytes: (n: number) => void): Promise<void> {
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      onBytes(chunk.length);
      done(null, chunk);
    },
  });
  await pipeline(createReadStream(src, { highWaterMark: COPY_CHUNK }), counter, createWriteStream(dst, { flags: 'wx' }), signal ? { signal } : {});
}

/**
 * One managed copy into the backup (spec 8.1): written, flushed (fsync), then read back and checked against its hash — a
 * copy that reads back different fails the whole backup. The read may be answered from the OS page cache, which Node
 * cannot drop portably, so it shows the bytes that were written, not a second trip to the disk. False: the library's copy is gone.
 */
async function backUpCopy(
  layout: LibraryLayout,
  tempDir: string,
  rel: string,
  sha256: string,
  shards: Set<string>,
  opts: { signal: AbortSignal | undefined; onBytes: (n: number) => void; hooks: BackupHooks | undefined },
): Promise<boolean> {
  const src = path.join(layout.root, ...rel.split('/'));
  try {
    await fs.stat(src);
  } catch (e) {
    // A copy already lost from the library is recorded as not included; restore marks it missing.
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw e;
  }
  const dst = path.join(tempDir, ...rel.split('/'));
  const shard = path.dirname(dst);
  await fs.mkdir(shard, { recursive: true });
  shards.add(shard);
  await copyCounting(src, dst, opts.signal, opts.onBytes);
  await fsyncFile(dst);
  await opts.hooks?.afterCopy?.(dst);
  if ((await sha256File(dst, { signal: opts.signal, onBytes: opts.onBytes })) !== sha256) {
    throw new LearnError('HASH_MISMATCH', '백업한 사본의 내용이 원래 자료와 다릅니다.');
  }
  return true;
}

/**
 * Consistent DB snapshot (VACUUM INTO) + managed asset copies, each read back + manifest, in a sibling `.partial-<id>`
 * folder that takes `destDir`'s name only when all of it is on the disk (spec 8.1: all or nothing).
 */
export async function createBackup(args: CreateBackupArgs): Promise<BackupResult> {
  const { layout, db, repo, destDir, includeAssets, signal, onProgress, hooks } = args;
  signal?.throwIfAborted();
  await assertEmptyDir(destDir, '백업 폴더가 비어 있지 않습니다. 새 폴더를 선택하세요.');
  const dest = path.resolve(destDir);
  const parent = path.dirname(dest);
  const tempDir = `${dest}.partial-${newId()}`;
  await fs.mkdir(tempDir, { recursive: true });

  try {
    signal?.throwIfAborted();
    const tempDbFile = path.join(tempDir, 'library.sqlite');
    snapshotDatabase(db, tempDbFile);

    // Captured immediately after snapshotDatabase with no awaits in between.
    // This relies on the main process owning the only connection (single write queue),
    // so no import can interleave and cause disagreement between snapshot and metadata.
    const allAssets = repo.allAssets();
    const countsAtSnapshot = repo.counts();
    const itemsOf = repo.itemCountsByAsset();
    const schemaVersion = currentVersion(db);
    const createdAt = (args.createdAt ?? new Date()).toISOString();
    await fsyncFile(tempDbFile);

    // A managed copy is found from its hash, where the importer put it, never from the path its row claims (spec 8.1).
    const plan = allAssets.map((asset) => ({ asset, rel: asset.storageMode === 'managed' && SHA256_HEX.test(asset.sha256) ? managedRelativePath(asset.sha256) : null }));
    const copies = includeAssets ? plan.filter((p) => p.rel !== null) : [];
    const progress: BackupProgress = { bytesDone: 0, bytesTotal: copies.reduce((n, p) => n + 2 * p.asset.size, 0), filesDone: 0, filesTotal: copies.length };
    const report = (): void => onProgress?.({ ...progress });
    report();

    const shards = new Set<string>();
    const assets: BackupAssetEntry[] = [];
    let files = 0;
    let bytes = 0;
    let linkedItems = 0;
    let missingItems = 0;
    for (const { asset: a, rel } of plan) {
      let included = false;
      if (includeAssets && rel !== null) {
        signal?.throwIfAborted();
        const share = 2 * a.size;
        const before = progress.bytesDone;
        let moved = 0;
        const onBytes = (n: number): void => {
          moved += n;
          progress.bytesDone = before + Math.min(share, moved);
          report();
        };
        // The copy and its read-back hold the path: a purge or a re-import of the same file waits (Task 5).
        included = await withManagedPath(rel, () => backUpCopy(layout, tempDir, rel, a.sha256, shards, { signal, onBytes, hooks }));
        progress.bytesDone = before + share;
        if (included) {
          progress.filesDone += 1;
          files += 1;
          bytes += a.size;
        }
        report();
      }
      if (a.storageMode === 'linked') linkedItems += itemsOf.get(a.id) ?? 0;
      else if (!included) missingItems += itemsOf.get(a.id) ?? 0;
      assets.push({ assetId: a.id, sha256: a.sha256, storageMode: a.storageMode, relativePath: rel ?? a.relativePath, externalPath: a.externalPath, size: a.size, included });
    }
    // The folders after the files in them: every copy's name is on the disk before the manifest says it is there.
    for (const shard of shards) await fsyncDir(shard);
    if (shards.size > 0) await fsyncDir(path.join(tempDir, 'assets'));

    const manifest: BackupManifest = { format: 'learn-backup', formatVersion: 1, createdAt, schemaVersion, counts: countsAtSnapshot, assets };
    const manifestFile = path.join(tempDir, 'manifest.json');
    await fs.writeFile(manifestFile, JSON.stringify(manifest, null, 2));
    await fsyncFile(manifestFile);
    await fsyncDir(tempDir);
    // The last point a stop leaves nothing behind: past it the folder appears whole.
    signal?.throwIfAborted();

    try {
      await fs.rmdir(dest);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    await fs.rename(tempDir, dest);
    try {
      await fsyncDir(parent);
    } catch (e) {
      // Its name may not survive a power cut: a backup that cannot be trusted is not left behind.
      await fs.rm(dest, { recursive: true, force: true });
      throw e;
    }

    const summary: BackupSummary = { folder: dest, createdAt, items: countsAtSnapshot.items, trashedItems: countsAtSnapshot.trashedItems, files, bytes, linkedItems, missingItems };
    return { manifest, summary };
  } catch (e) {
    await fs.rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

/** The backup's own database cannot be read: the backup is what is broken, not the library the user has open. */
function unreadableBackup(e: unknown): unknown {
  // Only SQLite's own corruption codes: a full disk or a denied write says something else, and keeps its own copy.
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === 'string' && SQLITE_DAMAGED.test(code) ? new LearnError('VALIDATION_FAILED', RESTORE_COPY.damagedDatabase, { cause: e }) : e;
}
const SQLITE_DAMAGED = /^SQLITE_(CORRUPT|NOTADB)/;

/** The manifest as checked (zod's output: counts written before a version are absent). */
export type BackupManifestRead = z.output<typeof BackupManifestSchema>;

/**
 * A backup folder's manifest, checked before anything is restored (spec 9.1): its format, a version this app reads, a
 * schema no newer than this app's, and the database beside it. Each refusal says why and what to do (RESTORE_COPY).
 */
export async function readBackupManifest(backupDir: string): Promise<BackupManifestRead> {
  let raw: unknown;
  try {
    raw = JSON.parse(await fs.readFile(path.join(backupDir, 'manifest.json'), 'utf8'));
  } catch {
    throw new LearnError('VALIDATION_FAILED', RESTORE_COPY.unknownFormat);
  }
  const parsed = BackupManifestSchema.safeParse(raw);
  if (!parsed.success) throw new LearnError('VALIDATION_FAILED', RESTORE_COPY.unknownFormat);
  if (parsed.data.schemaVersion > LATEST_SCHEMA_VERSION) throw new LearnError('VALIDATION_FAILED', RESTORE_COPY.newerVersion);
  const database = await fs.stat(path.join(backupDir, 'library.sqlite')).catch(() => null);
  if (!database?.isFile()) throw new LearnError('VALIDATION_FAILED', RESTORE_COPY.unknownFormat);
  return parsed.data;
}

/** What became of one managed copy the backup lists. */
type CopyOutcome = 'verified' | 'damaged' | 'missing';

/**
 * One managed copy back from the backup (spec 9.2): a real copy, flushed, then read back. A copy that reads back
 * different is set aside in staging as `corrupt-<sha>-<id>` (the library check shows it): left where its hash says, the
 * check would take it for the file come back. 'missing': the backup lists it but no longer holds it.
 */
async function restoreCopy(
  backupDir: string,
  layout: LibraryLayout,
  rel: string,
  sha256: string,
  shards: Set<string>,
  opts: { signal: AbortSignal | undefined; onBytes: (n: number) => void; hooks: RestoreHooks | undefined },
): Promise<CopyOutcome> {
  const src = path.join(backupDir, ...rel.split('/'));
  try {
    // Anything but a file (a folder put there by hand) is not the copy the backup lists.
    if (!(await fs.stat(src)).isFile()) return 'missing';
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
    throw e;
  }
  const dst = path.join(layout.root, ...rel.split('/'));
  const shard = path.dirname(dst);
  await fs.mkdir(shard, { recursive: true });
  shards.add(shard);
  await copyCounting(src, dst, opts.signal, opts.onBytes);
  await fsyncFile(dst);
  await opts.hooks?.afterCopy?.(dst);
  if ((await sha256File(dst, { signal: opts.signal, onBytes: opts.onBytes })) === sha256) return 'verified';
  await fs.rename(dst, path.join(layout.stagingDir, `corrupt-${sha256}-${newId()}`));
  return 'damaged';
}

/**
 * A backup restored into a new folder (spec 9): the database, every managed copy read back, the database checked against
 * the manifest, in a sibling `.restoring-<id>` folder that takes `targetRoot`'s name only when all of it is on the disk.
 * Missing, damaged and disagreeing files are marked missing and named in the result; nothing else fails the restore.
 */
export async function restoreBackup(args: RestoreArgs): Promise<RestoreResult> {
  const { backupDir, signal, onProgress, hooks } = args;
  signal?.throwIfAborted();
  const manifest = await readBackupManifest(backupDir);
  await assertEmptyDir(args.targetRoot, RESTORE_COPY.notEmpty);
  const target = path.resolve(args.targetRoot);
  const parent = path.dirname(target);
  const tempDir = `${target}.restoring-${newId()}`;
  await fs.mkdir(tempDir, { recursive: true });

  try {
    const temp = libraryLayout(tempDir);
    ensureLayout(temp);
    await fs.copyFile(path.join(backupDir, 'library.sqlite'), temp.dbFile);
    await fsyncFile(temp.dbFile);

    // Every included copy's path is the one its hash names — anything else is a damaged list, and a way out of the
    // folder — checked before a byte is copied.
    const managed = manifest.assets.filter((e) => e.storageMode === 'managed' && e.relativePath !== null);
    const included = managed.filter((e) => e.included);
    for (const e of included) {
      if (!SHA256_HEX.test(e.sha256) || e.relativePath !== managedRelativePath(e.sha256)) throw new LearnError('VALIDATION_FAILED', RESTORE_COPY.damagedList);
    }
    const progress: RestoreProgress = { bytesDone: 0, bytesTotal: included.reduce((n, e) => n + 2 * e.size, 0), filesDone: 0, filesTotal: included.length };
    const report = (): void => onProgress?.({ ...progress });
    report();

    let verifiedAssets = 0;
    const missingAssets = managed.filter((e) => !e.included).map((e) => e.assetId);
    const hashMismatches: string[] = [];
    const shards = new Set<string>();
    for (const e of included) {
      signal?.throwIfAborted();
      const share = 2 * e.size;
      const before = progress.bytesDone;
      let moved = 0;
      const onBytes = (n: number): void => {
        moved += n;
        progress.bytesDone = before + Math.min(share, moved);
        report();
      };
      const outcome = await restoreCopy(backupDir, temp, managedRelativePath(e.sha256), e.sha256, shards, { signal, onBytes, hooks });
      if (outcome === 'verified') verifiedAssets++;
      else if (outcome === 'damaged') hashMismatches.push(e.assetId);
      else missingAssets.push(e.assetId);
      progress.bytesDone = before + share;
      progress.filesDone += 1;
      report();
    }
    // The folders after the files in them; staging too when a damaged copy was set aside there.
    for (const shard of shards) await fsyncDir(shard);
    if (shards.size > 0) await fsyncDir(temp.assetsDir);
    if (hashMismatches.length > 0) await fsyncDir(temp.stagingDir);
    signal?.throwIfAborted();

    let db: Db;
    try {
      db = openDatabase(temp.dbFile);
    } catch (e) {
      throw unreadableBackup(e);
    }
    let result: RestoreResult;
    try {
      // The backup's database can open and still be broken: what migrate or the reads hit is the backup's fault too.
      migrate(db, { dbFile: temp.dbFile });
      // Pages that no read below touches can be broken too: SQLite's own quick check, anything but "ok" refuses.
      if (db.pragma('quick_check', { simple: true }) !== 'ok') throw new LearnError('VALIDATION_FAILED', RESTORE_COPY.damagedDatabase);
      const repo = new LibraryRepository(db);
      // Every asset the manifest lists is in the database it came with: one that is not means this is not that backup.
      for (const entry of manifest.assets) {
        if (!repo.getAsset(entry.assetId)) throw new LearnError('VALIDATION_FAILED', RESTORE_COPY.unknownFormat);
      }
      // The database and the manifest describe the same assets (spec 9.2). A row that disagrees with its entry, or one the
      // manifest never listed, cannot be trusted to find its file: a managed one is shown as missing.
      const entries = new Map(manifest.assets.map((e) => [e.assetId, e]));
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
      const expected = manifest.counts;
      const countsMatch = (Object.keys(expected) as (keyof typeof expected)[]).every((k) => expected[k] === undefined || expected[k] === counts[k]);
      result = {
        verifiedAssets,
        missingAssets: missingAssets.sort(),
        hashMismatches: hashMismatches.sort(),
        recordMismatches: recordMismatches.sort(),
        counts,
        countsMatch,
        backupCreatedAt: manifest.createdAt,
        managedFiles: managed.length,
        problemItems: repo.originalItemsOf([...unfound, ...recordMismatches]),
      };
    } catch (e) {
      throw unreadableBackup(e);
    } finally {
      if (db.open) db.close();
    }
    // The database after migrate and the marks above, then the folder's own names (the layout's folders, the database).
    await fsyncFile(temp.dbFile);
    await fsyncDir(tempDir);
    // The last point a stop leaves nothing behind: past it the library appears whole.
    signal?.throwIfAborted();

    try {
      await fs.rmdir(target);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    await fs.rename(tempDir, target);
    try {
      await fsyncDir(parent);
    } catch (e) {
      // Its name may not survive a power cut: a library that cannot be trusted is not left behind.
      await fs.rm(target, { recursive: true, force: true });
      throw e;
    }
    return result;
  } catch (e) {
    await fs.rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}
