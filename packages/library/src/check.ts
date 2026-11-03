import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { nowIso, type LibraryCheck } from '@learn/domain';
import type { LibraryRepository } from '@learn/db';
import { isManagedPathHeld, withManagedPath } from './asset-lock';
import { editedCopyFile, orphanEditedCopies } from './edited-copies';
import type { LibraryLayout } from './layout';

/** A stopped import's staging copy: Importer.place writes `<uuid>.part`. */
const PART = /\.part$/;
/** A damaged copy the importer set aside instead of overwriting it: `corrupt-<sha256>-<uuid>`. */
const CORRUPT = /^corrupt-[0-9a-f]{64}-/;
/** `assets/<shard>/<name>` with no part a dot name: the only keys a cleanup or a revival acts on. */
const ASSET_KEY = /^assets\/[^/\\.][^/\\]*\/[^/\\.][^/\\]*$/;

export interface CheckOptions {
  /** At startup only: the jobs the last run left `running` are `interrupted` now. A check while the app runs leaves them. */
  interruptJobs?: boolean;
  /** Staging names an import is writing right now (Importer.stagingInUse): no leftovers. */
  stagingInUse?: ReadonlySet<string>;
  now?: () => string;
  /** Seams for tests that need a concurrent import at an exact point of the check. */
  hooks?: { afterAssetsListed?: () => void | Promise<void> };
}

const code = (e: unknown) => (e as NodeJS.ErrnoException)?.code;
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

/** Regular files (or folders) of `dir` in name order, dot names left out (.DS_Store, ._*, our scratch files); [] when it is not there. */
async function namesIn(dir: string, kind: 'file' | 'dir'): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (e) {
    if (code(e) === 'ENOENT' || code(e) === 'ENOTDIR') return [];
    throw e;
  }
  return entries
    .filter((d) => !d.name.startsWith('.') && (kind === 'file' ? d.isFile() : d.isDirectory()))
    .map((d) => d.name)
    .sort();
}

async function sizeOf(file: string): Promise<number> {
  return (await fs.lstat(file).catch(() => null))?.size ?? 0;
}

/** The file of an `assets/<shard>/<name>` key, or null for any other key: never a path out of assets/. */
export function assetKeyFile(layout: LibraryLayout, key: string): string | null {
  if (!ASSET_KEY.test(key)) return null;
  const file = path.join(layout.root, ...key.split('/'));
  return file.startsWith(layout.assetsDir + path.sep) ? file : null;
}

/** The damaged copies set aside in staging/, as files in name order (Finder에서 보기 shows the first). */
export async function corruptCopies(layout: LibraryLayout): Promise<string[]> {
  return (await namesIn(layout.stagingDir, 'file')).filter((n) => CORRUPT.test(n)).map((n) => path.join(layout.stagingDir, n));
}

/**
 * 라이브러리 점검 (M6 spec 7): reads staging/, assets/ and derived/open/ against the database. It removes nothing. Side
 * effects: with `interruptJobs`, running jobs → interrupted; a managed asset whose copy is gone → missing, one whose copy
 * is there again → available (the disk is the truth; opening an item re-checks it the same way).
 */
