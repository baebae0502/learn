/** The part of a BrowserWindow the release needs (unit-testable without Electron). */
export interface KeyWindow {
  isDestroyed(): boolean;
  isFocused(): boolean;
  once(event: 'focus', listener: () => void): unknown;
  removeListener(event: 'focus', listener: () => void): unknown;
}

/**
 * A sheet has closed: its parent stays main (windowState.sheetOpen) until it is key again, so its chrome never dims in
 * between (Task 8 polish, re-review minor 1). `release` runs once: at once when the parent is already key, on its
 * next 'focus', or after `settleMs` at the latest — macOS can make the parent key again without a 'focus' event, and
 * the window state is re-read then (a parent that is still not key, because another app took the focus, then dims).
 * Nothing runs for a destroyed parent. Returns a cancel function (a new sheet shows before the release).
 */
export function releaseWhenKey(parent: KeyWindow, release: () => void, settleMs = 250): () => void {
  let done = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    done = true;
    clearTimeout(timer);
    parent.removeListener('focus', finish);
  };
  function finish() {
    if (done) return;
    stop();
    if (!parent.isDestroyed()) release();
  }
  if (parent.isDestroyed()) return () => {};
  if (parent.isFocused()) {
    finish();
    return () => {};
  }
  parent.once('focus', finish);
  timer = setTimeout(finish, settleMs);
  return () => {
    if (!done) stop();
  };
}
