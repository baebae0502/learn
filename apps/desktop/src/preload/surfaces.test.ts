import { describe, expect, it, vi } from 'vitest';
import { EventChannels, type LearnEventMap } from '@learn/domain';
import { CHANNEL_KINDS } from '../main/ipc/channel-kinds';
import type { WindowKind } from '../main/window-kinds';

type Api = Record<string, unknown>;
/** What each preload handed contextBridge, in import order. */
const exposed: Array<{ key: string; api: Api }> = [];
const invoked: unknown[][] = [];
const listeners: Array<{ channel: string; listener: (...args: unknown[]) => void }> = [];
const removed: unknown[][] = [];

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: (key: string, api: Api) => void exposed.push({ key, api }) },
  ipcRenderer: {
    invoke: async (...args: unknown[]) => void invoked.push(args),
    on: (channel: string, listener: (...args: unknown[]) => void) => void listeners.push({ channel, listener }),
    removeListener: (...args: unknown[]) => void removed.push(args),
  },
  webUtils: { getPathForFile: () => '/dropped/file.pdf' },
}));

await import('./main');
await import('./settings');
await import('./sheet');
const surfaces: Record<WindowKind, Api> = { main: exposed[0]!.api, settings: exposed[1]!.api, sheet: exposed[2]!.api };

/** Every function of a window.learn: `ns.verb` for invokers, the name for on / pathForFile. */
const functions = (api: Api): string[] =>
  Object.entries(api)
    .flatMap(([key, value]) => (typeof value === 'function' ? [key] : Object.keys(value as Api).map((verb) => `${key}.${verb}`)))
    .sort();
/** The channels CHANNEL_KINDS lets a window kind call, as `ns.verb`. */
const allowedFor = (kind: WindowKind) =>
  Object.entries(CHANNEL_KINDS)
    .filter(([, kinds]) => kinds.includes(kind))
    .map(([channel]) => channel.replace(':', '.'));
/** The push events each window's page may subscribe to. */
const EVENTS: Record<WindowKind, ReadonlyArray<keyof LearnEventMap>> = {
  main: ['menuCommand', 'libraryChanged', 'windowState', 'settingsChanged', 'prefsChanged', 'nativeMenu', 'demoShortcut'],
  // Its own window state, menu-bar menus and prefs; menuCommand and demoShortcut for the demo overlay it can show.
  settings: ['windowState', 'nativeMenu', 'prefsChanged', 'menuCommand', 'demoShortcut'],
  sheet: [],
};
const onOf = (kind: WindowKind) => surfaces[kind]['on'] as (name: unknown, cb: unknown) => () => void;

describe('preloads per window kind', () => {
  it('each window gets the invokers of exactly the channels CHANNEL_KINDS allows its kind, on() where it hears events, pathForFile in the main window', () => {
    expect(exposed.map((e) => e.key)).toEqual(['learn', 'learn', 'learn']);
    expect(functions(surfaces.main)).toEqual([...allowedFor('main'), 'on', 'pathForFile'].sort());
    expect(functions(surfaces.settings)).toEqual([...allowedFor('settings'), 'on'].sort());
    expect(functions(surfaces.sheet)).toEqual(allowedFor('sheet').sort());
  });

  it('every invoker sends its own channel with the input as given', async () => {
    for (const [kind, api] of Object.entries(surfaces)) {
      for (const name of functions(api).filter((n) => n.includes('.'))) {
        const [ns, verb] = name.split('.') as [string, string];
        invoked.length = 0;
        await (api[ns] as Record<string, (input?: unknown) => Promise<unknown>>)[verb]!({ probe: kind });
        expect(invoked, name).toEqual([[`${ns}:${verb}`, { probe: kind }]]);
      }
    }
  });

  it("on() takes exactly its window's events, refuses any other name or a callback that is not a function", () => {
    for (const kind of ['main', 'settings'] as const) {
      for (const name of Object.keys(EventChannels)) {
        let taken = true;
        try {
          onOf(kind)(name, () => {});
        } catch {
          taken = false;
        }
        expect(taken, `${kind}: ${name}`).toBe(EVENTS[kind].includes(name as keyof LearnEventMap));
      }
      for (const bad of ['notAllowed', 'toString', 'constructor', 42]) expect(() => onOf(kind)(bad, () => {})).toThrow(/unknown event/);
      expect(() => onOf(kind)('windowState', 'not a function')).toThrow(/callback/);
    }
    expect(surfaces.sheet['on']).toBeUndefined(); // a sheet hears nothing: no on() at all
  });

  it('hands the callback the payload only, and the returned function unsubscribes', () => {
    listeners.length = 0;
    const seen: unknown[][] = [];
    const off = onOf('settings')('prefsChanged', (...args: unknown[]) => void seen.push(args));
    const sub = listeners[0]!;
    expect(sub.channel).toBe(EventChannels.prefsChanged);
    sub.listener({ sender: 'the IpcRendererEvent', ports: [] }, { prefs: { theme: 'dark' } });
    expect(seen).toEqual([[{ prefs: { theme: 'dark' } }]]);
    off();
    expect(removed.at(-1)).toEqual([EventChannels.prefsChanged, sub.listener]);
  });

  it('resolves a dropped file through webUtils in the main window only', () => {
    expect((surfaces.main['pathForFile'] as (file: unknown) => string)({})).toBe('/dropped/file.pdf');
    expect(surfaces.settings['pathForFile']).toBeUndefined();
    expect(surfaces.sheet['pathForFile']).toBeUndefined();
  });
});
