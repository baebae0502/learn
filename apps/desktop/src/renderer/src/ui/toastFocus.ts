/** What the toast region's focus return needs from the page (injected so the logic runs without a DOM). */
export interface ToastFocusEnv {
  active(): Element | null;
  inRegion(el: Element | null): boolean;
  connected(el: Element): boolean;
  focus(el: Element): void;
  /** Nowhere to go back to: the library's main content, as F6 would. */
  fallback(): void;
  /** The focus left the region without a blur event: tell the region's own focus hold that it ended. */
  release(to: Element | null): void;
  /** `el` is the toast or inside it. */
  holds(toast: Element, el: Element | null): boolean;
  /** Another toast of the region than this one, if one is left. */
  another(toast: Element): Element | null;
}

/**
 * Where the focus was before it entered the toast region, the way a dialog remembers it. A job toast that turns into its
 * result takes the focused button (취소) with it: the browser fires no blur, the region keeps its hold, and the result
 * would never close by itself. `settled` (called once the result is in place) puts the focus back and ends the hold.
 */
export function createToastFocusReturn(env: ToastFocusEnv) {
  let inside = false;
  let origin: Element | null = null;
  return {
    /** The focus came into the region (a focus event on it) from `from`. */
    entered(from: Element | null): void {
      if (inside && env.inRegion(from)) return; // moving between the region's own controls
      inside = true;
      origin = from;
    },
    /** A blur out of the region to `to`. */
    left(to: Element | null): void {
      if (env.inRegion(to)) return;
      inside = false;
      origin = null;
    },
    /** The toast's content was replaced: if the focus was inside and is now nowhere in the region, give it back. */
    settled(): void {
      if (!inside || env.inRegion(env.active())) return;
      const to = origin;
      inside = false;
      origin = null;
      if (to && env.connected(to)) env.focus(to);
      else env.fallback();
      env.release(env.active());
    },
    /**
     * A toast is about to go and the focus is on it: a removed button sends no blur, so the focus would fall to the page
     * and the region would keep its hold. It moves to the next toast if one is left (the region keeps the focus), else
     * back to where it came from, else the main content.
     */
    closing(toast: Element): void {
      if (!env.holds(toast, env.active())) return;
      const next = env.another(toast);
      if (next) {
        env.focus(next);
        return;
      }
      const to = origin;
      inside = false;
      origin = null;
      if (to && env.connected(to) && !env.inRegion(to)) env.focus(to);
      else env.fallback();
      env.release(env.active());
    },
  };
}

const regionEl = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-pane="toasts"]');

/** The page's toast focus return; wired to the region wrapper in toasts.tsx. */
export const toastFocusReturn = (fallback: () => void) =>
  createToastFocusReturn({
    active: () => document.activeElement,
    inRegion: (el) => el !== null && (regionEl()?.contains(el) ?? false),
    connected: (el) => el.isConnected,
    focus: (el) => (el as HTMLElement).focus(),
    fallback,
    holds: (toast, el) => el !== null && toast.contains(el),
    another: (toast) => [...(regionEl()?.querySelectorAll('.toast') ?? [])].find((el) => el !== toast && !el.contains(toast)) ?? null,
    release: (to) => {
      // RAC's useToastRegion ends its hold on a focusout of the region that goes elsewhere; the removed button sent none.
      regionEl()?.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: to }));
    },
  });
