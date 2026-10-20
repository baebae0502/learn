import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent, type OpenDialogOptions } from 'electron';
import type { z } from 'zod';
import {
  IpcChannels, LearnError, assetIdInput, emptyInput, failureFrom, importPathsInput, itemIdInput, ok, pickAndImportInput,
  type AppInfo, type Result,
} from '@learn/domain';
import { refreshAvailability, relinkAsset } from '@learn/library';
import type { LibraryContext } from './library-context';
import { isAllowedAppUrl } from './url-policy';

export interface IpcDeps {
  getContext(): LibraryContext;
  appInfo(): AppInfo;
  devOrigin: string | null;
}

type Handler<S extends z.ZodType, T> = (input: z.output<S>, event: IpcMainInvokeEvent) => Promise<T> | T;

const IMPORT_FILTERS: OpenDialogOptions['filters'] = [
  { name: 'PDF·동영상', extensions: ['pdf', 'mp4', 'm4v', 'mov', 'webm', 'mkv'] },
  { name: '모든 파일', extensions: ['*'] },
];

async function showOpen(event: IpcMainInvokeEvent, options: OpenDialogOptions): Promise<string[]> {
  const win = BrowserWindow.fromWebContents(event.sender);
  const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  return res.canceled ? [] : res.filePaths;
}

export function registerIpc(deps: IpcDeps): void {
  function handle<S extends z.ZodType, T>(channel: string, schema: S, fn: Handler<S, T>): void {
    ipcMain.handle(channel, async (event, raw: unknown): Promise<Result<T>> => {
      try {
        if (!isAllowedAppUrl(event.senderFrame?.url ?? '', deps.devOrigin)) {
          throw new LearnError('PERMISSION_DENIED', '허용되지 않은 호출자입니다.');
        }
        const parsed = schema.safeParse(raw ?? undefined);
        if (!parsed.success) throw new LearnError('VALIDATION_FAILED', '잘못된 요청입니다.');
        return ok(await fn(parsed.data, event));
      } catch (e) {
        const failure = failureFrom(e);
        console.error(`[ipc] ${channel} failed: ${failure.code}`);
        return failure;
      }
    });
  }

  handle(IpcChannels.appInfo, emptyInput, () => deps.appInfo());

  handle(IpcChannels.pickAndImport, pickAndImportInput, async (input, event) => {
    const ctx = deps.getContext();
    const paths = await showOpen(event, { title: '자료 가져오기', properties: ['openFile', 'multiSelections'], filters: IMPORT_FILTERS });
    return paths.length === 0 ? [] : ctx.importer.importMany(paths, input);
  });

  handle(IpcChannels.importPaths, importPathsInput, (input) => deps.getContext().importer.importMany(input.paths, input));

  handle(IpcChannels.listItems, emptyInput, () => deps.getContext().repo.listItems());

  handle(IpcChannels.getItem, itemIdInput, async ({ itemId }) => {
    const ctx = deps.getContext();
    const item = ctx.repo.getItem(itemId);
    const asset = item && ctx.repo.getAsset(item.assetId);
    if (!item || !asset) throw new LearnError('NOT_FOUND', '자료를 찾을 수 없습니다.');
    await refreshAvailability(ctx.layout, ctx.repo, asset);
    return ctx.repo.getItem(itemId)!;
  });

  handle(IpcChannels.pickAndRelink, assetIdInput, async ({ assetId }, event) => {
    const ctx = deps.getContext();
    const [picked] = await showOpen(event, { title: '원본 파일 다시 연결', properties: ['openFile'], filters: IMPORT_FILTERS });
    if (!picked) return null;
    await relinkAsset(ctx.repo, assetId, picked);
    const itemId = ctx.repo.itemIdsForAsset(assetId)[0];
    return itemId ? ctx.repo.getItem(itemId) ?? null : null;
  });

  handle(IpcChannels.recoveryReport, emptyInput, () => deps.getContext().recovery);
}
