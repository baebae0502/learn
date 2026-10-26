import { beforeEach, describe, expect, it, vi } from 'vitest';

const sent: Array<[string, unknown]> = [];
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [{ isDestroyed: () => false, webContents: { isDestroyed: () => false, send: (channel: string, payload: unknown) => sent.push([channel, payload]) } }],
  },
}));
const { broadcast, onBroadcast } = await import('./events');

beforeEach(() => {
  sent.length = 0;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('broadcast', () => {
  it('reaches every window, and main\'s own observers hear it first with the name and the payload', () => {
    const heard: unknown[] = [];
    const off = onBroadcast((e) => heard.push([e.name, e.payload, sent.length]));
    broadcast('libraryChanged', { reason: 'collections' });
    expect(heard).toEqual([['libraryChanged', { reason: 'collections' }, 0]]);
    expect(sent).toEqual([['evt:library-changed', { reason: 'collections' }]]);
    off();
    broadcast('libraryChanged', { reason: 'tags' });
    expect(heard).toHaveLength(1);
    expect(sent).toHaveLength(2);
  });
  it('an observer that throws neither stops the windows nor the other observers', () => {
    const second = vi.fn();
    const offA = onBroadcast(() => {
      throw new Error('boom');
    });
    const offB = onBroadcast(second);
    broadcast('nativeMenu', { open: true });
    expect(second).toHaveBeenCalledTimes(1);
    expect(sent).toEqual([['evt:native-menu', { open: true }]]);
    offA();
    offB();
  });
});
