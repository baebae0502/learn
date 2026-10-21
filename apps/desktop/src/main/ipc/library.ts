import { BrowserWindow, dialog, type IpcMainInvokeEvent, type OpenDialogOptions } from 'electron';
import {
  Channels, assetIdInput, emptyInput, importPathsInput, itemIdInput, itemIdsInput, pickAndImportInput, updateMetadataInput,
  type ImportOutcome,
} from '@learn/domain';
import { relinkAsset } from '@learn/library';
import { broadcast } from '../events';
import { refreshItemAvailability } from '../item-availability';
import type { Handle, IpcDeps } from './register';

const IMPORT_FILTERS: OpenDialogOptions['filters'] = [
  { name: 'PDF·동영상', extensions: ['pdf', 'mp4', 'm4v', 'mov', 'webm', 'mkv'] },
  { name: '모든 파일', extensions: ['*'] },
];

async function showOpen(event: IpcMainInvokeEvent, options: OpenDialogOptions): Promise<string[]> {
  const win = BrowserWindow.fromWebContents(event.sender);
  const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  return res.canceled ? [] : res.filePaths;
}

/** Push libraryChanged when an import added at least one item. */
function announceImported(outcomes: ImportOutcome[]): ImportOutcome[] {
  const itemIds = outcomes.flatMap((o) => (o.status === 'imported' ? [o.item.id] : []));
  if (itemIds.length > 0) broadcast('libraryChanged', { reason: 'import', itemIds });
  return outcomes;
}

export function registerLibraryIpc(handle: Handle, deps: IpcDeps): void {
  handle(Channels.library.pickAndImport, pickAndImportInput, async (input, event) => {
    const ctx = deps.getContext();
    const paths = await showOpen(event, { title: '자료 가져오기', properties: ['openFile', 'multiSelections'], filters: IMPORT_FILTERS });
    return paths.length === 0 ? [] : announceImported(await ctx.importer.importMany(paths, input));
  });

  handle(Channels.library.import, importPathsInput, async (input) => announceImported(await deps.getContext().importer.importMany(input.paths, input)));

  handle(Channels.library.list, emptyInput, () => deps.getContext().repo.listItems());

  // Re-checks the file; a changed availability is broadcast (libraryChanged{availability}).
  handle(Channels.library.get, itemIdInput, ({ itemId }) => refreshItemAvailability(deps.getContext(), itemId));

  handle(Channels.library.pickAndRelink, assetIdInput, async ({ assetId }, event) => {
    const ctx = deps.getContext();
    const [picked] = await showOpen(event, { title: '원본 파일 다시 연결', properties: ['openFile'], filters: IMPORT_FILTERS });
    if (!picked) return null;
    await relinkAsset(ctx.repo, assetId, picked);
    const itemIds = ctx.repo.itemIdsForAsset(assetId);
    broadcast('libraryChanged', { reason: 'relink', itemIds });
    const itemId = itemIds[0];
    return itemId ? ctx.repo.getItem(itemId) ?? null : null;
  });

  handle(Channels.library.recoveryReport, emptyInput, () => deps.getContext().recovery);

  handle(Channels.library.detail, itemIdInput, ({ itemId }) => deps.getContext().repo.getItemDetail(itemId));

  handle(Channels.library.updateMetadata, updateMetadataInput, ({ itemId, title, metadata }) => {
    const item = deps.getContext().repo.updateMetadata(itemId, { title, metadata });
    broadcast('libraryChanged', { reason: 'metadata', itemIds: [itemId] });
    return item;
  });

  handle(Channels.library.trash, itemIdsInput, ({ itemIds }) => {
    const n = deps.getContext().repo.trash(itemIds);
    if (n > 0) broadcast('libraryChanged', { reason: 'trash', itemIds });
    return n;
  });

  handle(Channels.library.restore, itemIdsInput, ({ itemIds }) => {
    const n = deps.getContext().repo.restore(itemIds);
    if (n > 0) broadcast('libraryChanged', { reason: 'restore', itemIds });
    return n;
  });

  handle(Channels.library.listTrash, emptyInput, () => deps.getContext().repo.listTrash());

  handle(Channels.library.duplicateGroups, emptyInput, () => deps.getContext().repo.duplicateGroups());
}
