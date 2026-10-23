export type RendererWindow = 'main' | 'settings' | 'sheet' | 'gallery';
export interface WindowParams {
  window: RendererWindow;
  platform: string;
  deterministic: boolean;
  vibrancy: boolean;
  demo: boolean;
  /** Gallery page: component board part 1 or 2 (visual tour), 3 = interactive fixture for behaviour tests. */
  part: 1 | 2 | 3;
}
const KINDS: readonly RendererWindow[] = ['main', 'settings', 'sheet', 'gallery'];

export function readWindowParams(search: string): WindowParams {
  const p = new URLSearchParams(search);
  const w = p.get('window') as RendererWindow | null;
  return {
    window: w && KINDS.includes(w) ? w : 'main',
    platform: p.get('platform') ?? 'linux',
    deterministic: p.get('det') === '1',
    vibrancy: p.get('vibrancy') === '1',
    demo: p.get('demo') === '1',
    part: p.get('part') === '2' ? 2 : p.get('part') === '3' ? 3 : 1,
  };
}

/** Set on <html data-platform> by main.tsx before the first render. */
export const currentPlatform = (): string => document.documentElement.dataset['platform'] ?? 'linux';
