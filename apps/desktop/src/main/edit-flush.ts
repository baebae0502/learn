// Closing the main window or quitting while 정보 편집 is open (spec §5.3): main asks the page first. Valid changes are
// saved and the close or quit goes on; nothing changed lets it go; marked fields keep the window and call the quit off,
// the form saying why. A page that cannot answer in time never holds either.

/** The page's answer (renderer inspector/editGuard.ts flushEdits). */
export type FlushResult = 'saved' | 'clean' | 'invalid';
/** What the gate logs: the page's answer, or 'timeout' when none came in time (a slow save stays visible in the log; it lets go like 'clean'). */
export type FlushOutcome = FlushResult | 'timeout';
/** Run in the page's main world, where the renderer installs the hook while an editor is open (no IPC channel). */
export const FLUSH_SCRIPT = 'window.__learnFlushEdits ? window.__learnFlushEdits() : "clean"';
/** Longer than a save takes; a hung, crashed or still-loading page past it counts as having nothing to save. */
export const FLUSH_TIMEOUT_MS = 3000;
/** The quit's own window close comes at once; a pass still set this long after app.quit() belongs to a quit that did not happen. */
export const QUIT_PASS_MS = 1000;

/** The main window as far as the gate needs it (a BrowserWindow fits). */
export interface FlushWindow {
  isDestroyed(): boolean;
  close(): void;
  webContents: { executeJavaScript(code: string, userGesture?: boolean): Promise<unknown> };
}
export interface PreventableEvent {
  preventDefault(): void;
}
type Action = 'close' | 'quit';

export interface FlushGateDeps {
  /** The main window now, or null (not open yet, or closed). */
  mainWindow(): FlushWindow | null;
  /** app.quit(): the quit again, once the page let go. */
  quit(): void;
  timeoutMs?: number;
  /** Every decision, for the E2E log (index.ts). */
  record?(entry: { action: Action; result: FlushOutcome }): void;
  /** How long a quit's own close may come after app.quit() before the pass is dropped (a quit another listener called off). */
  passMs?: number;
}

/** The page's answer; 'timeout' when none comes in time, 'clean' when the call fails or it answers anything else. */
export function askToFlush(win: FlushWindow, timeoutMs = FLUSH_TIMEOUT_MS): Promise<FlushOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: FlushOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => finish('timeout'), timeoutMs);
    // A call that throws at once (a destroyed webContents) must not leave the promise pending.
    try {
      win.webContents.executeJavaScript(FLUSH_SCRIPT, true).then(
        (answer) => finish(answer === 'saved' || answer === 'invalid' ? answer : 'clean'),
        () => finish('clean'),
      );
    } catch {
      finish('clean');
    }
  });
}

export interface FlushGate {
  /** The main window's 'close' (⌘W, its close button, win.close(), and each window a quit closes). */
  onClose(win: FlushWindow, event: PreventableEvent): void;
  /** The app's 'before-quit' (⌘Q, the Dock, app.quit(), a relaunch). */
  onBeforeQuit(event: PreventableEvent): void;
}

export function createFlushGate(deps: FlushGateDeps): FlushGate {
  /** The attempt the page answered for: its repeat passes, and for a quit the window's close inside it too. */
  let passing: Action | null = null;
  /** An answer is awaited, for this action ('quit' wins: ⌘Q while a ⌘W waits quits). */
  let asking: Action | null = null;

  const ask = (win: FlushWindow, action: Action) => {
    if (asking !== null) {
      if (action === 'quit') asking = 'quit';
      return;
    }
    asking = action;
    void askToFlush(win, deps.timeoutMs).then((result) => {
      const wanted = asking ?? action;
      asking = null;
      deps.record?.({ action: wanted, result });
      if (result === 'invalid') return; // the window stays, the quit is off: the form shows why
      passing = wanted;
      if (wanted === 'quit') {
        deps.quit();
        // The window's own close comes inside the quit; if none does (another listener called the quit off, or no main
        // window is left) the pass must not outlive the attempt and wave a later ⌘W or ⌘Q through unasked.
        const drop = setTimeout(() => {
          if (passing === 'quit') passing = null;
        }, deps.passMs ?? QUIT_PASS_MS);
        drop.unref?.();
      } else if (!win.isDestroyed()) win.close();
      else passing = null;
    });
  };

  return {
    onClose(win, event) {
      if (passing !== null) {
        passing = null; // the attempt that was asked for
        return;
      }
      if (win.isDestroyed()) return;
      event.preventDefault();
      ask(win, 'close');
    },
    onBeforeQuit(event) {
      if (passing === 'quit') return; // our own repeat
      const win = deps.mainWindow();
      if (!win || win.isDestroyed()) return;
      event.preventDefault();
      ask(win, 'quit');
    },
  };
}
