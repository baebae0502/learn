import { BrowserWindow, type WebContents } from 'electron';
import { EventChannels, type LearnEventMap } from '@learn/domain';

/** Main -> renderer push to one renderer. Only names in EventChannels exist; the preload drops the IPC event object. */
export function sendEvent<K extends keyof LearnEventMap>(contents: WebContents, name: K, payload: LearnEventMap[K]): void {
  if (!contents.isDestroyed()) contents.send(EventChannels[name], payload);
}

/** One broadcast, as main's own observers hear it. */
export type BroadcastEvent = { [K in keyof LearnEventMap]: { name: K; payload: LearnEventMap[K] } }[keyof LearnEventMap];
const observers = new Set<(event: BroadcastEvent) => void>();

/** Main's own code hears what it broadcasts (the menu bar follows the collections and tags that main announces). Returns the unsubscribe. */
export function onBroadcast(observer: (event: BroadcastEvent) => void): () => void {
  observers.add(observer);
  return () => void observers.delete(observer);
}

/** Main -> renderer push to every window. */
export function broadcast<K extends keyof LearnEventMap>(name: K, payload: LearnEventMap[K]): void {
  for (const observer of observers) {
    try {
      observer({ name, payload } as BroadcastEvent);
    } catch {
      console.warn(`[events] an observer of ${name} failed`); // the event name only
    }
  }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) sendEvent(win.webContents, name, payload);
  }
}
