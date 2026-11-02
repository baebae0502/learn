import { shell } from 'electron';
import { Channels, LearnError, editedCopyInput, itemIdInput } from '@learn/domain';
import { editedCopyFile, fileTitle, listEditedCopies, removeImportedEditedCopy } from '@learn/library';
import { mainStrings } from '../strings';
import type { Handle, IpcDeps } from './register';

/**
 * 다른 앱에서 고친 수정본 (M6 spec 6): the item panel's list of an item's edited copies, 새 자료로 가져오기 through the
 * import queue, and Finder에서 보기. The page names a copy by its file name; main finds it in the item's own folder.
 */
export function registerEditedCopiesIpc(handle: Handle, deps: IpcDeps): void {
  /** A live item's asset (its copies live in derived/open/<assetId>/): a trashed or unknown item is NOT_FOUND. */
  function assetOf(itemId: string) {
    const ctx = deps.getContext();
    const item = ctx.repo.getItem(itemId);
    if (!item) throw new LearnError('NOT_FOUND', mainStrings.itemFile.noItem);
    return { ctx, assetId: item.assetId };
  }
  async function copyOf(itemId: string, name: string) {
    const { ctx, assetId } = assetOf(itemId);
    const file = await editedCopyFile(ctx.layout, assetId, name);
    if (file === null) throw new LearnError('NOT_FOUND', mainStrings.editedCopy.gone);
    return { ctx, file };
  }

  handle(Channels.library.editedCopies, itemIdInput, ({ itemId }) => {
    const { ctx, assetId } = assetOf(itemId);
    return listEditedCopies(ctx.layout, assetId);
  });

  // A copy in the queue like any import (its progress and result toasts, its duplicate question): a managed copy, so the
  // library keeps its own bytes; no collection (spec 6: not the original item's). The copy goes only after the commit.
  handle(Channels.library.importEditedCopy, editedCopyInput, async ({ itemId, name }, event) => {
    const { ctx, file } = await copyOf(itemId, name);
    const queued = deps.imports.enqueue({
      paths: [file],
      mode: 'managed',
      collectionId: null,
      owner: event.sender.id,
      titles: { [file]: fileTitle(file) },
      afterCommit: async (outcome) => {
        const removed = await removeImportedEditedCopy(ctx.layout, file, ctx.repo.getAsset(outcome.item.assetId));
        if (!removed) console.warn('[library] an edited copy stays: it changed while it was imported, or its import is not a managed copy');
      },
    });
    return { queued };
  });

  handle(Channels.library.revealEditedCopy, editedCopyInput, async ({ itemId, name }) => {
    shell.showItemInFolder((await copyOf(itemId, name)).file);
  });
}
