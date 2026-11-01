import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow, WebContents } from 'electron';
import { COMMANDS } from '@learn/domain';
import type { LibraryCheckPayload } from '@learn/domain';
import { windowKindOf } from './window-kinds';

/** A BrowserWindow stand-in: records what the host does with it; tests drive its lifecycle events. */
class FakeWindow extends EventEmitter {
  static all: FakeWindow[] = [];
  static nextId = 1;
  /** The natural height of the fake sheet page. */
  static pageHeight = 200;
  /** Whether the fake page's `document.fonts.ready` resolves in time (fontsReady's answer). */
  static fontsReady = true;
  /** Every script a page was asked to run, in order (the cap a following sheet is told). */
  static scripts: string[] = [];
  /** A following sheet's height watch (followContentHeight) waits here until a test gives the page a new height. */
  static followers: Array<(height: number) => void> = [];
  destroyed = false;
  shown = false;
  contentSize: [number, number];
  position: [number, number] | null = null;
  url = '';
  readonly webContents: EventEmitter & { id: number; executeJavaScript(script: string): Promise<unknown>; isDestroyed(): boolean };
  constructor(readonly options: { width: number; height: number; parent: unknown; modal: boolean; frame: boolean }) {
    super();
    this.contentSize = [options.width, options.height];
    const contents = new EventEmitter() as FakeWindow['webContents'];
    contents.id = FakeWindow.nextId++;
    contents.isDestroyed = () => this.destroyed;
    // contentHeight polls in the page; fontsReady waits for document.fonts; markSized sets a flag.
    contents.executeJavaScript = async (script: string) => {
      FakeWindow.scripts.push(script);
      if (script.includes('ResizeObserver')) return new Promise((resolve) => FakeWindow.followers.push(resolve));
      return script.includes('getBoundingClientRect') ? FakeWindow.pageHeight : script.includes('document.fonts') ? FakeWindow.fontsReady : undefined;
    };
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

const { createSheetHost, SHEET_SHOW_TIMEOUT_MS, SHEET_TOP, UNRESPONSIVE_GRACE_MS, sheetHeightKey, shortcutsDigest } = await import('./sheets');

type FakeParent = BrowserWindow & { focus: ReturnType<typeof vi.fn> };
const parent = (id = 1, height = 900): FakeParent =>
  ({ id, isDestroyed: () => false, focus: vi.fn(), getContentBounds: () => ({ x: 100, y: 50, width: 1440, height }) }) as unknown as FakeParent;
const contentsOf = (w: FakeWindow) => w.webContents as unknown as WebContents;
const tick = () => new Promise((r) => setTimeout(r, 0));
/** Lets the host measure, size and show the newest window. */
async function ready(w: FakeWindow): Promise<void> {
  w.webContents.emit('dom-ready'); // the page's document exists: measuring starts here, alongside the first paint
  w.emit('ready-to-show');
  for (let i = 0; i < 5 && !w.shown; i++) await tick();
}

beforeEach(() => {
  FakeWindow.all = [];
  FakeWindow.pageHeight = 200;
  FakeWindow.fontsReady = true;
  FakeWindow.scripts = [];
  FakeWindow.followers = [];
});
afterEach(() => {
  vi.useRealTimers();
});

describe('sheet host', () => {
  const host = () => createSheetHost({ preload: '/p.cjs', url: () => 'learn://app/index.html?window=sheet', platform: 'linux' });

  it('registers each sheet window as a sheet, so only an open sheet reaches sheet:* (P-5)', async () => {
    void host().open(parent(), { kind: 'shortcuts' });
    await tick();
    expect(windowKindOf(FakeWindow.all[0]!.webContents.id)).toBe('sheet');
  });

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

    // A sheet that never showed (its page failed) closes without telling: shown and closed come in pairs, as main
    // counts the sheets on a window (re-review m7).
    const failed = h.open(p, { kind: 'shortcuts' });
    await tick();
    FakeWindow.all[1]!.webContents.emit('did-fail-load', {}, -2, 'ERR_FAILED', 'learn://app/index.html', true);
    await expect(failed).resolves.toBeNull();
    expect(onSheetShown).toHaveBeenCalledTimes(1);
    expect(onSheetClosed).toHaveBeenCalledTimes(1);
  });

  it('answers only an open sheet: anyone else is PERMISSION_DENIED, a result of the wrong kind VALIDATION_FAILED', async () => {
    const h = host();
    const stranger = { id: 999 } as unknown as WebContents;
    expect(() => h.payloadFor(stranger)).toThrow(expect.objectContaining({ code: 'PERMISSION_DENIED' }));
    expect(() => h.resolve(stranger, { kind: 'shortcuts' })).toThrow(expect.objectContaining({ code: 'PERMISSION_DENIED' }));
    const result = h.open(parent(), { kind: 'shortcuts' });
    await tick(); // the window is created once nothing else is showing over this parent
    const w = FakeWindow.all[0]!;
    expect(() => h.resolve(contentsOf(w), { kind: 'duplicate', choice: 'add', applyToRest: false })).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }));
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
    w.webContents.emit('dom-ready');
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
    w.webContents.emit('dom-ready');
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
    shown.webContents.emit('dom-ready');
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

describe('the ⌘/ sheet keeps the height it measured (spec 8, P-4)', () => {
  const keyed = () =>
    createSheetHost({ preload: '/p.cjs', url: () => 'learn://app/index.html?window=sheet', platform: 'linux', staticKey: (p) => (p.kind === 'shortcuts' ? 'linux|13|regular|d' : null) });
  /** One sheet over `p`, measured and shown, then closed; the scripts its page was asked. */
  async function openOnce(h: ReturnType<typeof createSheetHost>, p = parent()) {
    void h.open(p, { kind: 'shortcuts' });
    await tick();
    const w = FakeWindow.all.at(-1)!;
    const asked: string[] = [];
    const answer = w.webContents.executeJavaScript;
    w.webContents.executeJavaScript = async (script: string) => {
      asked.push(script);
      return answer(script);
    };
    await ready(w);
    const shown = w.shown;
    w.close();
    await tick();
    return { w, asked, shown };
  }

  it('makes the next one at the height the last one measured, checking only that it has rendered', async () => {
    const h = keyed();
    const first = await openOnce(h);
    expect(first.w.options.height).toBe(900 - SHEET_TOP - 16); // measured at full height first
    expect(first.w.contentSize).toEqual([560, 200]);
    FakeWindow.pageHeight = 260; // what a re-measure would see: it must not be asked
    const second = await openOnce(h);
    expect(second.w.options.height).toBe(200);
    expect(second.w.contentSize).toEqual([560, 200]);
    expect(second.shown).toBe(true);
    expect(second.asked.some((s) => s.includes('> 5000'))).toBe(true); // rendered first: never an empty sheet
    expect(second.asked.filter((s) => s.includes('> 500)'))).toEqual([]);
  });

  it('caps a remembered height to the room the parent leaves, as a measured one', async () => {
    const h = keyed();
    FakeWindow.pageHeight = 743;
    await openOnce(h, parent(1, 900));
    const short = await openOnce(h, parent(1, 500));
    expect(short.w.options.height).toBe(500 - SHEET_TOP - 16);
    expect(short.w.contentSize).toEqual([560, 500 - SHEET_TOP - 16]);
  });

  it('remembers no height measured before its fonts were ready, and none for a sheet without a key', async () => {
    const h = keyed();
    FakeWindow.fontsReady = false;
    await openOnce(h);
    FakeWindow.fontsReady = true;
    expect((await openOnce(h)).w.options.height).toBe(900 - SHEET_TOP - 16);
    const plain = createSheetHost({ preload: '/p.cjs', url: () => 'learn://app/index.html?window=sheet', platform: 'linux' }); // no staticKey: always measured
    await openOnce(plain);
    expect((await openOnce(plain)).w.options.height).toBe(900 - SHEET_TOP - 16);
  });

  it('names a height by platform, text size, density and what the sheet lists', () => {
    expect(sheetHeightKey({ platform: 'darwin', fontSize: 13, density: 'regular', digest: 'abc' })).toBe('darwin|13|regular|abc');
    const digest = shortcutsDigest(COMMANDS, 'darwin');
    expect(digest).toMatch(/^[0-9a-f]{16}$/);
    expect(shortcutsDigest(COMMANDS.map((c) => (c.id === 'app.settings' ? { ...c, label: '환경설정…' } : c)), 'darwin')).not.toBe(digest);
    // Commands without a key are not on the sheet: where they sit in the registry changes nothing.
    const keyless = COMMANDS.filter((c) => c.accelerator === undefined && c.key === undefined);
    const listed = COMMANDS.filter((c) => c.accelerator !== undefined || c.key !== undefined);
    expect(shortcutsDigest([...keyless, ...listed], 'darwin')).toBe(digest);
  });
});

describe('a sheet given up with the work that asked it (the duplicate question of a stopped import)', () => {
  const host = () => createSheetHost({ preload: '/p.cjs', url: () => 'learn://app/index.html?window=sheet', platform: 'linux' });

  it('aborting the signal closes the shown sheet window, answers null and gives the focus back', async () => {
    const h = host();
    const p = parent();
    const stop = new AbortController();
    const result = h.open(p, { kind: 'shortcuts' }, stop.signal);
    await tick();
    const w = FakeWindow.all[0]!;
    await ready(w);
    expect(w.shown).toBe(true);
    stop.abort();
    await expect(result).resolves.toBeNull();
    expect(w.destroyed).toBe(true);
    expect(p.focus).toHaveBeenCalledTimes(1);
  });

  it('a signal already aborted opens nothing, and one aborted while the sheet waits behind another never opens it', async () => {
    const h = host();
    const p = parent();
    const gone = new AbortController();
    gone.abort();
    await expect(h.open(p, { kind: 'shortcuts' }, gone.signal)).resolves.toBeNull();
    expect(FakeWindow.all).toHaveLength(0);
    const first = h.open(p, { kind: 'shortcuts' });
    await tick();
    const stop = new AbortController();
    const second = h.open(p, { kind: 'shortcuts' }, stop.signal);
    stop.abort();
    h.resolve(contentsOf(FakeWindow.all[0]!), { kind: 'shortcuts' });
    await first;
    await expect(second).resolves.toBeNull();
    await tick();
    expect(FakeWindow.all).toHaveLength(1);
  });

  it('a sheet answered before the abort is not touched by it', async () => {
    const h = host();
    const stop = new AbortController();
    const result = h.open(parent(), { kind: 'shortcuts' }, stop.signal);
    await tick();
    const w = FakeWindow.all[0]!;
    h.resolve(contentsOf(w), { kind: 'shortcuts' });
    await expect(result).resolves.toEqual({ kind: 'shortcuts' });
    stop.abort();
    expect(w.destroyed).toBe(true);
  });
});

describe('the library check sheet: acts while open (P-17), capped at the parent − 120 and following its content (P-26)', () => {
  const CHECK: LibraryCheckPayload = { kind: 'libraryCheck', mode: 'manual', items: 3, rows: [], homeDir: '/home/u', failed: null };
  const host = () => createSheetHost({ preload: '/p.cjs', url: () => 'learn://app/index.html?window=sheet', platform: 'linux' });

  it('is wide, measured within the parent\'s height − 120, and tells the page that cap before it is sized', async () => {
    FakeWindow.pageHeight = 600;
    void host().open(parent(1, 900), CHECK);
    await tick();
    const w = FakeWindow.all[0]!;
    expect(w.options).toMatchObject({ width: 560, height: 780 });
    await ready(w);
    expect(w.contentSize).toEqual([560, 600]);
    const cap = FakeWindow.scripts.findIndex((s) => s.includes("'--sheet-max-height', '780px'"));
    const sized = FakeWindow.scripts.findIndex((s) => s.includes('dataset.sized'));
    expect(cap).toBeGreaterThan(-1);
    expect(cap).toBeLessThan(sized);
  });

  it('follows its content down and up while open, never past the cap', async () => {
    FakeWindow.pageHeight = 600;
    void host().open(parent(1, 900), CHECK);
    await tick();
    const w = FakeWindow.all[0]!;
    await ready(w);
    await tick();
    FakeWindow.followers.shift()!(420);
    await tick();
    expect(w.contentSize).toEqual([560, 420]);
    await tick();
    FakeWindow.followers.shift()!(1200);
    await tick();
    expect(w.contentSize).toEqual([560, 780]);
  });

  it('the other sheets keep their own cap and do not follow', async () => {
    void host().open(parent(1, 900), { kind: 'shortcuts' });
    await tick();
    const w = FakeWindow.all[0]!;
    expect(w.options.height).toBe(900 - SHEET_TOP - 16);
    await ready(w);
    await tick();
    expect(FakeWindow.followers).toEqual([]);
    expect(FakeWindow.scripts.some((s) => s.includes('--sheet-max-height'))).toBe(false);
  });

  it('runs an action through its kind\'s handler, one at a time; the page reads the newest payload back', async () => {
    const h = host();
    const p = parent();
    const order: string[] = [];
    let release = (): void => {};
    h.onAct('libraryCheck', async (action, sheet) => {
      order.push(`start ${action.act}`);
      expect(sheet.parent).toBe(p);
      expect(sheet.window).toBe(FakeWindow.all[0]);
      expect(sheet.payload.kind).toBe('libraryCheck');
      if (order.length === 1) await new Promise<void>((resolve) => (release = resolve));
      order.push('end');
      return { ...CHECK, items: 3 + order.length };
    });
    void h.open(p, CHECK);
    await tick();
    const w = FakeWindow.all[0]!;
    await ready(w);
    const first = h.act(contentsOf(w), { kind: 'libraryCheck', act: 'cleanStaging' });
    const second = h.act(contentsOf(w), { kind: 'libraryCheck', act: 'revive' });
    await tick();
    expect(order).toEqual(['start cleanStaging']);
    release();
    expect(await first).toMatchObject({ items: 5 });
    expect(await second).toMatchObject({ items: 7 });
    expect(order).toEqual(['start cleanStaging', 'end', 'start revive', 'end']);
    expect(h.payloadFor(contentsOf(w))).toMatchObject({ items: 7 });
  });

  it('refuses an action for another kind, a kind with no handler, and a window that is not an open sheet', async () => {
    const h = host();
    void h.open(parent(1), { kind: 'shortcuts' });
    void h.open(parent(2), CHECK);
    await tick();
    const [keys, check] = FakeWindow.all as [FakeWindow, FakeWindow];
    await expect(h.act(contentsOf(keys), { kind: 'libraryCheck', act: 'cleanStaging' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(h.act(contentsOf(check), { kind: 'libraryCheck', act: 'cleanStaging' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(h.act({ id: 999 } as unknown as WebContents, { kind: 'libraryCheck', act: 'cleanStaging' })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });
});
