import type { BrowserWindow } from 'electron';
import { VIDEO_TIMING } from '@learn/domain';

/** What the stage controller needs of a window: its full screen, the two events, and a way to re-push its state. */
export interface StagePort {
  isFullScreen(): boolean;
  setFullScreen(on: boolean): void;
  onEnter(fn: () => void): void; // 'enter-full-screen'
  onLeave(fn: () => void): void; // 'leave-full-screen'
  changed(): void; // re-push the window state (resyncWindowState)
  /** Keeps whether the window's full screen is the stage's: the window comes back in its display mode after a quit. */
  remember?(full: boolean): void;
}

export interface StageController {
  request(action: 'toggle' | 'exit'): void; // ui:stage
  toggleWindow(): void; // the 전체 화면 menu item (⌃⌘F)
  /** The window is on screen: a full screen it comes back in arrives by now, or within one settle (an animation). */
  shown(): void;
  stage(): boolean;
  pending(): boolean;
  dispose(): void;
}

type Timers = { set(fn: () => void, ms: number): unknown; clear(h: unknown): void };
const DEFAULT_TIMERS: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

/**
 * The main window's full screen and the video stage on it (spec 6.6). Every change of the window's full screen goes
 * through here, one at a time: a request only changes what is wished, and the window is moved one step towards it once the
 * change in flight has landed. A new change started before the last one's event (macOS animates into its own Space) was
 * what hung the old HTML full screen (spec 9.1). The stage is on only while the window is full screen.
 */
export function createStageController(port: StagePort, opts: { settleMs?: number; timers?: Timers; restoredForStage?: boolean } = {}): StageController {
  const settleMs = opts.settleMs ?? VIDEO_TIMING.stageSettleMs;
  const timers = opts.timers ?? DEFAULT_TIMERS;
  const want = { full: port.isFullScreen(), stage: false };
  let stage = false;
  /** What the setting says now: read at launch, and cleared there once. */
  let remembered = opts.restoredForStage === true;
  /**
   * The last run quit on the stage: the full screen this window comes back in is the stage's, without a stage now, and is left once.
   * Ends with that leave, with the user's first full-screen wish, or a settle after the window shows.
   */
  let leaveRestored = remembered;
  let restoreWait: unknown = null;
  const remember = (on: boolean): void => {
    if (on === remembered) return;
    remembered = on;
    port.remember?.(on);
  };
  const stopRestoring = (): void => {
    leaveRestored = false;
    if (restoreWait !== null) timers.clear(restoreWait);
    restoreWait = null;
  };
  let pending: 'enter' | 'leave' | null = null;
  /** The stage put the window in full screen, so the window leaves with it; a window that was full screen before stays. */
  let fullForStage = false;
  let settle: unknown = null;
  /** The change in flight is a second try: if it does not land either, the window is believed. */
  let retried = false;
  /** Set while a settle that ran out asks again: the change it starts is that second try. */
  let retrying: 'enter' | 'leave' | null = null;
  let disposed = false;

  const stopWaiting = () => {
    if (settle !== null) timers.clear(settle);
    settle = null;
    pending = null;
    retried = false;
  };

  function drive(): void {
    if (disposed || pending !== null) return;
    if (!want.stage && stage) {
      stage = false;
      port.changed();
      drive();
      return;
    }
    const full = port.isFullScreen();
    if (want.full !== full) {
      const change = want.full ? 'enter' : 'leave';
      pending = change;
      retried = retrying === change;
      // Armed before the call: a window that changes and reports at once (Linux) ends the wait inside it.
      settle = timers.set(settled, settleMs);
      port.setFullScreen(want.full);
      return;
    }
    if (want.stage && !stage && full) {
      stage = true;
      if (fullForStage) remember(true);
      port.changed();
    }
  }

  /** The change's event never came: ask once more; after a second silence, take the window as it is. */
  function settled(): void {
    settle = null;
    if (disposed) return;
    const missed = pending;
    const second = retried;
    pending = null;
    retried = false;
    if (!second) {
      retrying = missed;
      drive();
      retrying = null;
      return;
    }
    want.full = port.isFullScreen();
    // No full screen came: the stage that waited for it goes too, or the next toggle would only take that wish back.
    if (!want.full) {
      want.stage = false;
      fullForStage = false;
    }
    drive();
  }

  const heard = (change: 'enter' | 'leave') => {
    if (disposed) return;
    const awaited = pending === change;
    stopWaiting();
    if (change === 'leave') remember(false);
    if (!awaited && change === 'enter' && leaveRestored) {
      stopRestoring();
      want.full = false;
      drive();
      return;
    }
    if (!awaited) {
      // A change nobody here asked for: the traffic light, the Linux menu's own full-screen role, the system.
      if (change === 'leave') {
        want.full = false;
        want.stage = false;
        fullForStage = false;
        if (stage) {
          stage = false;
          port.changed();
        }
      } else {
        want.full = true;
      }
    }
    drive();
  };
  port.onEnter(() => heard('enter'));
  port.onLeave(() => heard('leave'));
  if (remembered) remember(false);
  if (leaveRestored && want.full) {
    stopRestoring();
    want.full = false;
    drive();
  }

  /** Between changes the window is the truth (one may have changed without a word); while one is in flight, the wish is. */
  const settledWish = () => {
    if (pending === null) want.full = port.isFullScreen();
  };

  return {
    request(action) {
      if (disposed) return;
      stopRestoring();
      settledWish();
      if (action === 'toggle' && !want.stage) {
        want.stage = true;
        // The window is a window, or is on its way to being one: the full screen is the stage's.
        fullForStage = !want.full;
        want.full = true;
      } else if (action === 'toggle' || want.stage || stage) {
        want.stage = false;
        if (fullForStage) want.full = false;
      } else {
        return;
      }
      drive();
    },
    toggleWindow() {
      if (disposed) return;
      stopRestoring();
      settledWish();
      want.full = !want.full;
      if (!want.full) {
        want.stage = false;
        fullForStage = false;
      }
      drive();
    },
    shown() {
      if (disposed || !leaveRestored || restoreWait !== null) return;
      restoreWait = timers.set(stopRestoring, settleMs);
    },
    stage: () => stage,
    pending: () => pending !== null,
    dispose() {
      disposed = true;
      stopWaiting();
      stopRestoring();
    },
  };
}

