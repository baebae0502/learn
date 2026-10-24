import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import type { LearnApi, LearnEventMap } from '@learn/domain';
// Subpath imports: names only, no zod in the sandboxed preload bundles.
import { EventChannels } from '@learn/domain/event-channels';
import { Channels } from '@learn/domain/ipc-channels';

type Requests = Omit<LearnApi, 'on' | 'pathForFile'>;

// Compile-time guard: Channels and LearnApi declare exactly the same namespaces and verbs.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const sameShape: Same<{ [N in keyof Requests]: keyof Requests[N] }, { [N in keyof typeof Channels]: keyof (typeof Channels)[N] }> = true;
void sameShape;

/** The verbs of each namespace a window's page may call: a part of LearnApi. */
export type RequestPick = { readonly [N in keyof Requests]?: readonly (keyof Requests[N])[] };

/**
 * What one window kind's preload gives its page as window.learn. Main checks the same per channel
 * (CHANNEL_KINDS); preload/surfaces.test.ts keeps the two equal.
 */
export interface Surface {
  requests: RequestPick;
  /** The push events its page may subscribe to; on() throws for any other name. None: no on() at all. */
  events: readonly (keyof LearnEventMap)[];
  /** Drag and drop: resolves a dropped File to its path via webUtils (sandbox-safe). The main window only. */
  pathForFile?: true;
}

type Invoker = (input?: unknown) => Promise<unknown>;

/** One fixed invoker per allowed channel. No generic invoke/send is ever exposed. */
function invokers(requests: RequestPick): Record<string, Record<string, Invoker>> {
  return Object.fromEntries(
    Object.entries(requests).map(([ns, verbs]) => {
      const channels: Readonly<Record<string, string>> = Channels[ns as keyof typeof Channels];
      return [ns, Object.fromEntries((verbs as readonly string[]).map((verb) => [verb, (input?: unknown) => ipcRenderer.invoke(channels[verb]!, input)]))];
    }),
  );
}

function subscriber(events: readonly (keyof LearnEventMap)[]): LearnApi['on'] {
  const allowed = new Set<string>(events);
  return (name, cb) => {
    if (typeof name !== 'string' || !allowed.has(name) || !Object.hasOwn(EventChannels, name)) throw new Error(`unknown event: ${String(name)}`);
    if (typeof cb !== 'function') throw new Error('callback must be a function');
    const channel = EventChannels[name];
    // The IpcRendererEvent (sender, ports) never reaches the page: only the payload does.
    const listener = (_event: IpcRendererEvent, payload: unknown) => cb(payload as Parameters<typeof cb>[0]);
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  };
}

export function exposeSurface(surface: Surface): void {
  contextBridge.exposeInMainWorld('learn', {
    ...invokers(surface.requests),
    ...(surface.events.length > 0 ? { on: subscriber(surface.events) } : {}),
    ...(surface.pathForFile ? { pathForFile: (file: File) => webUtils.getPathForFile(file) } : {}),
  });
}
