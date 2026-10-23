import { useLayoutEffect } from 'react';
import type { Prefs } from '@learn/domain';
import { api } from '../api';

export type Shade = 'light' | 'dark';

/** The theme the page is drawn in: the pref, or the system appearance for 시스템 설정. */
export const resolveTheme = (theme: Prefs['theme'], systemDark: boolean): Shade => (theme === 'system' ? (systemDark ? 'dark' : 'light') : theme);

interface ShadeTarget {
  dataset: DOMStringMap;
}
interface ShadeOptions {
  /**
   * The page shows `shade` now: called once, after the next frame (the change has been drawn), at once when nothing
   * changed. Main lets the native theme follow it (T13R4-m1).
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
 * <html data-theme> (tokens.css: color-scheme light or dark, so every light-dark() token follows). The change is instant
 * on every platform: a crossfade's first frame came after AppKit had turned the native title bar and vibrancy (Mac run 2,
 * 183–283 ms of dark native over a light page), so the page swaps at once and main applies the native theme once the
 * page says it shows the change (`onShown`, T13R4-m1): it follows within 1–2 frames. Returns whether anything changed.
 */
export function applyShade(root: ShadeTarget, shade: Shade, opts: ShadeOptions = {}): boolean {
  const shown = opts.onShown ?? (() => {});
  if (root.dataset['theme'] === shade) {
    shown();
    return false;
  }
  root.dataset['theme'] = shade;
  (opts.afterFrame ?? afterNextFrame)(shown);
  return true;
}


/**
 * Keeps <html data-theme> on `theme` (the main window: the pref; the settings window: the tile just picked, ahead of
 * the pref's round trip), and on the system appearance while it is 시스템 설정. Until `theme` is known the page follows
 * prefers-color-scheme, which main keeps on the same pref (nativeTheme.themeSource): the first value changes nothing
 * visible. Each value is reported once it is on screen (ui.themeShown): main's native theme follows a change a page
 * made (T13R4-m1).
 *
 * 시스템 설정 is resolved from prefers-color-scheme, which main moves only once it applies the native theme: the
 * appearance that change brings, like a change of the system's own appearance, is applied at once.
 */
export function useApplyTheme(theme: Prefs['theme'] | undefined): void {
  useLayoutEffect(() => {
    if (!theme) return;
    const root = document.documentElement;
    const system = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const shade = resolveTheme(theme, system.matches);
      applyShade(root, shade, { onShown: () => void api().ui.themeShown({ shade }).catch(() => {}) });
    };
    apply();
    if (theme !== 'system') return;
    const follow = () => apply();
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