export async function checkLibrary(layout: LibraryLayout, repo: LibraryRepository, opts: CheckOptions = {}): Promise<LibraryCheck> {
  const now = (opts.now ?? nowIso)();
  if (opts.interruptJobs) repo.markRunningJobsInterrupted(now);

  // The rows come before the listing: a row committed while the disk is listed is never judged against that listing.
  const managed = repo.assetsByMode('managed');

  const parts: string[] = [];
  const corrupt: string[] = [];
  for (const name of await namesIn(layout.stagingDir, 'file')) {
    if (CORRUPT.test(name)) corrupt.push(name);
    else if (PART.test(name) && !opts.stagingInUse?.has(name)) parts.push(name);
  }
  // An import that finished after the listing renamed its .part away: only a file still there is a leftover.
  for (const name of [...parts]) {
    if (!(await fs.lstat(path.join(layout.stagingDir, name)).catch(() => null))) parts.splice(parts.indexOf(name), 1);
  }
  const inStaging = (names: readonly string[]) => Promise.all(names.map((n) => sizeOf(path.join(layout.stagingDir, n))));
  const partBytes = sum(await inStaging(parts));
  const corruptBytes = sum(await inStaging(corrupt));

  const onDisk = new Set<string>();
  for (const shard of await namesIn(layout.assetsDir, 'dir')) {
    for (const name of await namesIn(path.join(layout.assetsDir, shard), 'file')) onDisk.add(`assets/${shard}/${name}`);
  }
  await opts.hooks?.afterAssetsListed?.();
  // One synchronous step: a path an import holds is being placed; once its lock is gone its row is committed and is read here.
  const unreferenced = (() => {
    const locked = new Set([...onDisk].filter(isManagedPathHeld));
    const held = new Set(repo.assetsByMode('managed').flatMap((a) => (a.relativePath === null ? [] : [a.relativePath])));
    return [...onDisk].filter((key) => !locked.has(key) && !held.has(key)).sort();
  })();
  const unreferencedBytes = sum(await Promise.all(unreferenced.map((key) => sizeOf(path.join(layout.root, ...key.split('/'))))));

  const missingAssets: string[] = [];
  for (const a of managed) {
    // A purge may have removed the row since the rows were read: there is nothing left to judge or write.
    if (a.relativePath === null || repo.getAsset(a.id) === undefined) continue;
    const there = onDisk.has(a.relativePath) || (await fs.access(path.join(layout.root, ...a.relativePath.split('/'))).then(() => true, () => false));
    if (!there) missingAssets.push(a.id);
    if (!there && a.availability !== 'missing') repo.setAvailability(a.id, 'missing', now);
    if (there && a.availability === 'missing') repo.setAvailability(a.id, 'available', now);
  }
  const missingManaged = missingAssets.flatMap((id) => repo.itemIdsForAsset(id)).sort();
  const missingLinked = repo
    .assetsByMode('linked')
    .filter((a) => a.availability === 'missing')
    .flatMap((a) => repo.itemIdsForAsset(a.id))
    .sort();

  const copies = await orphanEditedCopies(layout, new Set(repo.allAssets().map((a) => a.id)));
  const copyBytes = sum(
    await Promise.all(
      copies.map(async (c) => {
        const file = await editedCopyFile(layout, c.assetId, c.name);
        return file === null ? 0 : sizeOf(file);
      }),
    ),
  );

  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ staging: parts, unreferenced, missingManaged, corrupt, orphanEdits: copies.map((c) => `${c.assetId}/${c.name}`).sort() }))
    .digest('hex');
  return {
    checkedAt: now,
    items: repo.counts().items,
    staging: { count: parts.length, bytes: partBytes },
    unreferenced: { keys: unreferenced, bytes: unreferencedBytes },
    missingManaged: { itemIds: missingManaged },
    missingLinked: { itemIds: missingLinked },
    corrupt: { count: corrupt.length, bytes: corruptBytes, files: corrupt },
    orphanEdits: { count: copies.length, bytes: copyBytes, copies },
    fingerprint,
    actionable: parts.length + unreferenced.length + missingManaged.length + corrupt.length + copies.length > 0,
  };
}

/**
 * 임시 파일 정리 (spec 7.2): the stopped imports' `staging/*.part` files, and nothing else there — not a name an import
 * is writing now (`inUse` is read again for each file: a live view), not .DS_Store or another dot file, not a corrupt
 * copy. A file already gone counts as neither.
 */
export async function cleanStaging(layout: LibraryLayout, inUse: ReadonlySet<string> = new Set()): Promise<{ removed: number; failed: number }> {
  let removed = 0;
  let failed = 0;
  for (const name of await namesIn(layout.stagingDir, 'file')) {
    if (!PART.test(name) || CORRUPT.test(name) || inUse.has(name)) continue;
    try {
      await fs.rm(path.join(layout.stagingDir, name));
      removed += 1;
    } catch (e) {
      if (code(e) !== 'ENOENT') failed += 1;
    }
  }
  return { removed, failed };
}

/**
 * 정리… of 쓰이지 않는 사본, after the user said yes in the sheet (spec 7.2, 16): each copy under its path's lock, and only
 * while no asset row holds that path — an import of the same bytes may have placed and committed it since the check.
 * A key that is not an `assets/<shard>/<name>` key counts as failed and nothing is touched for it.
 */
export async function cleanUnreferenced(layout: LibraryLayout, inUse: (key: string) => boolean, keys: readonly string[]): Promise<{ removed: number; failed: number }> {
  let removed = 0;
  let failed = 0;
  for (const key of keys) {
    const file = assetKeyFile(layout, key);
    if (file === null) {
      failed += 1;
      continue;
    }
    const outcome = await withManagedPath(key, async () => {
      if (inUse(key)) return 'kept' as const;
      const st = await fs.lstat(file).catch(() => null);
      if (!st?.isFile()) return 'kept' as const;
      await fs.rm(file);
      return 'removed' as const;
    }).catch(() => 'failed' as const);
    if (outcome === 'removed') removed += 1;
    if (outcome === 'failed') failed += 1;
  }
  return { removed, failed };
}
