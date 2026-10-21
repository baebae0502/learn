import { LearnError, type LibraryItem } from '@learn/domain';
import { refreshAvailability } from '@learn/library';
import { broadcast } from './events';
import type { LibraryContext } from './library-context';

/**
 * Re-checks one item's file on disk and returns the item as stored afterwards. Used by `library.get` and
 * the item context menu. A change is announced as libraryChanged{availability} so list badges follow.
 */
export async function refreshItemAvailability(ctx: Pick<LibraryContext, 'layout' | 'repo'>, itemId: string): Promise<LibraryItem> {
  const item = ctx.repo.getItem(itemId);
  const asset = item && ctx.repo.getAsset(item.assetId);
  if (!item || !asset) throw new LearnError('NOT_FOUND', '자료를 찾을 수 없습니다.');
  const availability = await refreshAvailability(ctx.layout, ctx.repo, asset);
  if (availability !== asset.availability) {
    broadcast('libraryChanged', { reason: 'availability', itemIds: ctx.repo.itemIdsForAsset(asset.id) });
  }
  return ctx.repo.getItem(itemId) ?? item;
}
