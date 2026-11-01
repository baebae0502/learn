import { IDLE_BACKUP_PROGRESS, IDLE_IMPORT_STATE, NO_LIBRARY_VIEW } from '@learn/domain';
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
    sheets: { open: async () => null, payloadFor: () => ({ kind: 'shortcuts' }), resolve: () => {}, act: async () => { throw new Error('sheets.act not stubbed'); }, onAct: () => {} },
    jobs: { run: (_kind, work) => work(new AbortController().signal), busy: () => null, cancelCurrent: () => {}, cancelAll: () => {}, idle: async () => {} },
    imports: { enqueue: () => 0, cancel: () => {}, state: () => ({ ...IDLE_IMPORT_STATE }), onProgress: () => () => {}, onFinished: () => () => {} },
    backup: { start: async () => ({ started: false }), cancel: () => {}, state: () => ({ ...IDLE_BACKUP_PROGRESS }), setHooks: () => {} },
    checks: {
      open: async () => {},
      act: async () => {
        throw new Error('checks.act not stubbed');
      },
      recheck: async () => {
        throw new Error('checks.recheck not stubbed');
      },
    },
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
