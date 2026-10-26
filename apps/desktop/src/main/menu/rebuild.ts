export const REBUILD_DELAY_MS = 100;

export interface MenuRebuilder {
  /** Something the menu bar lists changed: rebuild once the notices stop, and no menu is open. */
  request(): void;
  /** A menu-bar menu opened or closed (`nativeMenu { open }`). */
  menuOpenChanged(open: boolean): void;
  /** Drops a pending rebuild (the app is going away). */
  cancel(): void;
}

/**
 * Debounces rebuilds of the application menu. A rebuild never happens while a native menu is open (it would pull the
 * open menu out from under the pointer), and one that waited for a menu to close still waits the delay once more: AppKit
 * sends the clicked item's action after the menu has closed, so the item must still be there when it does.
 */
export function createMenuRebuilder(rebuild: () => void, delayMs: number = REBUILD_DELAY_MS): MenuRebuilder {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let open = false;
  let waiting = false;
  const arm = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(fire, delayMs);
  };
  function fire(): void {
    timer = null;
    if (open) {
      waiting = true;
      return;
    }
    waiting = false;
    rebuild();
  }
  return {
    request: arm,
    menuOpenChanged(next) {
      open = next;
      if (!next && waiting) {
        waiting = false;
        arm();
      }
    },
    cancel() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      waiting = false;
    },
  };
}
