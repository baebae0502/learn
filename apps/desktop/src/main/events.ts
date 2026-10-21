import { BrowserWindow, type WebContents } from 'electron';
import { EventChannels, type LearnEventMap } from '@learn/domain';

/** Main -> renderer push to one renderer. Only names in EventChannels exist; the preload drops the IPC event object. */
export function sendEvent<K extends keyof LearnEventMap>(contents: WebContents, name: K, payload: LearnEventMap[K]): void {
  if (!contents.isDestroyed()) contents.send(EventChannels[name], payload);
}

/** Main -> renderer push to every window. */
export function broadcast<K extends keyof LearnEventMap>(name: K, payload: LearnEventMap[K]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) sendEvent(win.webContents, name, payload);
  }
}
