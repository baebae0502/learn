import { describe, expect, it, vi } from 'vitest';
import { titleBarOverlay, trafficLightPosition, windowBackground } from '../renderer/src/design/tokens.generated';
import { applyChromeTheme, mainWindowChrome, shouldUseVibrancy } from './window-options';

describe('main window chrome (design-spec 2.1)', () => {
  it('macOS: hidden title bar, traffic lights at the token position, sidebar vibrancy over a clear background', () => {
    expect(mainWindowChrome({ platform: 'darwin', theme: 'dark', vibrancy: true })).toEqual({
      titleBarStyle: 'hidden',
      trafficLightPosition: { ...trafficLightPosition },
      vibrancy: 'sidebar',
      visualEffectState: 'followWindow',
      backgroundColor: '#00000000',
    });
  });
  it('macOS without vibrancy: the opaque window colour of the theme', () => {
    expect(mainWindowChrome({ platform: 'darwin', theme: 'dark', vibrancy: false })).toEqual({ titleBarStyle: 'hidden', trafficLightPosition: { ...trafficLightPosition }, backgroundColor: windowBackground.dark });
  });
  it('Linux/Windows: window controls overlay in the 52 px bar, token colours, themed background', () => {
    expect(mainWindowChrome({ platform: 'linux', theme: 'light', vibrancy: false })).toEqual({ titleBarStyle: 'hidden', titleBarOverlay: { ...titleBarOverlay.light }, backgroundColor: windowBackground.light });
    expect(titleBarOverlay.light.height).toBe(52);
  });
  it('re-applies the theme to a live window', () => {
    const win = { setBackgroundColor: vi.fn(), setTitleBarOverlay: vi.fn() };
    applyChromeTheme(win, { platform: 'linux', theme: 'dark', vibrancy: false });
    expect(win.setBackgroundColor).toHaveBeenCalledWith(windowBackground.dark);
    expect(win.setTitleBarOverlay).toHaveBeenCalledWith(titleBarOverlay.dark);
    const mac = { setBackgroundColor: vi.fn(), setTitleBarOverlay: vi.fn() };
    applyChromeTheme(mac, { platform: 'darwin', theme: 'dark', vibrancy: true });
    expect(mac.setBackgroundColor).not.toHaveBeenCalled(); // the vibrancy material follows nativeTheme itself
    expect(mac.setTitleBarOverlay).not.toHaveBeenCalled();
  });
  it('vibrancy is macOS only and can be turned off for comparisons', () => {
    expect(shouldUseVibrancy('darwin', {})).toBe(true);
    expect(shouldUseVibrancy('darwin', { LEARN_VIBRANCY: '0' })).toBe(false);
    expect(shouldUseVibrancy('linux', {})).toBe(false);
  });
});
