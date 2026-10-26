import type { AboutPanelOptionsOptions } from 'electron';
import { mainStrings } from './strings';

/** Bundled third-party code and fonts (README "런타임 의존성 라이선스"). macOS shows `credits` in the panel. */
const CREDITS = mainStrings.about.credits.join('\n');

export function aboutPanelOptions(version: string, electronVersion: string): AboutPanelOptionsOptions {
  return { applicationName: 'Learn', applicationVersion: version, version: `Electron ${electronVersion}`, copyright: '© 2026 Learn', credits: CREDITS };
}
