import { describe, expect, it, vi } from 'vitest';
import { Channels } from '@learn/domain';
import type { Handle } from './register';
import { stubDeps } from './test-deps';

// Registration only records names: nothing from electron is used until a handler runs.
vi.mock('electron', () => ({ ipcMain: {}, BrowserWindow: {}, dialog: {}, Menu: {}, nativeTheme: {} }));

const { registerAllIpc } = await import('./all');

describe('registerAllIpc (what main/index.ts registers)', () => {
  it('registers every declared channel exactly once, and nothing else', () => {
    const registered: string[] = [];
    const recording = ((channel: string) => void registered.push(channel)) as unknown as Handle;
    registerAllIpc(recording, stubDeps({ getContext: () => ({}) as never, appInfo: () => ({}) as never }));

    const declared = Object.values(Channels).flatMap((verbs) => Object.values(verbs) as string[]);
    expect(new Set(registered).size).toBe(registered.length); // no channel registered twice
    expect([...registered].sort()).toEqual([...declared].sort()); // none missing, none extra
  });
});
