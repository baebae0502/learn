/**
 * Where the focus goes back to after a search. A button that was pressed is disabled while the search shows (it shows after 300 ms), which
 * drops its focus; when that search ends the focus returns to it. A search that ends before it ever showed disabled nothing, so the
 * button is forgotten with it: a later search that nobody pressed for must not pull the focus anywhere.
 */
export function createFocusRestore(): { hold(selector: string | null): void; step(busy: boolean, searching: boolean): string | null } {
  let held: string | null = null;
  let armed: string | null = null;
  return {
    hold: (selector) => void (held = selector),
    /** Called whenever the run state changes; returns the selector to focus when a search that showed has just ended. */
    step(busy, searching) {
      if (searching) {
        if (held !== null) [armed, held] = [held, null];
        return null;
      }
      if (busy) return null; // started, not yet shown
      held = null;
      const back = armed;
      armed = null;
      return back;
    },
  };
}
