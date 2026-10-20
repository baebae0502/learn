import { nativeTheme } from 'electron';
import type { Prefs } from '@learn/domain';

/**
 * Native chrome (menus, dialogs, title bar) follows the theme pref. Call before the first window is
 * created and again whenever prefs change. CSS dark mode arrives with M3.
 */
export function applyTheme(theme: Prefs['theme']): void {
  if (nativeTheme.themeSource !== theme) nativeTheme.themeSource = theme;
}
