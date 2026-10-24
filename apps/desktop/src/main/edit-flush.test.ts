import { describe, expect, it, vi } from 'vitest';
import { FLUSH_SCRIPT, createFlushGate, type FlushGate, type FlushWindow } from './edit-flush';

interface Ev {
  prevented: boolean;
  preventDefault(): void;
}
const ev = (): Ev => ({
  prevented: false,
  preventDefault() {
    this.prevented = true;
  },
});

/** A main window and an app the way Electron drives the gate: close() emits 'close', quit() emits 'before-quit', then closes. */
function rig(answers: Array<() => Promise<unknown>>) {
  const calls = { scripts: 0, exited: false, records: [] as Array<{ action: string; result: string }> };
  let gate!: FlushGate;
  const win: FlushWindow & { destroyed: boolean } = {
    destroyed: false,
    isDestroyed: () => win.destroyed,
    close: () => {
      const e = ev();
      gate.onClose(win, e);
      if (!e.prevented) win.destroyed = true;
    },
    webContents: {
      executeJavaScript: (code: string) => {
        expect(code).toBe(FLUSH_SCRIPT);
        calls.scripts++;
        return (answers.shift() ?? (() => Promise.resolve('clean')))();
      },
    },
  };
  const quit = () => {
    const e = ev();
    gate.onBeforeQuit(e);
    if (e.prevented) return;
    if (!win.destroyed) win.close();
    calls.exited = win.destroyed;
  };
  gate = createFlushGate({ mainWindow: () => (win.destroyed ? null : win), quit, timeoutMs: 50, record: (r) => calls.records.push(r) });
  return { win, quit, calls };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('closing or quitting over an open 정보 편집 (spec §5.3; M/edit-flush.ts)', () => {
  it('saved: the close is held while the page saves, then goes on; the repeat is not asked again', async () => {
    const r = rig([() => Promise.resolve('saved')]);
    r.win.close();
    expect(r.win.destroyed).toBe(false);
    await vi.waitFor(() => expect(r.win.destroyed).toBe(true));
    expect(r.calls.scripts).toBe(1);
    expect(r.calls.records).toEqual([{ action: 'close', result: 'saved' }]);
  });
  it('clean: a quit goes on and really quits (the window closes inside it unasked)', async () => {
    const r = rig([() => Promise.resolve('clean')]);
    r.quit();
    expect(r.calls.exited).toBe(false);
    await vi.waitFor(() => expect(r.calls.exited).toBe(true));
    expect(r.calls.scripts).toBe(1);
  });
  it('invalid: the window stays and the quit is off; a later attempt asks again', async () => {
    const r = rig([() => Promise.resolve('invalid'), () => Promise.resolve('invalid')]);
    r.win.close();
    await tick();
    expect(r.win.destroyed).toBe(false);
    r.quit();
    await tick();
    expect(r.calls.exited).toBe(false);
    expect(r.calls.scripts).toBe(2);
    expect(r.calls.records).toEqual([{ action: 'close', result: 'invalid' }, { action: 'quit', result: 'invalid' }]);
  });
  it('a page that does not answer in time, throws or says something else holds nothing (counts as clean)', async () => {
    const hung = rig([() => new Promise(() => {})]);
    hung.quit();
    await vi.waitFor(() => expect(hung.calls.exited).toBe(true));
    const thrown = rig([() => Promise.reject(new Error('render process gone'))]);
    thrown.win.close();
    await vi.waitFor(() => expect(thrown.win.destroyed).toBe(true));
    const odd = rig([() => Promise.resolve(42)]);
    odd.win.close();
    await vi.waitFor(() => expect(odd.win.destroyed).toBe(true));
  });
  it('no re-entry: a second close while the page decides asks nothing more; ⌘Q meanwhile turns it into a quit', async () => {
    let release!: (v: unknown) => void;
    const r = rig([() => new Promise((res) => (release = res))]);
    r.win.close();
    r.win.close();
    r.quit();
    expect(r.calls.scripts).toBe(1);
    release('saved');
    await vi.waitFor(() => expect(r.calls.exited).toBe(true));
    expect(r.calls.scripts).toBe(1);
    expect(r.calls.records).toEqual([{ action: 'quit', result: 'saved' }]);
  });
  it('without a main window a quit is not held (Linux after the window closed, macOS with only settings left)', () => {
    const r = rig([]);
    r.win.destroyed = true;
    r.quit();
    expect(r.calls.exited).toBe(true);
    expect(r.calls.scripts).toBe(0);
  });
});
