import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { VIDEO_TIMING } from '@learn/domain';
import { attachStageController, createStageController, stageControllerOf, stageOf, type StageController, type StagePort } from './video-stage';

/**
 * A window as the controller sees it. Nothing happens by itself: setFullScreen is only recorded, and the test moves the
 * window in or out of full screen and sends its event (entered, left) when it wants — AppKit's animation, or none.
 */
function fakeWindow(opts: { full?: boolean } = {}) {
  let full = opts.full ?? false;
  const enter: Array<() => void> = [];
  const leave: Array<() => void> = [];
  /** What the controller did, in order: each setFullScreen, and the stage each changed() reported. */
  const log: string[] = [];
  let controller: StageController | null = null;
  const port: StagePort = {
    isFullScreen: () => full,
    setFullScreen: (on) => void log.push(`set ${on}`),
    onEnter: (fn) => void enter.push(fn),
    onLeave: (fn) => void leave.push(fn),
    changed: () => void log.push(`stage ${controller?.stage()}`),
  };
  return {
    port,
    log,
    /** The setFullScreen calls, oldest first. */
    calls: () => log.filter((l) => l.startsWith('set ')).map((l) => l === 'set true'),
    bind: (c: StageController) => (controller = c),
    isFullScreen: () => full,
    /** The window is full screen now and says so ('enter-full-screen'). */
    entered: () => {
      full = true;
      for (const fn of enter) fn();
    },
    /** The window is a window again and says so ('leave-full-screen'). */
    left: () => {
      full = false;
      for (const fn of leave) fn();
    },
    /** The window changed without a word (an event Electron never sent). */
    setQuietly: (on: boolean) => {
      full = on;
    },
  };
}
const make = (opts: { full?: boolean; settleMs?: number } = {}) => {
  const w = fakeWindow(opts);
  const c = createStageController(w.port, opts.settleMs === undefined ? {} : { settleMs: opts.settleMs });
  w.bind(c);
  return { w, c };
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('the stage controller: one full-screen change at a time, the last wish wins', () => {
  it('from a window: a toggle asks for full screen once; the stage is off before the enter and on after it', () => {
    const { w, c } = make();
    c.request('toggle');
    expect(w.calls()).toEqual([true]);
    expect(c.stage()).toBe(false);
    expect(c.pending()).toBe(true);
    w.entered();
    expect(c.stage()).toBe(true);
    expect(c.pending()).toBe(false);
    expect(w.log).toEqual(['set true', 'stage true']);
  });

  it('toggled again: the stage goes off first, then the window leaves full screen', () => {
    const { w, c } = make();
    c.request('toggle');
    w.entered();
    w.log.length = 0;
    c.request('toggle');
    expect(w.log).toEqual(['stage false', 'set false']);
    expect(c.pending()).toBe(true);
    w.left();
    expect(c.pending()).toBe(false);
    expect(w.isFullScreen()).toBe(false);
    expect(w.log).toEqual(['stage false', 'set false']); // the awaited leave changes nothing more
  });

  it('already full screen (⌃⌘F): a toggle turns the stage on without touching the window, and off leaves the window full screen', () => {
    const { w, c } = make({ full: true });
    c.request('toggle');
    expect(c.stage()).toBe(true);
    expect(c.pending()).toBe(false);
    c.request('toggle');
    expect(c.stage()).toBe(false);
    expect(w.isFullScreen()).toBe(true);
    expect(w.calls()).toEqual([]);
    expect(w.log).toEqual(['stage true', 'stage false']);
  });

  it('four more toggles while the enter is awaited (five in all): once it lands the stage is on in full screen, after one setFullScreen', () => {
    const { w, c } = make();
    for (let i = 0; i < 5; i++) c.request('toggle');
    expect(c.stage()).toBe(false);
    expect(w.calls()).toEqual([true]);
    w.entered();
    expect(c.stage() && w.isFullScreen()).toBe(true);
    expect(c.pending()).toBe(false);
    expect(w.calls()).toEqual([true]);
  });

  it('six toggles: both end off, and setFullScreen was called with true, then false', () => {
    const { w, c } = make();
    for (let i = 0; i < 6; i++) c.request('toggle');
    w.entered(); // the change in flight lands; the last wish is a window
    expect(c.stage()).toBe(false);
    expect(w.calls()).toEqual([true, false]);
    w.left();
    expect(c.stage()).toBe(false);
    expect(w.isFullScreen()).toBe(false);
    expect(c.pending()).toBe(false);
    expect(w.calls()).toEqual([true, false]);
    expect(w.log).not.toContain('stage true'); // the stage never showed on the way
  });

  it('in the stage, five quick toggles while the leave is in flight: back to the window the stage came from', () => {
    const { w, c } = make();
    c.request('toggle');
    w.entered();
    for (let i = 0; i < 5; i++) c.request('toggle'); // off, on, off, on, off
    expect(c.stage()).toBe(false);
    w.left();
    expect(c.stage()).toBe(false);
    expect(w.isFullScreen()).toBe(false);
    expect(c.pending()).toBe(false);
    expect(w.calls()).toEqual([true, false]); // the full screen was the stage's: no third change
  });

  it('a leave nobody asked for (the green traffic light, or ⌃⌘F on Linux) ends the stage', () => {
    const { w, c } = make();
    c.request('toggle');
    w.entered();
    expect(c.stage()).toBe(true);
    w.left();
    expect(c.stage()).toBe(false);
    expect(w.log).toEqual(['set true', 'stage true', 'stage false']);
    // Nothing of the old wish is left: the next toggle starts from a window.
    c.request('toggle');
    expect(w.calls()).toEqual([true, true]);
  });

  it('an enter nobody asked for (⌃⌘F on Linux) is the window full screen: a toggle then only turns the stage on and off', () => {
    const { w, c } = make();
    w.entered();
    expect(c.stage()).toBe(false);
    c.request('toggle');
    expect(c.stage()).toBe(true);
    c.request('toggle');
    expect(c.stage()).toBe(false);
    expect(w.isFullScreen()).toBe(true);
    expect(w.calls()).toEqual([]);
  });

  it('no event: two seconds on the same change is asked again; still none: the window is believed', () => {
    const { w, c } = make();
    c.request('toggle');
    vi.advanceTimersByTime(VIDEO_TIMING.stageSettleMs - 1);
    expect(w.calls()).toEqual([true]);
    vi.advanceTimersByTime(1);
    expect(w.calls()).toEqual([true, true]);
    expect(c.pending()).toBe(true);
    vi.advanceTimersByTime(VIDEO_TIMING.stageSettleMs);
    expect(c.pending()).toBe(false);
    expect(c.stage()).toBe(false); // the window stayed a window
    vi.advanceTimersByTime(10 * VIDEO_TIMING.stageSettleMs);
    expect(w.calls()).toEqual([true, true]); // no third try
    // The stage wish went with the full screen that never came: the next toggle asks again at once.
    c.request('toggle');
    expect(w.calls()).toEqual([true, true, true]);
  });

  it('no event, but the window did go full screen: the stage comes on at the settle, without asking again', () => {
    const { w, c } = make();
    c.request('toggle');
    w.setQuietly(true);
    vi.advanceTimersByTime(VIDEO_TIMING.stageSettleMs);
    expect(c.stage()).toBe(true);
    expect(c.pending()).toBe(false);
    expect(w.calls()).toEqual([true]);
  });

  it('the event that came cancels the settle: nothing is asked again later', () => {
    const { w, c } = make({ settleMs: 500 });
    c.request('toggle');
    vi.advanceTimersByTime(499);
    w.entered();
    vi.advanceTimersByTime(5000);
    expect(w.calls()).toEqual([true]);
    expect(c.stage()).toBe(true);
  });

  it('a change reported from inside setFullScreen (Linux) leaves no settle behind to cut the next change\'s wait short', () => {
    const w = fakeWindow();
    let atOnce = true;
    const c = createStageController(
      {
        ...w.port,
        setFullScreen: (on) => {
          w.port.setFullScreen(on);
          if (atOnce && on) w.entered();
        },
      },
      {},
    );
    w.bind(c);
    c.request('toggle'); // changes and reports at once
    expect(c.stage()).toBe(true);
    atOnce = false;
    vi.advanceTimersByTime(VIDEO_TIMING.stageSettleMs / 2);
    c.request('toggle'); // this leave takes its time
    vi.advanceTimersByTime(VIDEO_TIMING.stageSettleMs / 2);
    expect(w.calls()).toEqual([true, false]); // not asked again on the first change's clock
    vi.advanceTimersByTime(VIDEO_TIMING.stageSettleMs / 2);
    expect(w.calls()).toEqual([true, false, false]); // on its own
  });

  it('the settle can be shorter, on timers of its own', () => {
    const due: Array<{ fn: () => void; ms: number }> = [];
    const w = fakeWindow();
    const c = createStageController(w.port, { settleMs: 300, timers: { set: (fn, ms) => due.push({ fn, ms }), clear: () => {} } });
    w.bind(c);
    c.request('toggle');
    expect(due.map((d) => d.ms)).toEqual([300]);
    due[0]!.fn();
    expect(w.calls()).toEqual([true, true]);
  });

  it('exit does nothing while the stage is off — in a window or in a full-screen one', () => {
    const { w, c } = make();
    c.request('exit');
    const full = make({ full: true });
    full.c.request('exit');
    expect(w.log).toEqual([]);
    expect(full.w.log).toEqual([]);
    expect(c.pending()).toBe(false);
    // On the same path, a stage that is on does end.
    c.request('toggle');
    w.entered();
    c.request('exit');
    expect(w.log).toEqual(['set true', 'stage true', 'stage false', 'set false']);
  });

  it('exit while the stage is about to come on: it never shows, and the window goes back', () => {
    const { w, c } = make();
    c.request('toggle');
    c.request('exit');
    c.request('exit'); // a second one changes nothing
    w.entered();
    expect(c.stage()).toBe(false);
    expect(w.calls()).toEqual([true, false]);
    w.left();
    expect(c.pending()).toBe(false);
    expect(w.log).not.toContain('stage true');
  });

  it('exit from a stage in a full-screen window (⌃⌘F before): the window stays full screen', () => {
    const { w, c } = make({ full: true });
    c.request('toggle');
    c.request('exit');
    expect(c.stage()).toBe(false);
    expect(w.calls()).toEqual([]);
  });

  it('the 전체 화면 menu item: from a window it is full screen without the stage; in the stage it ends both, the stage first', () => {
    const { w, c } = make();
    c.toggleWindow();
    expect(w.calls()).toEqual([true]);
    w.entered();
    expect(c.stage()).toBe(false);
    c.request('toggle'); // the stage in a window that was full screen already
    expect(c.stage()).toBe(true);
    w.log.length = 0;
    c.toggleWindow();
    expect(w.log).toEqual(['stage false', 'set false']);
    w.left();
    expect(c.pending()).toBe(false);
    // The stage's own full screen: the menu item ends it too.
    c.request('toggle');
    w.entered();
    c.toggleWindow();
    w.left();
    expect(c.stage()).toBe(false);
    expect(w.isFullScreen()).toBe(false);
  });

  it('a stage toggle while the menu item leaves full screen: the full screen is the stage\'s now, and leaves with it', () => {
    const { w, c } = make({ full: true });
    c.toggleWindow(); // the leave is in flight
    c.request('toggle'); // the stage asks for full screen again
    w.left();
    expect(w.calls()).toEqual([false, true]);
    w.entered();
    expect(c.stage()).toBe(true);
    c.request('toggle');
    w.left();
    expect(w.calls()).toEqual([false, true, false]);
    expect(w.isFullScreen()).toBe(false);
  });

  it('a leave that comes while an enter is awaited is the user\'s: the stage wish ends with it', () => {
    const { w, c } = make();
    c.request('toggle');
    w.left();
    expect(c.pending()).toBe(false);
    expect(c.stage()).toBe(false);
    vi.advanceTimersByTime(10 * VIDEO_TIMING.stageSettleMs);
    expect(w.calls()).toEqual([true]); // the settle was called off with the wait
  });

  it('dispose: no more changes, no timer left', () => {
    const { w, c } = make();
    c.request('toggle');
    c.dispose();
    vi.advanceTimersByTime(10 * VIDEO_TIMING.stageSettleMs);
    w.entered();
    c.request('toggle');
    c.toggleWindow();
    expect(w.calls()).toEqual([true]);
    expect(c.stage()).toBe(false);
  });
});

let nextId = 1;
/** A BrowserWindow stand-in whose full screen changes at once and says so, as on Linux. */
class FakeBrowserWindow extends EventEmitter {
  readonly id = nextId++;
  fullscreen = false;
  destroyed = false;
  readonly asked: boolean[] = [];
  isFullScreen = () => this.fullscreen;
  isDestroyed = () => this.destroyed;
  setFullScreen = (on: boolean) => {
    this.asked.push(on);
    if (on === this.fullscreen) return;
    this.fullscreen = on;
    this.emit(on ? 'enter-full-screen' : 'leave-full-screen');
  };
}
const bw = (w: FakeBrowserWindow) => w as unknown as BrowserWindow;

describe('a main window\'s stage (stageOf, attachStageController)', () => {
  it('a window without a controller is never on the stage (the settings window)', () => {
    expect(stageOf(bw(new FakeBrowserWindow()))).toBe(false);
    expect(stageControllerOf(bw(new FakeBrowserWindow()))).toBeUndefined();
  });

  it("the stage is on before the window's other full-screen listeners hear the enter, and off before they hear the leave", () => {
    const w = new FakeBrowserWindow();
    const heard: string[] = [];
    // Registered first, as trackWindowState and the frame keeper are (window.ts).
    w.on('enter-full-screen', () => heard.push(`enter ${stageOf(bw(w))}`));
    w.on('leave-full-screen', () => heard.push(`leave ${stageOf(bw(w))}`));
    const changed = vi.fn();
    const c = attachStageController(bw(w), changed);
    expect(stageControllerOf(bw(w))).toBe(c);
    c.request('toggle');
    expect(w.asked).toEqual([]); // not from inside the caller: on the next turn
    vi.advanceTimersByTime(0);
    expect(heard).toEqual(['enter true']);
    expect(stageOf(bw(w))).toBe(true);
    expect(changed).toHaveBeenCalledTimes(1);
    w.setFullScreen(false); // the user leaves
    expect(heard).toEqual(['enter true', 'leave false']);
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('a change the stage asks for from inside a full-screen event waits for the event to reach every listener', () => {
    const w = new FakeBrowserWindow();
    const heard: string[] = [];
    w.on('enter-full-screen', () => heard.push('enter'));
    w.on('leave-full-screen', () => heard.push('leave'));
    const c = attachStageController(bw(w), () => {});
    c.request('toggle');
    c.request('toggle'); // the last wish is a window: asked once the enter has landed
    vi.advanceTimersToNextTimer();
    expect(heard).toEqual(['enter']);
    expect(w.asked).toEqual([true]);
    vi.advanceTimersToNextTimer();
    expect(heard).toEqual(['enter', 'leave']);
    expect(w.asked).toEqual([true, false]);
  });

  it('a closed window lets go of its controller: no stage, no change asked after it', () => {
    const w = new FakeBrowserWindow();
    const c = attachStageController(bw(w), () => {});
    c.request('toggle');
    w.destroyed = true;
    w.emit('closed');
    vi.advanceTimersByTime(10 * VIDEO_TIMING.stageSettleMs);
    expect(w.asked).toEqual([]);
    expect(stageOf(bw(w))).toBe(false);
    expect(stageControllerOf(bw(w))).toBeUndefined();
  });
});
