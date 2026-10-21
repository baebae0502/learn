import fs from 'node:fs';
import path from 'node:path';
import { BrowserWindow, dialog, shell, type MessageBoxOptions, type OpenDialogOptions } from 'electron';
import { Channels, LearnError, emptyInput } from '@learn/domain';
import { broadcast } from '../events';
import { checkLibraryFolder } from '../library-folder';
import type { Handle, IpcDeps } from './register';

export function registerAppIpc(handle: Handle, deps: IpcDeps): void {
  handle(Channels.app.info, emptyInput, () => deps.appInfo());

  handle(Channels.app.showLibraryFolder, emptyInput, () => {
    const root = deps.appInfo().libraryRoot;
    // showItemInFolder does nothing for a path that is gone (a disk that was ejected): say so instead.
    if (!fs.existsSync(root)) throw new LearnError('NOT_FOUND', '라이브러리 폴더를 찾을 수 없습니다. 폴더가 있는 디스크가 연결되어 있는지 확인하세요.');
    shell.showItemInFolder(root);
  });

  // R4: the renderer never sends a path. Main asks for a folder, checks it, confirms the restart, saves it and relaunches.
  handle(Channels.app.chooseLibraryFolder, emptyInput, async (_input, event) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    // Both dialogs hang on the calling window (the settings window) as sheets on macOS.
    const onOwner = <T>(show: () => Promise<T>): Promise<T> => (owner ? deps.windows.asSheet(owner, show) : show());
    const pick: OpenDialogOptions = { title: '라이브러리 폴더 선택', buttonLabel: '선택', properties: ['openDirectory', 'createDirectory'] };
    const res = await onOwner(() => (owner ? dialog.showOpenDialog(owner, pick) : dialog.showOpenDialog(pick)));
    const picked = res.canceled ? undefined : res.filePaths[0];
    if (!picked) return { relaunching: false };
    const target = path.resolve(picked);
    if (target === path.resolve(deps.appInfo().libraryRoot)) return { relaunching: false }; // already open
    const check = checkLibraryFolder(target);
    if (!check.ok) throw new LearnError('VALIDATION_FAILED', check.message);
    const ask: MessageBoxOptions = {
      type: 'question',
      message: '다른\u00a0라이브러리를 열려면 Learn을 다시 시작해야 합니다',
      detail: `${target}\n이\u00a0폴더에 라이브러리가 없으면 새로 만듭니다. 지금 라이브러리는 그대로 남아 있습니다.`,
      buttons: ['다시 시작', '취소'],
      defaultId: 0,
      cancelId: 1,
    };
    const { response } = await onOwner(() => (owner ? dialog.showMessageBox(owner, ask) : dialog.showMessageBox(ask)));
    if (response !== 0) return { relaunching: false };
    const prefs = deps.prefs.set({ libraryRoot: target });
    broadcast('prefsChanged', { prefs });
    deps.relaunch();
    return { relaunching: true };
  });
}
