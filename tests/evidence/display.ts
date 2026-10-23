// Display spike (Task 13): the macOS runner's screen is 1024×768 @1x, where the 1440×900 window shrinks to 1024×684.
// The workflow installs displayplacer (pinned, sha256) and saves `displayplacer list` before any test; this module reads
// that list and picks the mode the demo records in. Only the demo switches, around its own recording, and puts the
// screens back after it (demo.evidence.ts), so every other suite measures the screen it always had.
// Pure (unit-tested); display-mac.ts runs displayplacer.

export interface DisplayMode {
  mode: number;
  /** Points: for a HiDPI ("scaling:on") mode the pixels are twice this. */
  width: number;
  height: number;
  hz: number | null;
  colorDepth: number | null;
  scaling: boolean;
  current: boolean;
}

export interface DisplayScreen {
  /** Persistent screen id. */
  id: string;
  contextualId: string | null;
  type: string | null;
  /** "Resolution:", "Scaling:" and "Origin:" as listed. */
  resolution: string | null;
  scaling: string | null;
  origin: string | null;
  main: boolean;
  modes: DisplayMode[];
}

export interface DisplayList {
  screens: DisplayScreen[];
  /** The arguments of the closing `displayplacer "…" "…"` line: the current arrangement, to put it back. */
  restore: string[];
}

const field = (line: string, name: string) => (line.startsWith(`${name}:`) ? line.slice(name.length + 1).trim() : null);

/** `displayplacer list` (v1.4.0) as data; unknown lines are skipped, so other output yields no screens. */
export function parseDisplayplacerList(text: string): DisplayList {
  const screens: DisplayScreen[] = [];
  let restore: string[] = [];
  let screen: DisplayScreen | null = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const id = field(line, 'Persistent screen id');
    if (id !== null) {
      screen = { id, contextualId: null, type: null, resolution: null, scaling: null, origin: null, main: false, modes: [] };
      screens.push(screen);
      continue;
    }
    if (line.startsWith('displayplacer "')) {
      restore = [...line.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
      continue;
    }
    if (!screen) continue;
    const mode = /^mode (\d+): (.*)$/.exec(line);
    if (mode) {
      const kv = Object.fromEntries([...mode[2]!.matchAll(/(\w+):(\S+)/g)].map((m) => [m[1], m[2]]));
      const res = /^(\d+)x(\d+)$/.exec(kv['res'] ?? '');
      if (!res) continue;
      const num = (v: string | undefined) => (v !== undefined && /^\d+$/.test(v) ? Number(v) : null);
      screen.modes.push({
        mode: Number(mode[1]),
        width: Number(res[1]),
        height: Number(res[2]),
        hz: num(kv['hz']),
        colorDepth: num(kv['color_depth']),
        scaling: kv['scaling'] === 'on',
        current: line.includes('<-- current mode'),
      });
      continue;
    }
    screen.contextualId ??= field(line, 'Contextual screen id');
    screen.type ??= field(line, 'Type');
    screen.resolution ??= field(line, 'Resolution');
    screen.scaling ??= field(line, 'Scaling');
    const origin = field(line, 'Origin');
    if (origin !== null) {
      screen.origin = origin;
      screen.main = origin.includes('main display');
    }
  }
  return { screens, restore };
}

/** The window's default size (design-spec 2.1, window-frame.ts DEFAULT_SIZE). */
const WINDOW = { width: 1440, height: 900 };
const MAX_WIDTH = 1920;

/**
 * The demo's mode on `screen`, or null when nothing is better than 1x below 1440 wide. A mode qualifies when it is at
 * most 1920 points wide and either holds the 1440 × 900 window or is HiDPI. Best first: holds the window (no shrunken,
 * cramped layout — what the owner saw at 1024 × 768), then HiDPI (Retina sharpness), then the size nearest the window
 * (the smallest that holds it fills the frame most; otherwise the largest), then refresh rate and colour depth.
 */
export function pickDemoMode(screen: DisplayScreen): DisplayMode | null {
  const holds = (m: DisplayMode) => m.width >= WINDOW.width && m.height >= WINDOW.height;
  const candidates = screen.modes.filter((m) => m.width <= MAX_WIDTH && (m.width >= WINDOW.width || m.scaling));
  const key = (m: DisplayMode) => [holds(m) ? 1 : 0, m.scaling ? 1 : 0, holds(m) ? -(m.width * m.height) : m.width * m.height, m.hz ?? 0, m.colorDepth ?? 0];
  const better = (a: DisplayMode, b: DisplayMode) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i]! > kb[i]!;
    return false;
  };
  return candidates.reduce<DisplayMode | null>((best, m) => (best === null || better(m, best) ? m : best), null);
}

/** displayplacer arguments that set `screen` to `mode` (its origin and rotation stay). */
export function modeArguments(screen: DisplayScreen, mode: DisplayMode): string[] {
  const parts = [`id:${screen.id}`, `res:${mode.width}x${mode.height}`];
  if (mode.hz !== null) parts.push(`hz:${mode.hz}`);
  if (mode.colorDepth !== null) parts.push(`color_depth:${mode.colorDepth}`);
  parts.push(`scaling:${mode.scaling ? 'on' : 'off'}`);
  return [parts.join(' ')];
}

/** displayplacer arguments that put every screen back as the list found them. */
export const restoreArguments = (list: DisplayList): string[] => list.restore;
