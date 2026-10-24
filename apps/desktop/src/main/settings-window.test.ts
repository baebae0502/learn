import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { EventChannels } from '@learn/domain';
import { windowBackground } from '../renderer/src/design/tokens.generated';
import { windowKindOf } from './window-kinds';

/** The page's height changes, as main's ResizeObserver call would report them (one pending call at a time). */
let heightChanged: ((height: number) => void) | null = null;
/** The page's `document.fonts.ready` (already loaded unless a test holds it). */
let fontsLoaded: Promise<boolean> = Promise.resolve(true);

/** A BrowserWindow stand-in: records what the settings window does with it. The page is 412 px tall. */
class FakeWindow extends EventEmitter {
  static all: FakeWindow[] = [];
  static nextId = 500;
  destroyed = false;
  shown = false;
  focused = 0;
  contentSize: [number, number];
  /** Whether the last content-size change asked AppKit to animate it. */
  animated = false;
  position: [number, number] | null = null;
  url = '';
  readonly webContents = {
    id: FakeWindow.nextId++,
    once: vi.fn(),
    isDestroyed: () => this.destroyed,
    send: vi.fn(),
    executeJavaScript: (script: string) =>
      script.includes('ResizeObserver')
        ? new Promise<number>((resolve) => void (heightChanged = resolve))
        : script.includes('document.fonts')
          ? fontsLoaded
          : Promise.resolve(script.includes('getBoundingClientRect') ? 412 : undefined),
  };
  constructor(readonly options: Record<string, unknown>) {
    super();
    this.contentSize = [options['width'] as number, options['height'] as number];
    FakeWindow.all.push(this);
  }
  isDestroyed = () => this.destroyed;
  isFocused = () => this.focused > 0;
  isFullScreen = () => false;
  setContentSize = (w: number, h: number, animate = false) => {
    this.contentSize = [w, h];
    this.animated = animate;
  };
  setPosition = (x: number, y: number) => void (this.position = [x, y]);
  /** The frame: the content plus a 28 pt title bar. */
  getBounds = () => ({ x: this.position?.[0] ?? 0, y: this.position?.[1] ?? 0, width: this.contentSize[0], height: this.contentSize[1] + 28 });
  show = () => void (this.shown = true);
  hide = () => {
    this.shown = false;
    this.events.push('hide');
  };
  isVisible = () => this.shown;
  /** What happened to the window, in order (hide, close). */
  events: string[] = [];
  focus = () => void this.focused++;
  loadURL = async (url: string) => void (this.url = url);
  close = () => {
    this.emit('close', { preventDefault: () => {} });
    this.events.push('torn down');
    this.destroyed = true;
    this.emit('closed');
  };
}

/** The display every frame lands on (tests change it). */
const display = { workArea: { x: 0, y: 25, width: 1920, height: 1150 } };
vi.mock('electron', () => ({ BrowserWindow: FakeWindow, nativeTheme: { shouldUseDarkColors: true }, screen: { getDisplayMatching: () => display } }));
const { SETTINGS_WIDTH, createSettingsWindow, settingsPosition } = await import('./settings-window');

const MAIN = { isDestroyed: () => false, getBounds: () => ({ x: 100, y: 40, width: 1440, height: 900 }) } as unknown as BrowserWindow;
const host = (main: BrowserWindow | null = MAIN) => createSettingsWindow({ preload: '/p.cjs', url: () => 'learn://app/index.html?window=settings', main: () => main });
async function ready(w: FakeWindow): Promise<void> {
  w.emit('ready-to-show');
  for (let i = 0; i < 5 && !w.shown; i++) await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  FakeWindow.all = [];
  fontsLoaded = Promise.resolve(true);
});

