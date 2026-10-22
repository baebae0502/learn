import { useLayoutEffect, useRef } from 'react';
import type { Prefs } from '@learn/domain';
import { api } from '../api';
import { currentPlatform } from '../ui/platform';

export type Shade = 'light' | 'dark';

/** The theme the page is drawn in: the pref, or the system appearance for 시스템 설정. */
export const resolveTheme = (theme: Prefs['theme'], systemDark: boolean): Shade => (theme === 'system' ? (systemDark ? 'dark' : 'light') : theme);

interface ShadeTarget {
  dataset: DOMStringMap;
}
interface ShadeOptions {
  /** A change the viewer sees (not the first paint): crossfaded unless `still`. */
  animate: boolean;
  /** Reduced motion, or a deterministic page (visual tests): the change is instant. */
  still: boolean;
  startViewTransition?: ((update: () => void) => { updateCallbackDone: Promise<unknown> }) | undefined;
  /**
   * The page shows `shade` now: called once, when a crossfade has made its update (updateCallbackDone), after the next
   * frame for an instant change, at once when nothing changed. Main lets the native theme follow it (T13R4-m1).
   */
  onShown?: () => void;
  /** After the next frame (an instant change has been drawn); a hidden page, which draws no frames, still answers. */
  afterFrame?: (fn: () => void) => void;
}

/** Calls `fn` after the next frame is drawn, or after 100 ms where no frames come (a hidden or occluded window). */
export function afterNextFrame(fn: () => void): void {
  let done = false;
  const once = () => {
    if (done) return;
    done = true;
    fn();
  };
  requestAnimationFrame(() => setTimeout(once, 0));
  setTimeout(once, 100);
}

/**
 * <html data-theme> (tokens.css: color-scheme light or dark, so every light-dark() token follows). A change the viewer
 * sees is a crossfade of the whole page, a View Transition as long as --duration-base (base.css), so the web content
 * lands with the native title bar and vibrancy, which AppKit repaints a few frames after Chromium (T13M-m6), instead of
 * ahead of them in stages; and main applies the native theme only once the page says it shows the change (`onShown`,
 * T13R4-m1). Returns whether anything changed.
 */
export function applyShade(root: ShadeTarget, shade: Shade, opts: ShadeOptions): boolean {
  const shown = opts.onShown ?? (() => {});
  if (root.dataset['theme'] === shade) {
    shown();
    return false;
  }
  const swap = () => {
    root.dataset['theme'] = shade;
  };
  if (opts.animate && !opts.still && opts.startViewTransition) {
    try {
      opts.startViewTransition(swap).updateCallbackDone.then(shown, shown);
      return true;
    } catch {
      // No transition after all: the instant change below.
    }
  }
  swap();
  (opts.afterFrame ?? afterNextFrame)(shown);
  return true;
}

/**
 * Whether a theme change crossfades on this platform: macOS only. The crossfade exists to cover AppKit's late title bar
 * and vibrancy (T13M-m6). Elsewhere nothing native lags: the window-controls overlay follows the page at once, and a
 * View Transition's own frames come so late under software compositing (0.4–0.7 s at 2× on Xvfb) that the overlay
 * would lead the content however it is told (T13R4-m1).
 */
export const crossfades = (platform: string): boolean => platform === 'darwin';

/**
 * Keeps <html data-theme> on `theme` (the main window: the pref; the settings window: the tile just picked, ahead of
 * the pref's round trip), and on the system appearance while it is 시스템 설정. Until `theme` is known the page follows
 * prefers-color-scheme, which main keeps on the same pref (nativeTheme.themeSource): the first value changes nothing
 * visible and is not animated. Each value is reported once it is on screen (ui.themeShown): main's native theme follows
 * a change a page made (T13R4-m1).
 *
 * 시스템 설정 is resolved from prefers-color-scheme, which main moves only once it applies the native theme: the
 * appearance that change brings, like a change of the system's own appearance, is applied at once (no crossfade).
 */
export function useApplyTheme(theme: Prefs['theme'] | undefined): void {
  const shown = useRef(false);
  useLayoutEffect(() => {
    if (!theme) return;
    const root = document.documentElement;
    const system = matchMedia('(prefers-color-scheme: dark)');
    const apply = (animate: boolean) => {
      const shade = resolveTheme(theme, system.matches);
      applyShade(root, shade, {
        animate,
        still: root.dataset['deterministic'] === '1' || matchMedia('(prefers-reduced-motion: reduce)').matches || !crossfades(currentPlatform()),
        startViewTransition: typeof document.startViewTransition === 'function' ? (update) => document.startViewTransition(update) : undefined,
        onShown: () => void api().ui.themeShown({ shade }).catch(() => {}),
      });
      shown.current = true;
    };
    apply(shown.current);
    if (theme !== 'system') return;
    const follow = () => apply(false);
    system.addEventListener('change', follow);
    return () => system.removeEventListener('change', follow);
  }, [theme]);
}

/**
 * The tile the settings window shows: the one just picked until the saved pref agrees (or the write failed), else the
 * saved pref. Its ring moves with the click, not after the round trip (T13M-m6).
 */
export const shownTheme = (picked: Prefs['theme'] | null, saved: Prefs['theme']): Prefs['theme'] => picked ?? saved;
/** The pick is settled once the saved pref has come round to it. */
export const pickSettled = (picked: Prefs['theme'] | null, saved: Prefs['theme'] | undefined): boolean => picked !== null && picked === saved;
