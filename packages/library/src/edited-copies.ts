import fs from 'node:fs/promises';
import path from 'node:path';
import type { EditedCopy } from '@learn/domain';
import type { AssetRow } from '@learn/db';
import { sha256File } from './hash';
import type { LibraryLayout } from './layout';
import { isAside } from './openable';
import { resolveAssetPath } from './resolve';

/** Asset ids are uuids: a folder name that is not one was not made by Learn, and a name that is not one never becomes a path. */
const ASSET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const nfc = (name: string) => name.normalize('NFC');
const code = (e: unknown) => (e as NodeJS.ErrnoException)?.code;

/** derived/open/<assetId>/: an asset's named copy (기본 앱으로 열기) and the copies kept aside beside it. */
export const openFolder = (layout: LibraryLayout, assetId: string): string => path.join(layout.derivedDir, 'open', assetId);

async function namesIn(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch (e) {
    if (code(e) === 'ENOENT' || code(e) === 'ENOTDIR') return [];
    throw e;
  }
}

/** A copy kept aside, by its name alone: what asideName writes, never a dot file (scratch, .DS_Store). */
const keptAside = (name: string): boolean => !name.startsWith('.') && isAside(name);

/**
 * The copies another app saved that the next 기본 앱으로 열기 kept aside (openable.ts): regular files of that shape in
 * the asset's folder, newest first (then by name). Links and folders are not copies. The named copy itself is not one —
 * an edit saved into it shows once the next open has set it aside.
 */
export async function listEditedCopies(layout: LibraryLayout, assetId: string): Promise<EditedCopy[]> {
  if (!ASSET_ID.test(assetId)) return [];
  const dir = openFolder(layout, assetId);
  const out: EditedCopy[] = [];
  for (const name of await namesIn(dir)) {
    if (!keptAside(name)) continue;
    const st = await fs.lstat(path.join(dir, name)).catch(() => null);
    if (!st?.isFile()) continue;
    out.push({ name: nfc(name), modifiedAt: st.mtime.toISOString(), size: st.size });
  }
  return out.sort((a, b) => (a.modifiedAt !== b.modifiedAt ? (a.modifiedAt < b.modifiedAt ? 1 : -1) : a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * The file of the copy the panel named, as the disk spells it (HFS+ lists names decomposed), or null: a name that is a
 * path, a dot name or not a copy kept aside, or no such file in this asset's folder. Never a path outside that folder.
 */
export async function editedCopyFile(layout: LibraryLayout, assetId: string, name: string): Promise<string | null> {
  const want = nfc(name);
  if (!ASSET_ID.test(assetId) || want !== path.basename(want) || !keptAside(want)) return null;
  const dir = openFolder(layout, assetId);
  const found = (await namesIn(dir)).find((n) => nfc(n) === want);
  if (found === undefined) return null;
  const file = path.join(dir, found);
  const st = await fs.lstat(file).catch(() => null);
  return st?.isFile() ? file : null;
}

/**
 * Copies kept aside in folders whose asset has no row any more (주인 없는 수정본, the library check): `liveAssetIds` is
 * every asset with a row, the trash's included. Folders in name order, copies by name.
 */
export async function orphanEditedCopies(layout: LibraryLayout, liveAssetIds: ReadonlySet<string>): Promise<Array<{ assetId: string; name: string }>> {
  const root = path.join(layout.derivedDir, 'open');
  const out: Array<{ assetId: string; name: string }> = [];
  for (const assetId of (await namesIn(root)).sort()) {
    if (!ASSET_ID.test(assetId) || liveAssetIds.has(assetId)) continue;
    const dir = path.join(root, assetId);
    if (!(await fs.lstat(dir).catch(() => null))?.isDirectory()) continue;
    for (const name of (await namesIn(dir)).sort()) {
      if (!keptAside(name)) continue;
      if ((await fs.lstat(path.join(dir, name)).catch(() => null))?.isFile()) out.push({ assetId, name: nfc(name) });
    }
  }
  return out;
}

/**
 * After 새 자료로 가져오기 committed (spec 6, the only edited copy Learn ever removes): the copy goes when the library
 * now holds exactly its bytes — the new item's asset is a managed copy, that file is there at its size, and the copy
 * hashes to its sha256 again (another app may have saved over it while it was imported). Anything else keeps it. Only a
 * copy kept aside directly in an asset's folder of derived/open/ qualifies. Returns whether it went.
 */
export async function removeImportedEditedCopy(layout: LibraryLayout, file: string, asset: AssetRow | undefined): Promise<boolean> {
  const parts = path.relative(path.join(layout.derivedDir, 'open'), file).split(path.sep);
  if (parts.length !== 2 || !ASSET_ID.test(parts[0]!) || !keptAside(parts[1]!)) return false;
  if (!asset || asset.storageMode !== 'managed') return false;
  const stored = await fs.stat(resolveAssetPath(layout, asset)).catch(() => null);
  if (!stored?.isFile() || stored.size !== asset.size) return false;
  if ((await sha256File(file).catch(() => null)) !== asset.sha256) return false;
  await fs.unlink(file);
  return true;
}
