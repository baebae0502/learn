// Closing the main window or quitting while 정보 편집 is open (spec §5.3): main asks the page first. Valid changes are
// saved and the close or quit goes on; nothing changed lets it go; marked fields keep the window and call the quit off,
// the form saying why. A page that cannot answer in time never holds either.

/** The page's answer (renderer inspector/editGuard.ts flushEdits). */
export type FlushResult = 'saved' | 'clean' | 'invalid';
/** Run in the page's main world, where the renderer installs the hook while an editor is open (no IPC channel). */
export const FLUSH_SCRIPT = 'window.__learnFlushEdits ? window.__learnFlushEdits() : "clean"';
/** Longer than a save takes; a hung, crashed or still-loading page past it counts as having nothing to save. */
export const FLUSH_TIMEOUT_MS = 3000;

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
  record?(entry: { action: Action; result: FlushResult }): void;
}

/** The page's answer; 'clean' when none comes in time, the call fails, or it answers anything else. */
export function askToFlush(win: FlushWindow, timeoutMs = FLUSH_TIMEOUT_MS): Promise<FlushResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: FlushResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => finish('clean'), timeoutMs);
    win.webContents.executeJavaScript(FLUSH_SCRIPT, true).then(
      (answer) => finish(answer === 'saved' || answer === 'invalid' ? answer : 'clean'),
      () => finish('clean'),
    );
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
      if (wanted === 'quit') deps.quit();
      else if (!win.isDestroyed()) win.close();
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
