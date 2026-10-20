import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import type { LearnApi } from '@learn/domain';
// Subpath imports: names only, no zod in the sandboxed preload bundle.
import { EventChannels } from '@learn/domain/event-channels';
import { Channels } from '@learn/domain/ipc-channels';

type Requests = Omit<LearnApi, 'on' | 'pathForFile'>;

// Compile-time guard: Channels and LearnApi declare exactly the same namespaces and verbs.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const sameShape: Same<{ [N in keyof Requests]: keyof Requests[N] }, { [N in keyof typeof Channels]: keyof (typeof Channels)[N] }> = true;
void sameShape;

/** One fixed invoker per declared channel. No generic invoke/send is ever exposed. */
const requests = Object.fromEntries(
  Object.entries(Channels).map(([ns, verbs]) => [
    ns,
    Object.fromEntries(Object.entries(verbs).map(([verb, channel]) => [verb, (input?: unknown) => ipcRenderer.invoke(channel, input)])),
  ]),
) as unknown as Requests;

const api: LearnApi = {
  ...requests,
  on(name, cb) {
    if (typeof name !== 'string' || !Object.hasOwn(EventChannels, name)) throw new Error(`unknown event: ${String(name)}`);
    if (typeof cb !== 'function') throw new Error('callback must be a function');
    const channel = EventChannels[name];
    // The IpcRendererEvent (sender, ports) never reaches the page: only the payload does.
    const listener = (_event: IpcRendererEvent, payload: unknown) => cb(payload as Parameters<typeof cb>[0]);
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  },
  pathForFile: (file) => webUtils.getPathForFile(file),
};

contextBridge.exposeInMainWorld('learn', api);
