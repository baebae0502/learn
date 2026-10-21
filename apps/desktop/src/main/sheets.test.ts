import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow, WebContents } from 'electron';

/** A BrowserWindow stand-in: records what the host does with it; tests drive its lifecycle events. */
class FakeWindow extends EventEmitter {
  static all: FakeWindow[] = [];
  static nextId = 1;
  destroyed = false;
  shown = false;
  contentSize: [number, number];
  position: [number, number] | null = null;
  url = '';
  readonly webContents: EventEmitter & { id: number; executeJavaScript(script: string): Promise<unknown> };
  constructor(readonly options: { width: number; height: number; parent: unknown; modal: boolean; frame: boolean }) {
    super();
    this.contentSize = [options.width, options.height];
    const contents = new EventEmitter() as FakeWindow['webContents'];
    contents.id = FakeWindow.nextId++;
    // contentHeight polls in the page; markSized sets a flag. The fake page is 200 px tall.
    contents.executeJavaScript = async (script: string) => (script.includes('getBoundingClientRect') ? 200 : undefined);
    this.webContents = contents;
    FakeWindow.all.push(this);
  }
  isDestroyed = () => this.destroyed;
  setContentSize = (w: number, h: number) => void (this.contentSize = [w, h]);
  setPosition = (x: number, y: number) => void (this.position = [x, y]);
  show = () => void (this.shown = true);
  loadURL = async (url: string) => {
    this.url = url;
    if (url.includes('fail')) throw new Error('ERR_FAILED (-2) loading url'); // as Electron rejects a failed load
  };
  close = () => {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit('closed');
  };
}

vi.mock('electron', () => ({ BrowserWindow: FakeWindow, nativeTheme: { shouldUseDarkColors: false } }));

const { createSheetHost, SHEET_TOP } = await import('./sheets');

const parent = (id = 1) =>
  ({ id, isDestroyed: () => false, getContentBounds: () => ({ x: 100, y: 50, width: 1440, height: 900 }) }) as unknown as BrowserWindow;
const contentsOf = (w: FakeWindow) => w.webContents as unknown as WebContents;
const tick = () => new Promise((r) => setTimeout(r, 0));
/** Lets the host measure, size and show the newest window. */
async function ready(w: FakeWindow): Promise<void> {
  w.emit('ready-to-show');
  for (let i = 0; i < 5 && !w.shown; i++) await tick();
}

beforeEach(() => {
  FakeWindow.all = [];
});

describe('sheet host', () => {
  const host = () => createSheetHost({ preload: '/p.cjs', url: () => 'learn://app/index.html?window=sheet', platform: 'linux' });

  it('opens a hidden modal child, sizes it to its content, places it under the toolbar, then shows it', async () => {
    const h = host();
    const result = h.open(parent(), { kind: 'shortcuts' });
    await tick(); // the window is created once nothing else is showing over this parent
    const w = FakeWindow.all[0]!;
    expect(w.options).toMatchObject({ width: 560, modal: true, frame: false });
    expect(w.url).toBe('learn://app/index.html?window=sheet');
    expect(w.shown).toBe(false);
    await ready(w);
    expect(w.contentSize).toEqual([560, 200]);
    expect(w.position).toEqual([100 + (1440 - 560) / 2, 50 + SHEET_TOP]);
    expect(w.shown).toBe(true);
    expect(h.payloadFor(contentsOf(w))).toEqual({ kind: 'shortcuts' });
    h.resolve(contentsOf(w), { kind: 'shortcuts' });
    await expect(result).resolves.toEqual({ kind: 'shortcuts' });
    expect(w.destroyed).toBe(true);
  });

  it('answers only an open sheet: anyone else is PERMISSION_DENIED, a result of the wrong kind VALIDATION_FAILED', async () => {
    const h = host();
    const stranger = { id: 999 } as unknown as WebContents;
    expect(() => h.payloadFor(stranger)).toThrow(expect.objectContaining({ code: 'PERMISSION_DENIED' }));
    expect(() => h.resolve(stranger, { kind: 'shortcuts' })).toThrow(expect.objectContaining({ code: 'PERMISSION_DENIED' }));
    const result = h.open(parent(), { kind: 'shortcuts' });
    await tick(); // the window is created once nothing else is showing over this parent
    const w = FakeWindow.all[0]!;
    expect(() => h.resolve(contentsOf(w), { kind: 'duplicate', choice: 'add' })).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }));
    w.close();
    await expect(result).resolves.toBeNull();
    // Closed: its contents are a stranger now.
    expect(() => h.payloadFor(contentsOf(w))).toThrow(expect.objectContaining({ code: 'PERMISSION_DENIED' }));
  });

  it('settles with null when the window closes without an answer, or its page fails to load or crashes', async () => {
    const h = host();
    const closed = h.open(parent(), { kind: 'shortcuts' });
    await tick();
    FakeWindow.all[0]!.close();
    await expect(closed).resolves.toBeNull();

    const failing = createSheetHost({ preload: '/p.cjs', url: () => 'learn://app/fail.html', platform: 'linux' });
    await expect(failing.open(parent(), { kind: 'shortcuts' })).resolves.toBeNull();
    expect(FakeWindow.all[1]!.destroyed).toBe(true);

    const crashed = h.open(parent(), { kind: 'shortcuts' });
    await tick();
    FakeWindow.all[2]!.webContents.emit('render-process-gone');
    await expect(crashed).resolves.toBeNull();
    expect(FakeWindow.all[2]!.destroyed).toBe(true);
  });

  it('shows one sheet at a time per window: a second request waits until the first closes', async () => {
    const h = host();
    const first = h.open(parent(1), { kind: 'shortcuts' });
    const second = h.open(parent(1), { kind: 'shortcuts' });
    const elsewhere = h.open(parent(2), { kind: 'shortcuts' });
    await tick();
    expect(FakeWindow.all).toHaveLength(2); // parent 1's first sheet and parent 2's sheet
    h.resolve(contentsOf(FakeWindow.all[0]!), { kind: 'shortcuts' });
    await expect(first).resolves.toEqual({ kind: 'shortcuts' });
    await tick();
    expect(FakeWindow.all).toHaveLength(3);
    FakeWindow.all[2]!.close();
    await expect(second).resolves.toBeNull();
    FakeWindow.all[1]!.close();
    await expect(elsewhere).resolves.toBeNull();
  });
});
