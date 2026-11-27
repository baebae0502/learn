/**
 * macOS `activate` (dock click with no window) can fire after `ready` but before the library, the learn://
 * protocol handler and IPC are registered; a window opened then would load a renderer whose first calls have no
 * handler. The gate ignores activate until `markReady()`; the ready path opens the first window itself.
 * No Electron import: unit-tested.
 */
export interface ActivateGate {
  /** Protocol + IPC registration has finished. */
  markReady(): void;
  /** The `activate` handler: opens a window only when ready and none is open. */
  onActivate(): void;
}

/**
 * Electron frees a window's state name a moment after the window is destroyed, so a dock click right after the main
 * window closed can find "main" still taken (Mac all run 45985418322, settings.spec R-22). The gate tries again this
 * often, this many times in all (about a second), then gives up with a log line instead of throwing from a timer.
 */
export const ACTIVATE_RETRY_MS = 25;
export const ACTIVATE_RETRY_ATTEMPTS = 40;

const isNameInUse = (e: unknown): boolean => e instanceof Error && /Window name .* is already in use/.test(e.message);

export function createActivateGate(opts: { openWindow(): void; windowCount(): number; warn?: (line: string) => void }): ActivateGate {
  let ready = false;
  let waiting = false;
  const attempt = (n: number): void => {
    try {
      opts.openWindow();
    } catch (e) {
      if (!isNameInUse(e)) throw e;
      if (n >= ACTIVATE_RETRY_ATTEMPTS) {
        opts.warn?.(`[activate] the main window's name stayed taken after ${n} tries; no window opened`);
        return;
      }
      waiting = true;
      setTimeout(() => {
        waiting = false;
        if (opts.windowCount() === 0) attempt(n + 1);
      }, ACTIVATE_RETRY_MS);
    }
  };
  return {
    markReady() {
      ready = true;
    },
    onActivate() {
      if (ready && !waiting && opts.windowCount() === 0) attempt(1);
    },
  };
}
