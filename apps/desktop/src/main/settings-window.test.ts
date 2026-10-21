import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { EventChannels } from '@learn/domain';
import { windowBackground } from '../renderer/src/design/tokens.generated';

/** The page's height changes, as main's ResizeObserver call would report them (one pending call at a time). */
let heightChanged: ((height: number) => void) | null = null;

/** A BrowserWindow stand-in: records what the settings window does with it. The page is 412 px tall. */
class FakeWindow extends EventEmitter {
  static all: FakeWindow[] = [];
  destroyed = false;
  shown = false;
  focused = 0;
  contentSize: [number, number];
  position: [number, number] | null = null;
  url = '';
  readonly webContents = {
    isDestroyed: () => this.destroyed,
    send: vi.fn(),
    executeJavaScript: (script: string) =>
      script.includes('ResizeObserver')
        ? new Promise<number>((resolve) => void (heightChanged = resolve))
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
  setContentSize = (w: number, h: number) => void (this.contentSize = [w, h]);
  setPosition = (x: number, y: number) => void (this.position = [x, y]);
  show = () => void (this.shown = true);
  focus = () => void this.focused++;
  loadURL = async (url: string) => void (this.url = url);
  close = () => {
    this.destroyed = true;
    this.emit('closed');
  };
}

vi.mock('electron', () => ({ BrowserWindow: FakeWindow, nativeTheme: { shouldUseDarkColors: true } }));
const { SETTINGS_WIDTH, createSettingsWindow } = await import('./settings-window');

const MAIN = { isDestroyed: () => false, getBounds: () => ({ x: 100, y: 40, width: 1440, height: 900 }) } as unknown as BrowserWindow;
const host = (main: BrowserWindow | null = MAIN) => createSettingsWindow({ preload: '/p.cjs', url: () => 'learn://app/index.html?window=settings', main: () => main });
async function ready(w: FakeWindow): Promise<void> {
  w.emit('ready-to-show');
  for (let i = 0; i < 5 && !w.shown; i++) await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  FakeWindow.all = [];
});

describe('the ⌘, settings window (design-spec 6 설정 창)', () => {
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
    heightChanged!(440); // a refused folder's message under the buttons
    await new Promise((r) => setTimeout(r, 0));
    expect(w.contentSize).toEqual([600, 440]);
    heightChanged!(412); // the message went (the next try)
    await new Promise((r) => setTimeout(r, 0));
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

  it('gets its own window-state pushes (not key: no rings, neutral selection)', () => {
    const w = host().open() as unknown as FakeWindow;
    w.focused = 1;
    w.emit('focus');
    expect(w.webContents.send).toHaveBeenCalledWith(EventChannels.windowState, { fullscreen: false, focused: true, sheetOpen: false });
  });
});
