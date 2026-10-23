import path from 'node:path';
import { LearnError } from '@learn/domain';
import type { AssetRow } from '@learn/db';
import type { LibraryLayout } from './layout';

/** Absolute path of an asset's bytes. Managed paths must stay inside assets/. */
export function resolveAssetPath(layout: LibraryLayout, asset: AssetRow): string {
  if (asset.storageMode === 'linked') {
    if (!asset.externalPath) throw new LearnError('INTERNAL', '외부 연결 경로가 비어 있습니다.');
    return asset.externalPath;
  }
  if (!asset.relativePath) throw new LearnError('INTERNAL', '라이브러리 안의 사본 위치가 비어 있습니다.');
  const abs = path.resolve(layout.root, ...asset.relativePath.split('/'));
  if (!abs.startsWith(layout.assetsDir + path.sep)) {
    throw new LearnError('PERMISSION_DENIED', '라이브러리 밖의 경로는 열 수 없습니다.');
  }
  return abs;
}
