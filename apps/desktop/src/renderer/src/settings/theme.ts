import { useLayoutEffect, useRef } from 'react';
import type { Prefs } from '@learn/domain';

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
  startViewTransition?: ((update: () => void) => unknown) | undefined;
}

/**
 * <html data-theme> (tokens.css: color-scheme light or dark, so every light-dark() token follows). A change the viewer
 * sees is a crossfade of the whole page, a View Transition as long as --duration-base (base.css), so the web content
 * lands with the native title bar and vibrancy, which AppKit repaints a few frames after Chromium (T13M-m6), instead of
 * ahead of them in stages. Returns whether anything changed.
 */
export function applyShade(root: ShadeTarget, shade: Shade, opts: ShadeOptions): boolean {
  if (root.dataset['theme'] === shade) return false;
  const swap = () => {
    root.dataset['theme'] = shade;
  };
  if (opts.animate && !opts.still && opts.startViewTransition) opts.startViewTransition(swap);
  else swap();
  return true;
}

/**
 * Keeps <html data-theme> on `theme` (the main window: the pref; the settings window: the tile just picked, ahead of
 * the pref's round trip), and on the system appearance while it is 시스템 설정. Until `theme` is known the page follows
 * prefers-color-scheme, which main keeps on the same pref (nativeTheme.themeSource): the first value changes nothing
 * visible and is not animated.
 */
export function useApplyTheme(theme: Prefs['theme'] | undefined): void {
  const shown = useRef(false);
  useLayoutEffect(() => {
    if (!theme) return;
    const root = document.documentElement;
    const system = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      applyShade(root, resolveTheme(theme, system.matches), {
        animate: shown.current,
        still: root.dataset['deterministic'] === '1' || matchMedia('(prefers-reduced-motion: reduce)').matches,
        startViewTransition: typeof document.startViewTransition === 'function' ? (update) => document.startViewTransition(update) : undefined,
      });
      shown.current = true;
    };
    apply();
    if (theme !== 'system') return;
    system.addEventListener('change', apply);
    return () => system.removeEventListener('change', apply);
  }, [theme]);
}

/**
 * The tile the settings window shows: the one just picked until the saved pref agrees (or the write failed), else the
 * saved pref. Its ring moves with the click, not after the round trip (T13M-m6).
 */
export const shownTheme = (picked: Prefs['theme'] | null, saved: Prefs['theme']): Prefs['theme'] => picked ?? saved;
/** The pick is settled once the saved pref has come round to it. */
export const pickSettled = (picked: Prefs['theme'] | null, saved: Prefs['theme'] | undefined): boolean => picked !== null && picked === saved;
