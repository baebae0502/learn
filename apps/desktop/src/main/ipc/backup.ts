import fs from 'node:fs';
import path from 'node:path';
import { BrowserWindow, shell, type WebContents } from 'electron';
import { Channels, LearnError, emptyInput, type BackupInfo } from '@learn/domain';
import type { SettingsRepository } from '@learn/db';
import { mainStrings } from '../strings';
import type { Handle, IpcDeps } from './register';

/** backup.last (spec 8.2) as main wrote it; null when this library has none. */
export function lastBackup(settings: Pick<SettingsRepository, 'get'>): { at: string; folder: string } | null {
  return (settings.get('backup.last') as { at: string; folder: string } | undefined) ?? null;
}

/** Finder에서 보기 on a backup folder: shown selected in its parent; a folder that is gone says so (R4: main opens it). */
export function revealBackupFolder(folder: string): void {
  if (!fs.existsSync(folder)) throw new LearnError('NOT_FOUND', mainStrings.backup.revealMissing);
  shell.showItemInFolder(folder);
}

/** 백업 만들기… and its 취소 (the main window), 마지막 백업 (the settings window). Restore is Task 10's. */
export function registerBackupIpc(handle: Handle, deps: IpcDeps): void {
  // Defence in depth, as app.ts does for the library location: CHANNEL_KINDS already admits the settings window only.
  const fromSettings = (sender: WebContents): void => {
    if (!deps.isSettingsWindow(sender)) throw new LearnError('PERMISSION_DENIED', mainStrings.callerRefused);
  };
  // R4: the page sends no path — main asks for the folder, over the window that asked.
  handle(Channels.backup.create, emptyInput, (_input, event) => deps.backup.start(BrowserWindow.fromWebContents(event.sender)));
  handle(Channels.backup.cancel, emptyInput, () => deps.backup.cancel());
  handle(Channels.app.backupInfo, emptyInput, (_input, event): BackupInfo | null => {
    fromSettings(event.sender);
    let last: { at: string; folder: string } | null;
    try {
      last = lastBackup(deps.getContext().settings);
    } catch {
      return null; // no library open: the settings window shows no 마지막 백업
    }
    return last === null ? null : { at: last.at, folderName: path.basename(last.folder) };
  });
  handle(Channels.app.revealBackup, emptyInput, (_input, event) => {
    fromSettings(event.sender);
    const last = lastBackup(deps.getContext().settings);
    if (last === null) throw new LearnError('NOT_FOUND', mainStrings.backup.revealMissing);
    revealBackupFolder(last.folder);
  });
}
