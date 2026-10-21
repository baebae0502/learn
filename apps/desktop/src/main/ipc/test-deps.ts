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
    uiContext: { report: () => {}, current: () => ({ view: 'library', blocked: false }) },
    sheets: { open: async () => null, payloadFor: () => ({ kind: 'shortcuts' }), resolve: () => {} },
    ...over,
  };
}
