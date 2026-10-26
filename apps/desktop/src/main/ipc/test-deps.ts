import { NO_LIBRARY_VIEW } from '@learn/domain';
import { registerWindowKind, type KindedContents, type WindowKind } from '../window-kinds';
import type { IpcDeps } from './register';

/** IpcDeps for IPC unit tests: inert stubs, a test overrides what it exercises. M3 tasks that add IpcDeps fields add their stub here. */
export function stubDeps(over: Partial<IpcDeps> = {}): IpcDeps {
  return {
    getContext: () => {
      throw new Error('getContext not stubbed');
    },
    appInfo: () => {
      throw new Error('appInfo not stubbed');
    },
    prefs: {} as IpcDeps['prefs'],
    uiContext: {
      report: () => {},
      current: () => ({ view: 'library', blocked: false, textSize: 13, libraryCount: 0, selectionCount: 0, selectionAvailable: 0, selectionRelinkable: 0, ...NO_LIBRARY_VIEW }),
    },
    sheets: { open: async () => null, payloadFor: () => ({ kind: 'shortcuts' }), resolve: () => {} },
    isMainWindow: () => true,
    isSettingsWindow: () => true,
    windows: { openSettings: () => {}, asSheet: (_owner, show) => show() },
    theme: { changed: () => {}, shown: () => {} },
    prepareSettings: () => {},
    relaunch: () => {},
    ...over,
  };
}

/**
 * A sender webContents for IPC unit tests, registered as a window of `kind`: createHandle answers only senders main
 * registered, and only for the kinds a channel allows.
 */
export function fakeSender(id: number, kind: WindowKind): KindedContents {
  const contents: KindedContents = { id, once: () => contents };
  registerWindowKind(contents, kind);
  return contents;
}