describe('the ⌘, settings window (design-spec 6 설정 창)', () => {
  it('is registered as the settings window, so IPC answers it as one (P-5)', () => {
    const w = host().open() as unknown as FakeWindow;
    expect(windowKindOf(w.webContents.id)).toBe('settings');
  });

  it('is one standard window, 600 wide, not resizable, in the theme colour, hidden until sized', () => {
    const settings = host();
    const w = settings.open() as unknown as FakeWindow;
    expect(SETTINGS_WIDTH).toBe(600);
    expect(w.options).toMatchObject({ width: 600, useContentSize: true, show: false, title: '설정', resizable: false, minimizable: false, maximizable: false, fullscreenable: false });
    expect(w.options).not.toHaveProperty('parent'); // its own window, not a sheet
    expect(w.options).not.toHaveProperty('titleBarStyle'); // the standard title bar
    expect(w.options['backgroundColor']).toBe(windowBackground.dark);
    expect(w.options['webPreferences']).toMatchObject({ preload: '/p.cjs', sandbox: true, contextIsolation: true, nodeIntegration: false });
    expect(w.url).toBe('learn://app/index.html?window=settings');
    expect(w.shown).toBe(false);
    expect(settings.current()).toBe(w);
  });

  it('takes its content\'s height, sits centred over the main window, then shows', async () => {
    const w = host().open() as unknown as FakeWindow;
    await ready(w);
    expect(w.contentSize).toEqual([600, 412]);
    expect(w.position).toEqual([100 + (1440 - 600) / 2, 40 + 96]);
    expect(w.shown).toBe(true);
  });

  it('keeps as tall as its content when a message appears in it or goes (not resizable by hand)', async () => {
    const w = host().open() as unknown as FakeWindow;
    await ready(w);
    expect(w.contentSize).toEqual([600, 412]);
    expect(w.animated).toBe(false); // sized while hidden
    heightChanged!(440); // a refused folder's message under the buttons
    await new Promise((r) => setTimeout(r, 0));
    expect(w.contentSize).toEqual([600, 440]);
    expect(w.animated).toBe(true); // the bottom edge slides on macOS (critic T10-n3; ignored elsewhere)
    heightChanged!(412); // the message went (the next try)
    await new Promise((r) => setTimeout(r, 0));
    expect(w.contentSize).toEqual([600, 412]);
  });

  it('sits wholly inside its display\'s work area, also over a main window low on the screen (final review m4)', async () => {
    const wa = { x: 0, y: 25, width: 1024, height: 684 };
    expect(settingsPosition({ x: 0, y: 25, width: 1024, height: 684 }, { width: 600, height: 440 }, wa)).toEqual({ x: 212, y: 121 });
    expect(settingsPosition({ x: 300, y: 400, width: 1024, height: 684 }, { width: 600, height: 440 }, wa)).toEqual({ x: 424, y: 269 }); // up and left
    expect(settingsPosition({ x: -500, y: 25, width: 600, height: 400 }, { width: 600, height: 440 }, wa)).toEqual({ x: 0, y: 121 });
    expect(settingsPosition({ x: 0, y: 25, width: 1024, height: 684 }, { width: 600, height: 900 }, wa)).toEqual({ x: 212, y: 25 }); // taller: its top
    // Through the window: a main window near the bottom of a 1024 × 768 display.
    display.workArea = wa;
    try {
      const low = { isDestroyed: () => false, getBounds: () => ({ x: 0, y: 500, width: 1024, height: 268 }) } as unknown as BrowserWindow;
      const w = host(low).open() as unknown as FakeWindow;
      await ready(w);
      const frame = w.getBounds();
      expect(frame.y + frame.height).toBeLessThanOrEqual(wa.y + wa.height);
      expect(frame.y).toBeGreaterThanOrEqual(wa.y);
    } finally {
      display.workArea = { x: 0, y: 25, width: 1920, height: 1150 };
    }
  });

  it('a second ⌘, while the first is still being measured shows nothing unsized; the sized show follows (final review m4)', async () => {
    const settings = host();
    const w = settings.open() as unknown as FakeWindow;
    expect(settings.open()).toBe(w as unknown as BrowserWindow);
    expect(w.shown).toBe(false);
    expect(w.focused).toBe(0);
    await ready(w);
    expect(w.shown).toBe(true);
    expect(w.contentSize).toEqual([600, 412]);
  });

  it('a second ⌘, brings the same window to the front; after it closed, ⌘, opens a new one', async () => {
    const settings = host(null);
    const first = settings.open() as unknown as FakeWindow;
    await ready(first);
    expect(first.position).toBeNull(); // no main window to sit over: the system places it
    expect(settings.open()).toBe(first as unknown as BrowserWindow);
    expect(FakeWindow.all).toHaveLength(1);
    expect(first.focused).toBe(1);
    first.close();
    expect(settings.current()).toBeNull();
    const second = settings.open() as unknown as FakeWindow;
    expect(second).not.toBe(first);
    expect(FakeWindow.all).toHaveLength(2);
  });

  it('closing takes it off the screen before the page is torn down: no empty body on ⌘W (Mac run 2, critique n2)', async () => {
    const w = host().open() as unknown as FakeWindow;
    await ready(w);
    expect(w.shown).toBe(true);
    w.close();
    expect(w.events).toEqual(['hide', 'torn down']);
  });

  it('gets its own window-state pushes (not key: no rings, neutral selection)', () => {
    const w = host().open() as unknown as FakeWindow;
    w.focused = 1;
    w.emit('focus');
    expect(w.webContents.send).toHaveBeenCalledWith(EventChannels.windowState, { fullscreen: false, focused: true, sheetOpen: false });
  });
});

describe('the settings window and its fonts (T13-m6)', () => {
  it('is shown only once its fonts have loaded', async () => {
    let loaded!: (v: boolean) => void;
    fontsLoaded = new Promise<boolean>((resolve) => void (loaded = resolve));
    const w = host().open() as unknown as FakeWindow;
    await ready(w);
    expect(w.shown).toBe(false);
    loaded(true);
    await ready(w);
    expect(w.shown).toBe(true);
  });
  it('is shown after at most 300 ms when a font never loads', async () => {
    fontsLoaded = new Promise<boolean>(() => {});
    const w = host().open() as unknown as FakeWindow;
    const t0 = Date.now();
    await ready(w);
    expect(w.shown).toBe(false);
    await new Promise((r) => setTimeout(r, 340));
    await ready(w);
    expect(w.shown).toBe(true);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

describe('the settings window measures twice, the second time briefly (re-review minor 1)', () => {
  it('re-measures with its font for at most 500 ms, keeping the first height when the page gives none', async () => {
    const w = host().open() as unknown as FakeWindow;
    const asked: string[] = [];
    let measures = 0;
    const answer = (script: string): Promise<number | undefined> => {
      if (script.includes('ResizeObserver')) return new Promise(() => {}); // following the height afterwards
      if (script.includes('getBoundingClientRect')) {
        asked.push(script);
        measures++;
        return Promise.resolve(measures === 1 ? 412 : 0); // the second answer: nothing (a page gone blank)
      }
      return Promise.resolve(undefined); // the fonts: no answer counts as not ready, and the window still shows
    };
    w.webContents.executeJavaScript = answer;
    await ready(w);
    expect(w.shown).toBe(true);
    expect(asked).toHaveLength(2);
    expect(asked[0]).toContain('> 5000');
    expect(asked[1]).toContain('> 500)');
    expect(w.contentSize).toEqual([SETTINGS_WIDTH, 412]);
  });
});
