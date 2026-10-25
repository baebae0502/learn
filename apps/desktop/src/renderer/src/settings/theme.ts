import { useLayoutEffect } from 'react';
import type { Prefs } from '@learn/domain';
import { api } from '../api';
import { useLearnEvent } from '../events';

export type Shade = 'light' | 'dark';

/** The theme the page is drawn in: the pref, or the system appearance for 시스템 설정. */
export const resolveTheme = (theme: Prefs['theme'], systemDark: boolean): Shade => (theme === 'system' ? (systemDark ? 'dark' : 'light') : theme);

interface ShadeTarget {
  dataset: DOMStringMap;
}
interface ShadeOptions {
  /**
   * The page has `shade`: called once, right after the swap (or at once when nothing changed). Main lets the native
   * theme follow it (T13R4-m1).
   */
  onShown?: () => void;
}

/**
 * <html data-theme> (tokens.css: color-scheme light or dark, so every light-dark() token follows). The change is instant
 * on every platform: a crossfade's first frame came after AppKit had turned the native title bar and vibrancy (Mac run 2,
 * 183–283 ms of dark native over a light page). The page reports it right after the synchronous swap, with no frame
 * wait: the report crosses to main and main's native call while this page paints, and AppKit repaints its parts a frame
 * or two after it is told (Mac run 3, critique m4: waiting for the next frame and a timer put the native parts 3 frames,
 * 50 ms, behind the page). Main still applies nothing native before the report, and falls back after THEME_FOLLOW_MS.
 * Returns whether anything changed.
 */
export function applyShade(root: ShadeTarget, shade: Shade, opts: ShadeOptions = {}): boolean {
  const shown = opts.onShown ?? (() => {});
  if (root.dataset['theme'] === shade) {
    shown();
    return false;
  }
  root.dataset['theme'] = shade;
  shown();
  return true;
}

/** <html data-theme> on `theme` now, reported to main right after (ui.themeShown). */
function showTheme(theme: Prefs['theme']): void {
  const shade = resolveTheme(theme, matchMedia('(prefers-color-scheme: dark)').matches);
  applyShade(document.documentElement, shade, { onShown: () => void api().ui.themeShown({ shade }).catch(() => {}) });
}

/**
 * Keeps <html data-theme> on the saved theme pref, in the main and the settings window alike, and on the system
 * appearance while it is 시스템 설정. Until `theme` is known the page follows prefers-color-scheme, which main keeps on the
 * same pref (nativeTheme.themeSource): the first value changes nothing visible.
 *
 * A change made in a page reaches every page in one message: main saves the pref, then sends prefsChanged to all
 * windows in one loop. Each page swaps in that message's own task, before the re-render the message also causes, and
 * reports at once, so the main and the settings page change in the same frame and the native parts follow both (the
 * clicked page no longer leads by its round trip). The settings window's tile shows the pick on the click; its theme
 * waits for this message like the main window's.
 *
 * 시스템 설정 is resolved from prefers-color-scheme, which main moves only once it applies the native theme: the
 * appearance that change brings, like a change of the system's own appearance, is applied at once.
 */
export function useApplyTheme(theme: Prefs['theme'] | undefined): void {
  useLearnEvent('prefsChanged', ({ prefs }) => showTheme(prefs.theme));
  useLayoutEffect(() => {
    if (!theme) return;
    showTheme(theme);
    if (theme !== 'system') return;
    const system = matchMedia('(prefers-color-scheme: dark)');
    const follow = () => showTheme(theme);
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
