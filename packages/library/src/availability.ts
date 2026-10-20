import fs from 'node:fs/promises';
import path from 'node:path';
import { LearnError, nowIso, type Availability } from '@learn/domain';
import type { AssetRow, LibraryRepository } from '@learn/db';
import { sha256File } from './hash';
import type { LibraryLayout } from './layout';
import { resolveAssetPath } from './resolve';

async function isFile(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isFile();
  } catch {
    return false;
  }
}

export async function refreshAvailability(layout: LibraryLayout, repo: LibraryRepository, asset: AssetRow): Promise<Availability> {
  const availability: Availability = (await isFile(resolveAssetPath(layout, asset))) ? 'available' : 'missing';
  if (availability !== asset.availability) repo.setAvailability(asset.id, availability, nowIso());
  return availability;
}

export async function refreshLinkedAvailability(layout: LibraryLayout, repo: LibraryRepository): Promise<void> {
  for (const asset of repo.assetsByMode('linked')) await refreshAvailability(layout, repo, asset);
}

/** Point a linked asset at a new location — only if the bytes are identical. */
export async function relinkAsset(repo: LibraryRepository, assetId: string, newPath: string): Promise<void> {
  const asset = repo.getAsset(assetId);
  if (!asset) throw new LearnError('NOT_FOUND', '자료를 찾을 수 없습니다.');
  if (asset.storageMode !== 'linked') throw new LearnError('VALIDATION_FAILED', '복사해 온 자료는 다시 연결할 필요가 없습니다.');
  const abs = path.resolve(newPath);
  if (!(await isFile(abs))) throw new LearnError('NOT_FOUND', '선택한 파일을 찾을 수 없습니다.');
  if ((await sha256File(abs)) !== asset.sha256) {
    throw new LearnError('HASH_MISMATCH', '선택한 파일의 내용이 원래 자료와 다릅니다. 같은 파일을 선택하세요.');
  }
  repo.setExternalPath(asset.id, abs, nowIso());
}
