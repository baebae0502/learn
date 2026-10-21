import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron';
import { titleBarOverlay, trafficLightPosition, windowBackground } from '../renderer/src/design/tokens.generated';

export interface ChromeOptions {
  platform: NodeJS.Platform;
  theme: 'light' | 'dark';
  vibrancy: boolean;
}

type Chrome = Pick<BrowserWindowConstructorOptions, 'backgroundColor' | 'titleBarStyle' | 'trafficLightPosition' | 'vibrancy' | 'visualEffectState' | 'titleBarOverlay'>;

/** design-spec 2.1. The first frame is the theme colour (or the sidebar material on macOS), never white. */
export function mainWindowChrome(o: ChromeOptions): Chrome {
  if (o.platform === 'darwin') {
    const base: Chrome = { titleBarStyle: 'hidden', trafficLightPosition: { ...trafficLightPosition } };
    // Vibrancy only shows through a clear window background; the page keeps its sidebar and body transparent.
    return o.vibrancy ? { ...base, vibrancy: 'sidebar', visualEffectState: 'followWindow', backgroundColor: '#00000000' } : { ...base, backgroundColor: windowBackground[o.theme] };
  }
  return { titleBarStyle: 'hidden', titleBarOverlay: { ...titleBarOverlay[o.theme] }, backgroundColor: windowBackground[o.theme] };
}

/** Keeps the native frame in step with nativeTheme (overlay colours and background; macOS vibrancy follows by itself). */
export function applyChromeTheme(win: Pick<BrowserWindow, 'setBackgroundColor' | 'setTitleBarOverlay'>, o: ChromeOptions): void {
  if (o.platform === 'darwin') {
    if (!o.vibrancy) win.setBackgroundColor(windowBackground[o.theme]);
    return;
  }
  win.setBackgroundColor(windowBackground[o.theme]);
  win.setTitleBarOverlay({ ...titleBarOverlay[o.theme] });
}

export const shouldUseVibrancy = (platform: NodeJS.Platform, env: NodeJS.ProcessEnv): boolean => platform === 'darwin' && env['LEARN_VIBRANCY'] !== '0';