const controllers = new WeakMap<BrowserWindow, StageController>();

/**
 * Gives a main window its stage controller (index.ts openMainWindow); it goes with the window. `changed` re-pushes the
 * window's state (resyncWindowState). `restoredForStage` and `remember`: the setting that says the last run quit on the stage.
 */
export function attachStageController(
  win: BrowserWindow,
  changed: () => void,
  opts: { settleMs?: number; timers?: Timers; restoredForStage?: boolean; remember?(full: boolean): void } = {},
): StageController {
  const { remember, ...options } = opts;
  const controller = createStageController(
    {
      isFullScreen: () => !win.isDestroyed() && win.isFullScreen(),
      // On the next turn, never from inside a full-screen event: a window that changes and reports at once (Linux) would
      // have the window's other listeners — the frame keeper, the state push — hear the second change before the first.
      setFullScreen: (on) =>
        void setImmediate(() => {
          if (!win.isDestroyed() && controllers.get(win) === controller) win.setFullScreen(on);
        }),
      // Ahead of the window's other listeners, so the state push that follows the event already carries the stage.
      onEnter: (fn) => void win.prependListener('enter-full-screen', fn),
      onLeave: (fn) => void win.prependListener('leave-full-screen', fn),
      changed: () => {
        if (!win.isDestroyed()) changed();
      },
      ...(remember ? { remember } : {}),
    },
    options,
  );
  controllers.set(win, controller);
  win.once('show', () => controller.shown());
  win.once('closed', () => {
    controller.dispose();
    controllers.delete(win);
  });
  return controller;
}

/** The window's stage controller; none for a window that is not a main window. */
export const stageControllerOf = (win: BrowserWindow): StageController | undefined => controllers.get(win);

/** The stage of a main window, for windowStateOf: false for a window without a controller. */
export function stageOf(win: BrowserWindow): boolean {
  return controllers.get(win)?.stage() ?? false;
}
