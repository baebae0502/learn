import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { app, BrowserWindow, dialog, shell, type IpcMainInvokeEvent, type OpenDialogOptions, type SaveDialogOptions } from 'electron';
import {
  Channels, LearnError, assetIdInput, commandById, commandMention, emptyInput, importPathsInput, itemIdInput, itemIdsInput, pickAndImportInput, updateMetadataInput,
  type ImportOutcome,
} from '@learn/domain';
import { exportFile, openExtension, openableFile, openableName, relinkAsset, resolveAssetPath, safeBaseName } from '@learn/library';
import { broadcast } from '../events';
import { refreshItemAvailability } from '../item-availability';
import { mainStrings } from '../strings';
import type { Handle, IpcDeps } from './register';

const IMPORT_FILTERS: OpenDialogOptions['filters'] = [
  { name: mainStrings.importFilters.media, extensions: ['pdf', 'mp4', 'm4v', 'mov', 'webm', 'mkv'] },
  { name: mainStrings.importFilters.all, extensions: ['*'] },
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

/** A copy that could not be written, in the user's words (cause + next step); any other error keeps its own. */
export function exportError(e: unknown): unknown {
  const code = (e as NodeJS.ErrnoException | null)?.code;
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') return new LearnError('PERMISSION_DENIED', mainStrings.exportCopy.notWritable, { cause: e });
  if (code === 'ENOSPC' || code === 'EDQUOT') return new LearnError('DISK_FULL', mainStrings.exportCopy.diskFull, { cause: e, retryable: true });
  return e;
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
  handle(Channels.library.searchTexts, emptyInput, () => deps.getContext().repo.searchTexts());

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

  /**
   * The item's file, re-checked first (a missing file is reported, never used): the item, its asset and where its bytes
   * are on disk. The renderer never sees a path.
   */
  async function availableAsset(itemId: string) {
    const ctx = deps.getContext();
    const item = await refreshItemAvailability(ctx, itemId);
    const copy = mainStrings.itemFile;
    if (item.availability === 'missing') throw new LearnError('NOT_FOUND', item.storageMode === 'managed' ? copy.managedMissing : copy.linkedMissing);
    const asset = ctx.repo.getAsset(item.assetId);
    if (!asset) throw new LearnError('NOT_FOUND', copy.noItem);
    return { ctx, item, asset, src: resolveAssetPath(ctx.layout, asset) };
  }

  /**
   * The file to hand the OS for an item: a name the OS can open by its extension (openableFile: the named copy under
   * derived/open/ for a managed asset, or for a linked file whose extension misleads; final review I1).
   */
  async function existingFile(itemId: string): Promise<string> {
    const { ctx, item, asset, src } = await availableAsset(itemId);
    return openableFile(ctx.layout, asset, item.title, src);
  }

  // Finder에서 보기 / 기본 앱으로 열기 (design-spec 7.3, 10.7): the renderer has no shell; main resolves the path itself.
  handle(Channels.library.showInFolder, itemIdInput, async ({ itemId }) => {
    shell.showItemInFolder(await existingFile(itemId));
  });

  handle(Channels.library.openExternally, itemIdInput, async ({ itemId }) => {
    // openPath resolves with the OS's error text (English, may name the path): logged by code only, never shown.
    const failure = await shell.openPath(await existingFile(itemId));
    if (failure) throw new LearnError('INTERNAL', mainStrings.itemFile.noApp);
  });

  /** The copy 사본 내보내기 saved last in this run: its folder is where the next panel opens, and revealExport shows it. */
  let lastExport: string | null = null;

  // 사본 내보내기… (spec §7): the save panel as a sheet on the asking window, then the copy through a temporary name in the
  // chosen folder (exportFile). The panel asks before replacing a file (showOverwriteConfirmation on Linux; macOS and
  // Windows always ask). The default name is the one 기본 앱으로 열기 gives its copy.
  handle(Channels.library.exportCopy, itemIdInput, async ({ itemId }, event) => {
    const { item, asset, src } = await availableAsset(itemId);
    const ext = openExtension(asset.mime, asset.originalName);
    const options: SaveDialogOptions = {
      title: commandMention(commandById('item.exportCopy'), process.platform),
      defaultPath: path.join(lastExport ? path.dirname(lastExport) : app.getPath('downloads'), openableName(asset, item.title) ?? safeBaseName(asset.originalName)),
      properties: ['createDirectory', 'showOverwriteConfirmation'],
      ...(ext ? { filters: [{ name: mainStrings.exportCopy.filterName[item.type], extensions: [ext] }] } : {}),
    };
    const win = BrowserWindow.fromWebContents(event.sender);
    const res = win ? await deps.windows.asSheet(win, () => dialog.showSaveDialog(win, options)) : await dialog.showSaveDialog(options);
    if (res.canceled || !res.filePath) return { saved: false };
    try {
      // The file itself, never a link to it (a clone of a symlink is the symlink on macOS, as for the named copy).
      await exportFile(await fs.realpath(src), res.filePath);
    } catch (e) {
      throw exportError(e);
    }
    lastExport = res.filePath;
    return { saved: true };
  });

  handle(Channels.library.revealExport, emptyInput, () => {
    if (lastExport === null || !existsSync(lastExport)) throw new LearnError('NOT_FOUND', mainStrings.exportCopy.gone);
    shell.showItemInFolder(lastExport);
  });
}
