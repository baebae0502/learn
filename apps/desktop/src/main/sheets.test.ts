import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow, WebContents } from 'electron';

/** A BrowserWindow stand-in: records what the host does with it; tests drive its lifecycle events. */
class FakeWindow extends EventEmitter {
  static all: FakeWindow[] = [];
  static nextId = 1;
  /** The natural height of the fake sheet page. */
  static pageHeight = 200;
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
    contents.executeJavaScript = async (script: string) => (script.includes('getBoundingClientRect') ? FakeWindow.pageHeight : undefined);
    this.webContents = contents;
    FakeWindow.all.push(this);
  }
  isDestroyed = () => this.destroyed;
  isVisible = () => this.shown && !this.destroyed;
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

const { createSheetHost, SHEET_SHOW_TIMEOUT_MS, SHEET_TOP, UNRESPONSIVE_GRACE_MS } = await import('./sheets');

type FakeParent = BrowserWindow & { focus: ReturnType<typeof vi.fn> };
const parent = (id = 1, height = 900): FakeParent =>
  ({ id, isDestroyed: () => false, focus: vi.fn(), getContentBounds: () => ({ x: 100, y: 50, width: 1440, height }) }) as unknown as FakeParent;
const contentsOf = (w: FakeWindow) => w.webContents as unknown as WebContents;
const tick = () => new Promise((r) => setTimeout(r, 0));
/** Lets the host measure, size and show the newest window. */
async function ready(w: FakeWindow): Promise<void> {
  w.emit('ready-to-show');
  for (let i = 0; i < 5 && !w.shown; i++) await tick();
}

