import {
  Channels, collectionIdInput, collectionItemsInput, createCollectionInput, createTagInput, emptyInput, moveCollectionInput,
  renameCollectionInput, renameTagInput, setTagColorInput, tagIdInput, tagItemsInput, togglePositionInput,
} from '@learn/domain';
import { broadcast } from '../events';
import type { Handle, IpcDeps } from './register';

type Reason = 'collections' | 'tags';

/**
 * libraryChanged{reason:'collections'|'tags'}, sent only when something changed. `itemIds` lists the items whose
 * memberships or tags actually changed; without it the collection or tag list itself changed.
 */
function announce(reason: Reason, itemIds?: readonly string[]): void {
  broadcast('libraryChanged', itemIds ? { reason, itemIds: [...itemIds] } : { reason });
}
/** A mutation that always changes something when it succeeds (it throws otherwise). */
function changed<T>(reason: Reason, result: T): T {
  announce(reason);
  return result;
}
/** Bulk membership change: announce the items that changed, if any; answer with their ids (what an undo puts back). */
function changedIds(reason: Reason, itemIds: readonly string[]): string[] {
  if (itemIds.length > 0) announce(reason, itemIds);
  return [...itemIds];
}
/** Bulk membership/tag changes: announce the items that changed, if any; answer with their count. */
function changedItems(reason: Reason, itemIds: readonly string[]): number {
  if (itemIds.length > 0) announce(reason, itemIds);
  return itemIds.length;
}

export function registerOrganizeIpc(handle: Handle, deps: IpcDeps): void {
  const collections = () => deps.getContext().collections;
  const tags = () => deps.getContext().tags;

  handle(Channels.collections.list, emptyInput, () => collections().list());
  handle(Channels.collections.create, createCollectionInput, ({ name, parentId }) => changed('collections', collections().create({ name, parentId })));
  handle(Channels.collections.rename, renameCollectionInput, ({ collectionId, name }) => changed('collections', collections().rename(collectionId, name)));
  handle(Channels.collections.move, moveCollectionInput, ({ collectionId, parentId }) => changed('collections', collections().move(collectionId, parentId)));
  handle(Channels.collections.remove, collectionIdInput, ({ collectionId }) => changed('collections', collections().softDelete(collectionId)));
  handle(Channels.collections.restore, collectionIdInput, ({ collectionId }) => {
    const { collection, changed: restored } = collections().restoreChanged(collectionId);
    if (restored) announce('collections');
    return collection;
  });
  handle(Channels.collections.addItems, collectionItemsInput, ({ collectionId, itemIds }) =>
    changedIds('collections', collections().addItemsChanged(collectionId, itemIds)));
  handle(Channels.collections.removeItems, collectionItemsInput, ({ collectionId, itemIds }) =>
    changedIds('collections', collections().removeItemsChanged(collectionId, itemIds)));

  handle(Channels.tags.list, emptyInput, () => tags().list());
  handle(Channels.tags.create, createTagInput, ({ name }) => {
    const { tag, created } = tags().findOrCreate(name);
    if (created) announce('tags');
    return tag;
  });
  handle(Channels.tags.rename, renameTagInput, ({ tagId, name }) => changed('tags', tags().rename(tagId, name)));
  handle(Channels.tags.setColor, setTagColorInput, ({ tagId, color, position }) => changed('tags', tags().setColor(tagId, color, position)));
  handle(Channels.tags.remove, tagIdInput, ({ tagId }) => changed('tags', tags().remove(tagId)));
  handle(Channels.tags.assign, tagItemsInput, ({ tagId, itemIds }) => changedItems('tags', tags().assignChanged(tagId, itemIds)));
  handle(Channels.tags.unassign, tagItemsInput, ({ tagId, itemIds }) => changedItems('tags', tags().unassignChanged(tagId, itemIds)));
  handle(Channels.tags.togglePosition, togglePositionInput, ({ position, itemIds }) => {
    const toggled = tags().togglePositionChanged(position, itemIds);
    if (!toggled) return null;
    changedItems('tags', toggled.itemIds);
    return { tagId: toggled.tagId, assigned: toggled.assigned };
  });
}
