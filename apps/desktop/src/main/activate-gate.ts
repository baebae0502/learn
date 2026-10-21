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

export function createActivateGate(opts: { openWindow(): void; windowCount(): number }): ActivateGate {
  let ready = false;
  return {
    markReady() {
      ready = true;
    },
    onActivate() {
      if (ready && opts.windowCount() === 0) opts.openWindow();
    },
  };
}