beforeEach(() => {
  FakeWindow.all = [];
  FakeWindow.pageHeight = 200;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('sheet host', () => {
  const host = () => createSheetHost({ preload: '/p.cjs', url: () => 'learn://app/index.html?window=sheet', platform: 'linux' });

  it('opens a hidden modal child, sizes it to its content, places it under the toolbar, then shows it', async () => {
    const h = host();
    const p = parent();
    const result = h.open(p, { kind: 'shortcuts' });
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
    expect(p.focus).not.toHaveBeenCalled();
    h.resolve(contentsOf(w), { kind: 'shortcuts' });
    await expect(result).resolves.toEqual({ kind: 'shortcuts' });
    expect(w.destroyed).toBe(true);
    expect(p.focus).toHaveBeenCalledTimes(1); // keyboard focus goes back to the window the sheet hung over
  });

  // Re-review minor 1 (Task 13 fix round 1): measured, fonts loaded, then measured again for at most 500 ms, keeping the
  // first height when the second gives none, so the show watchdog (10 s) never wins against two 5 s measurements.
  it('re-measures with its font for at most 500 ms, keeping the first height when the page gives none', async () => {
    const h = host();
    void h.open(parent(), { kind: 'shortcuts' });
    await tick();
    const w = FakeWindow.all[0]!;
    const asked: string[] = [];
    w.webContents.executeJavaScript = async (script: string) => {
      if (!script.includes('getBoundingClientRect')) return true;
      asked.push(script);
      return asked.length === 1 ? 300 : 0;
    };
    await ready(w);
    expect(w.shown).toBe(true);
    expect(asked).toHaveLength(2);
    expect(asked[0]).toContain('> 5000');
    expect(asked[1]).toContain('> 500)');
    expect(w.contentSize).toEqual([560, 300]);
  });

  // Critic T12-m1: the ⌘/ sheet (743 tall) in the default window of a 1440 × 900 Mac with the Dock (about 806).
  it('clamps the height to the room the platform leaves: 16 above and below a centred macOS sheet, 60 + 16 elsewhere', async () => {
    const shown = async (platform: NodeJS.Platform, parentHeight: number) => {
      FakeWindow.all = [];
      const h = createSheetHost({ preload: '/p.cjs', url: () => 'learn://app/index.html?window=sheet', platform });
      void h.open(parent(1, parentHeight), { kind: 'shortcuts' });
      await tick();
      const w = FakeWindow.all[0]!;
      await ready(w);
      return { height: w.contentSize[1], measuredAt: w.options.height, position: w.position };
    };
    FakeWindow.pageHeight = 743;
    // macOS centres the sheet over its parent (no setSheetOffset): the room is the parent's height less 16 at each end.
    expect(await shown('darwin', 806)).toEqual({ height: 743, measuredAt: 806 - 32, position: null });
    expect(await shown('darwin', 760)).toEqual({ height: 760 - 32, measuredAt: 760 - 32, position: null });
    // Linux / Windows hang it 60 down (8 under the 52 px toolbar) and keep 16 below.
    expect(await shown('linux', 806)).toEqual({ height: 806 - SHEET_TOP - 16, measuredAt: 806 - SHEET_TOP - 16, position: [100 + (1440 - 560) / 2, 50 + SHEET_TOP] });
    expect((await shown('win32', 900)).height).toBe(743);
  });

  it('tells main when the sheet shows and once its window has closed (sheetOpen; macOS sends no focus event on close)', async () => {
    const onSheetClosed = vi.fn();
    const shownAt: boolean[] = [];
    const onSheetShown = vi.fn(() => shownAt.push(FakeWindow.all[0]!.shown));
    const h = createSheetHost({ preload: '/p.cjs', url: () => 'learn://app/index.html?window=sheet', platform: 'darwin', onSheetShown, onSheetClosed });
    const p = parent();
    const result = h.open(p, { kind: 'shortcuts' });
    await tick();
    const w = FakeWindow.all[0]!;
    await ready(w);
    // Reported just before the sheet shows (the parent stays main: its chrome must not dim while the sheet takes key).
    expect(onSheetShown).toHaveBeenCalledExactlyOnceWith(p);
    expect(shownAt).toEqual([false]);
    expect(onSheetClosed).not.toHaveBeenCalled();
    h.resolve(contentsOf(w), { kind: 'shortcuts' });
    await expect(result).resolves.toEqual({ kind: 'shortcuts' });
    expect(onSheetClosed).toHaveBeenCalledExactlyOnceWith(p);
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
    const p = parent();
    const closed = h.open(p, { kind: 'shortcuts' });
    await tick();
    FakeWindow.all[0]!.close();
    await expect(closed).resolves.toBeNull();
    expect(p.focus).toHaveBeenCalledTimes(1);

    const failing = createSheetHost({ preload: '/p.cjs', url: () => 'learn://app/fail.html', platform: 'linux' });
    await expect(failing.open(parent(), { kind: 'shortcuts' })).resolves.toBeNull();
    expect(FakeWindow.all[1]!.destroyed).toBe(true);

    const crashed = h.open(parent(), { kind: 'shortcuts' });
    await tick();
    FakeWindow.all[2]!.webContents.emit('render-process-gone');
    await expect(crashed).resolves.toBeNull();
    expect(FakeWindow.all[2]!.destroyed).toBe(true);

    // did-fail-load counts for the page itself, not for a subframe.
    const failedLoad = h.open(parent(), { kind: 'shortcuts' });
    await tick();
    FakeWindow.all[3]!.webContents.emit('did-fail-load', {}, -2, 'ERR_FAILED', 'learn://app/x', false);
    expect(FakeWindow.all[3]!.destroyed).toBe(false);
    FakeWindow.all[3]!.webContents.emit('did-fail-load', {}, -2, 'ERR_FAILED', 'learn://app/index.html', true);
    await expect(failedLoad).resolves.toBeNull();
  });

  it('ends a sheet that stays unresponsive for 5 s; one that recovers within the grace period stays', async () => {
    vi.useFakeTimers();
    const h = host();
    let settled: unknown = 'pending';
    void h.open(parent(), { kind: 'shortcuts' }).then((r) => (settled = r));
    await vi.advanceTimersByTimeAsync(0);
    const w = FakeWindow.all[0]!;
    w.emit('ready-to-show');
    await vi.advanceTimersByTimeAsync(0);
    expect(UNRESPONSIVE_GRACE_MS).toBe(5_000);

    w.emit('unresponsive'); // a long task, then it answers again
    await vi.advanceTimersByTimeAsync(UNRESPONSIVE_GRACE_MS - 1);
    w.emit('responsive');
    await vi.advanceTimersByTimeAsync(UNRESPONSIVE_GRACE_MS * 2);
    expect(settled).toBe('pending');
    expect(w.destroyed).toBe(false);

    w.emit('unresponsive'); // hung for good
    await vi.advanceTimersByTimeAsync(UNRESPONSIVE_GRACE_MS - 1);
    expect(settled).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBeNull();
    expect(w.destroyed).toBe(true);
  });

  it('a sheet shown unsized after a failed measurement is not given up by the show watchdog', async () => {
    vi.useFakeTimers();
    const h = host();
    let settled: unknown = 'pending';
    void h.open(parent(), { kind: 'shortcuts' }).then((r) => (settled = r));
    await vi.advanceTimersByTimeAsync(0);
    const w = FakeWindow.all[0]!;
    w.webContents.executeJavaScript = async () => {
      throw new Error('measure failed');
    };
    w.emit('ready-to-show');
    await vi.advanceTimersByTimeAsync(0);
    expect(w.shown).toBe(true);
    w.shown = false; // even if the window were hidden again later, the watchdog was cleared when it was shown
    await vi.advanceTimersByTimeAsync(SHEET_SHOW_TIMEOUT_MS * 2);
    expect(settled).toBe('pending');
    expect(w.destroyed).toBe(false);
  });

  it('gives up on a sheet that is still not shown 10 s after loading began, so the parent is never left blocked', async () => {
    vi.useFakeTimers();
    const h = host();
    const p = parent();
    let settled: unknown = 'pending';
    void h.open(p, { kind: 'shortcuts' }).then((r) => (settled = r));
    await vi.advanceTimersByTimeAsync(0);
    const w = FakeWindow.all[0]!; // ready-to-show never comes
    expect(SHEET_SHOW_TIMEOUT_MS).toBe(10_000);
    await vi.advanceTimersByTimeAsync(SHEET_SHOW_TIMEOUT_MS - 1);
    expect(settled).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBeNull();
    expect(w.destroyed).toBe(true);
    expect(p.focus).toHaveBeenCalledTimes(1);

    // A sheet that came up in time stays open as long as the user needs it.
    let answer: unknown = 'pending';
    void h.open(p, { kind: 'shortcuts' }).then((r) => (answer = r));
    await vi.advanceTimersByTimeAsync(0);
    const shown = FakeWindow.all[1]!;
    shown.emit('ready-to-show');
    await vi.advanceTimersByTimeAsync(0);
    expect(shown.shown).toBe(true);
    await vi.advanceTimersByTimeAsync(SHEET_SHOW_TIMEOUT_MS * 3);
    expect(answer).toBe('pending');
    expect(shown.destroyed).toBe(false);
    h.resolve(contentsOf(shown), { kind: 'shortcuts' });
    await vi.advanceTimersByTimeAsync(0);
    expect(answer).toEqual({ kind: 'shortcuts' });
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
