export type WindowKind = 'main' | 'settings' | 'sheet';

export interface WindowUrlOptions {
  platform: NodeJS.Platform;
  /** LEARN_DETERMINISTIC=1: the renderer disables motion and the caret for screenshots. */
  deterministic: boolean;
  /** macOS sidebar vibrancy is on: the main window's page keeps its sidebar transparent. */
  vibrancy: boolean;
  /** LEARN_DEMO_OVERLAY=1 in an unpackaged build: key and pointer overlay for demo recordings (main and settings). */
  demo: boolean;
}

/** The renderer reads these flags synchronously before its first paint (ui/platform.ts). */
export function windowUrl(base: string, kind: WindowKind, o: WindowUrlOptions): string {
  const url = new URL(base);
  url.searchParams.set('window', kind);
  url.searchParams.set('platform', o.platform);
  if (o.deterministic) url.searchParams.set('det', '1');
  if (kind === 'main' && o.vibrancy) url.searchParams.set('vibrancy', '1');
  // The settings window too: the demo clicks in it, and those clicks must be seen (T13-M5). Sheets have none.
  if ((kind === 'main' || kind === 'settings') && o.demo) url.searchParams.set('demo', '1');
  return url.toString();
}
