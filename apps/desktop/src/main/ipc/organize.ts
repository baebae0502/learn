import {
  Channels, collectionIdInput, collectionItemsInput, createCollectionInput, createTagInput, emptyInput, moveCollectionInput,
  renameCollectionInput, renameTagInput, setTagColorInput, tagIdInput, tagItemsInput, togglePositionInput,
} from '@learn/domain';
import { broadcast } from '../events';
import type { Handle, IpcDeps } from './register';

/** Every successful collection/tag change is announced as libraryChanged{reason:'organize'}. */
function organized<T>(result: T, itemIds?: readonly string[]): T {
  broadcast('libraryChanged', itemIds ? { reason: 'organize', itemIds: [...itemIds] } : { reason: 'organize' });
  return result;
}

export function registerOrganizeIpc(handle: Handle, deps: IpcDeps): void {
  const collections = () => deps.getContext().collections;
  const tags = () => deps.getContext().tags;

  handle(Channels.collections.list, emptyInput, () => collections().list());
  handle(Channels.collections.create, createCollectionInput, ({ name, parentId }) => organized(collections().create({ name, parentId })));
  handle(Channels.collections.rename, renameCollectionInput, ({ collectionId, name }) => organized(collections().rename(collectionId, name)));
  handle(Channels.collections.move, moveCollectionInput, ({ collectionId, parentId }) => organized(collections().move(collectionId, parentId)));
  handle(Channels.collections.remove, collectionIdInput, ({ collectionId }) => organized(collections().softDelete(collectionId)));
  handle(Channels.collections.restore, collectionIdInput, ({ collectionId }) => organized(collections().restore(collectionId)));
  handle(Channels.collections.addItems, collectionItemsInput, ({ collectionId, itemIds }) =>
    organized(collections().addItems(collectionId, itemIds), itemIds));
  handle(Channels.collections.removeItems, collectionItemsInput, ({ collectionId, itemIds }) =>
    organized(collections().removeItems(collectionId, itemIds), itemIds));

  handle(Channels.tags.list, emptyInput, () => tags().list());
  handle(Channels.tags.create, createTagInput, ({ name }) => organized(tags().create(name)));
  handle(Channels.tags.rename, renameTagInput, ({ tagId, name }) => organized(tags().rename(tagId, name)));
  handle(Channels.tags.setColor, setTagColorInput, ({ tagId, color, position }) => organized(tags().setColor(tagId, color, position)));
  handle(Channels.tags.remove, tagIdInput, ({ tagId }) => organized(tags().remove(tagId)));
  handle(Channels.tags.assign, tagItemsInput, ({ tagId, itemIds }) => organized(tags().assign(tagId, itemIds), itemIds));
  handle(Channels.tags.unassign, tagItemsInput, ({ tagId, itemIds }) => organized(tags().unassign(tagId, itemIds), itemIds));
  handle(Channels.tags.togglePosition, togglePositionInput, ({ position, itemIds }) => {
    const toggled = tags().togglePosition(position, itemIds);
    return toggled ? organized(toggled, itemIds) : null;
  });
}
