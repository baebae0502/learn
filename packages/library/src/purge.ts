import fs from 'node:fs/promises';
import path from 'node:path';
import type { PurgedAsset } from '@learn/db';
import { withManagedPath } from './asset-lock';
import type { LibraryLayout } from './layout';
import { clearNamedCopies } from './openable';

/** Asset ids are UUIDs (newId): a folder under derived/ is built from nothing else, so `open` or `..` never are. */
const ASSET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PurgeFilesOptions {
  /**
   * Whether an asset row holds this managed path now, asked right before its copy goes: an import may have placed the
   * same file since the purge committed. A throw keeps the copy.
   */
  inUse?: (relativePath: string) => boolean;
  /** The clock for the name of an edited copy kept aside (tests). */
  now?: () => Date;
}

/** 0 when `target` is gone (or was never there), 1 when it could not be removed. */
async function removed(target: string, opts: { recursive?: boolean } = {}): Promise<number> {
  try {
    await fs.rm(target, { force: true, ...opts });
    return 0;
  } catch {
    return 1;
  }
}

/** The managed copy, once nothing holds its path; a path that would leave assets/ is never followed. */
async function removeManagedCopy(layout: LibraryLayout, relativePath: string, inUse: PurgeFilesOptions['inUse']): Promise<number> {
  const file = path.resolve(layout.root, ...relativePath.split('/'));
  if (!file.startsWith(layout.assetsDir + path.sep)) return 1;
  return withManagedPath(relativePath, async () => (inUse?.(relativePath) ? 0 : removed(file))).catch(() => 1);
}

/**
 * The files of the assets a purge removed, after its commit (ADR-0006, spec 4.5): each managed copy, the asset's
 * `derived/<assetId>/` cache, and the named read-only copies in `derived/open/<assetId>/`. Never a linked original, never
 * an edited copy or the folder that holds one, never anything outside the library. What cannot be removed is counted and
 * stays; the library check shows a managed copy left so as unreferenced. The purge itself has already succeeded.
 */
export async function removePurgedFiles(layout: LibraryLayout, assets: readonly PurgedAsset[], opts: PurgeFilesOptions = {}): Promise<{ failed: number }> {
  let failed = 0;
  for (const asset of assets) {
    if (!ASSET_ID.test(asset.id)) {
      failed += 1;
      continue;
    }
    if (asset.storageMode === 'managed' && asset.relativePath !== null) failed += await removeManagedCopy(layout, asset.relativePath, opts.inUse);
    failed += await removed(path.join(layout.derivedDir, asset.id), { recursive: true });
    failed += await clearNamedCopies(path.join(layout.derivedDir, 'open', asset.id), asset.size, opts.now);
  }
  return { failed };
}
