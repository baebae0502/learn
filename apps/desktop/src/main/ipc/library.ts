import { BrowserWindow, dialog, shell, type IpcMainInvokeEvent, type OpenDialogOptions } from 'electron';
import {
  Channels, LearnError, assetIdInput, emptyInput, importPathsInput, itemIdInput, itemIdsInput, pickAndImportInput, updateMetadataInput,
  type ImportOutcome,
} from '@learn/domain';
import { relinkAsset, resolveAssetPath } from '@learn/library';
import { broadcast } from '../events';
import { refreshItemAvailability } from '../item-availability';
import type { Handle, IpcDeps } from './register';

const IMPORT_FILTERS: OpenDialogOptions['filters'] = [
  { name: 'PDF·동영상', extensions: ['pdf', 'mp4', 'm4v', 'mov', 'webm', 'mkv'] },
  { name: '모든\u00a0파일', extensions: ['*'] },
];

/**
 * The open panel, hung on the asking window as a sheet (macOS) through windows.asSheet, like the settings window's
 * dialogs: the window stays main but is not key under it (no rings, no tooltips, 전체 화면 waits), and is re-read once
 * it is key again (follow-up D: before, the main window kept its rings under its own ⌘O panel). Without a window the
 * panel stands alone, as before.
 */
async function showOpen(deps: IpcDeps, event: IpcMainInvokeEvent, options: OpenDialogOptions): Promise<string[]> {
  const win = BrowserWindow.fromWebContents(event.sender);
  const res = win ? await deps.windows.asSheet(win, () => dialog.showOpenDialog(win, options)) : await dialog.showOpenDialog(options);
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
    const paths = await showOpen(deps, event, { title: '파일 가져오기', properties: ['openFile', 'multiSelections'], filters: IMPORT_FILTERS });
    return paths.length === 0 ? [] : announceImported(await ctx.importer.importMany(paths, input));
  });

  handle(Channels.library.import, importPathsInput, async (input) => announceImported(await deps.getContext().importer.importMany(input.paths, input)));

  handle(Channels.library.list, emptyInput, () => deps.getContext().repo.listItems());

  // Re-checks the file; a changed availability is broadcast (libraryChanged{availability}).
  handle(Channels.library.get, itemIdInput, ({ itemId }) => refreshItemAvailability(deps.getContext(), itemId));

  handle(Channels.library.pickAndRelink, assetIdInput, async ({ assetId }, event) => {
    const ctx = deps.getContext();
    const [picked] = await showOpen(deps, event, { title: '원본\u00a0파일 다시 연결', properties: ['openFile'], filters: IMPORT_FILTERS });
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
    // No field given: the repository wrote nothing, so there is nothing to announce.
    if (title !== undefined || metadata !== undefined) broadcast('libraryChanged', { reason: 'metadata', itemIds: [itemId] });
    return item;
  });

  // Only the items that actually moved are announced (already-trashed, live and unknown ids are skipped).
  handle(Channels.library.trash, itemIdsInput, ({ itemIds }) => {
    const changed = deps.getContext().repo.trashChanged(itemIds);
    if (changed.length > 0) broadcast('libraryChanged', { reason: 'trash', itemIds: changed });
    return changed.length;
  });

  handle(Channels.library.restore, itemIdsInput, ({ itemIds }) => {
    const changed = deps.getContext().repo.restoreChanged(itemIds);
    if (changed.length > 0) broadcast('libraryChanged', { reason: 'restore', itemIds: changed });
    return changed.length;
  });

  handle(Channels.library.listTrash, emptyInput, () => deps.getContext().repo.listTrash());

  handle(Channels.library.duplicateGroups, emptyInput, () => deps.getContext().repo.duplicateGroups());

  /** The file on disk for an item, re-checked first (a missing file is reported, never revealed). */
  async function existingFile(itemId: string): Promise<string> {
    const ctx = deps.getContext();
    const item = await refreshItemAvailability(ctx, itemId);
    if (item.availability === 'missing') throw new LearnError('NOT_FOUND', '원본\u00a0파일을 찾을 수 없습니다. 파일을 옮겼다면 다시 연결하세요.');
    const asset = ctx.repo.getAsset(item.assetId);
    if (!asset) throw new LearnError('NOT_FOUND', '자료를 찾을 수 없습니다.');
    return resolveAssetPath(ctx.layout, asset);
  }

  // Finder에서 보기 / 기본 앱으로 열기 (design-spec 7.3, 10.7): the renderer has no shell; main resolves the path itself.
  handle(Channels.library.showInFolder, itemIdInput, async ({ itemId }) => {
    shell.showItemInFolder(await existingFile(itemId));
  });

  handle(Channels.library.openExternally, itemIdInput, async ({ itemId }) => {
    // openPath resolves with the OS's error text (English, may name the path): logged by code only, never shown.
    const failure = await shell.openPath(await existingFile(itemId));
    if (failure) throw new LearnError('INTERNAL', '기본 앱으로 열지 못했습니다. 이\u00a0형식을 여는 앱이 설치되어 있는지 확인하세요.');
  });
}
