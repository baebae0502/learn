import { nativeTheme } from 'electron';
import type { Prefs } from '@learn/domain';

/**
 * Native chrome (menus, dialogs, title bar) follows the theme pref. Call before the first window is
 * created and again whenever prefs change. CSS dark mode arrives with M3.
 */
export function applyTheme(theme: Prefs['theme']): void {
  if (nativeTheme.themeSource !== theme) nativeTheme.themeSource = theme;
}

/** 'light' | 'dark' as the window frame should be drawn now. */
export const currentTheme = (): 'light' | 'dark' => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light');

/** Runs `cb` whenever the effective theme changes (prefs or the system appearance). */
export function onThemeChange(cb: () => void): void {
  nativeTheme.on('updated', cb);
}
