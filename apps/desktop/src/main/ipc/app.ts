import fs from 'node:fs';
import path from 'node:path';
import { BrowserWindow, dialog, shell, type MessageBoxOptions, type OpenDialogOptions, type WebContents } from 'electron';
import { Channels, LearnError, emptyInput } from '@learn/domain';
import { broadcast } from '../events';
import { checkLibraryFolder } from '../library-folder';
import { mainStrings } from '../strings';
import type { Handle, IpcDeps } from './register';

const copy = mainStrings.libraryFolder;

export function registerAppIpc(handle: Handle, deps: IpcDeps): void {
  handle(Channels.app.info, emptyInput, () => deps.appInfo());

  // The library location belongs to the settings window: no other window of ours asks for it (defence in depth; the
  // page URL check and the native confirmation still come first and last).
  const fromSettings = (sender: WebContents): void => {
    if (!deps.isSettingsWindow(sender)) throw new LearnError('PERMISSION_DENIED', '허용되지 않은 호출자입니다.');
  };

  handle(Channels.app.showLibraryFolder, emptyInput, (_input, event) => {
    fromSettings(event.sender);
    const root = deps.appInfo().libraryRoot;
    // showItemInFolder does nothing for a path that is gone (a disk that was ejected): say so instead.
    if (!fs.existsSync(root)) throw new LearnError('NOT_FOUND', copy.revealMissing);
    shell.showItemInFolder(root);
  });

  // R4: the renderer never sends a path. Main asks for a folder, checks it, confirms the restart, saves it and relaunches.
  handle(Channels.app.chooseLibraryFolder, emptyInput, async (_input, event) => {
    fromSettings(event.sender);
    const owner = BrowserWindow.fromWebContents(event.sender);
    // Both dialogs hang on the calling window (the settings window) as sheets on macOS.
    const onOwner = <T>(show: () => Promise<T>): Promise<T> => (owner ? deps.windows.asSheet(owner, show) : show());
    const pick: OpenDialogOptions = { title: copy.pickTitle, buttonLabel: copy.pickButton, properties: ['openDirectory', 'createDirectory'] };
    const res = await onOwner(() => (owner ? dialog.showOpenDialog(owner, pick) : dialog.showOpenDialog(pick)));
    const picked = res.canceled ? undefined : res.filePaths[0];
    if (!picked) return { relaunching: false };
    const target = path.resolve(picked);
    if (target === path.resolve(deps.appInfo().libraryRoot)) return { relaunching: false }; // already open
    const check = checkLibraryFolder(target);
    if (!check.ok) throw new LearnError('VALIDATION_FAILED', check.message);
    const ask: MessageBoxOptions = {
      type: 'question',
      message: copy.confirmMessage,
      detail: copy.confirmDetail(target),
      buttons: [...copy.confirmButtons],
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
