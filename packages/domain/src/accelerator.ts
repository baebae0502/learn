/**
 * Electron accelerator helpers shared by the native menu (main) and keycaps/tooltips/palette (renderer).
 * No zod and no imports: the sandboxed preload may load this file.
 */
export interface KeySpec {
  /** KeyboardEvent.code (physical key), so shortcuts work with the Korean input source too (ADR-0005). */
  code: string;
  shift?: boolean;
  /** Also handled while a text field has focus (function keys such as F6). Letters never are. */
  inText?: boolean;
}

const MAC_SYMBOL: Readonly<Record<string, string>> = {
  Ctrl: '⌃', Control: '⌃', Alt: '⌥', Option: '⌥', Shift: '⇧', Cmd: '⌘', Command: '⌘', CmdOrCtrl: '⌘', CommandOrControl: '⌘',
};
const MAC_ORDER = ['⌃', '⌥', '⇧', '⌘'];
const OTHER_NAME: Readonly<Record<string, string>> = {
  Ctrl: 'Ctrl', Control: 'Ctrl', CmdOrCtrl: 'Ctrl', CommandOrControl: 'Ctrl', Alt: 'Alt', Option: 'Alt', Shift: 'Shift',
  Cmd: 'Super', Command: 'Super', Super: 'Super', Meta: 'Super',
};
const OTHER_ORDER = ['Ctrl', 'Alt', 'Shift', 'Super'];
const MAC_KEY: Readonly<Record<string, string>> = {
  Plus: '+', '-': '−', Enter: '↩', Return: '↩', Escape: 'esc', Esc: 'esc', Backspace: '⌫', Delete: '⌦', Tab: '⇥',
  Up: '↑', Down: '↓', Left: '←', Right: '→',
};
const OTHER_KEY: Readonly<Record<string, string>> = { Plus: '+', Return: 'Enter', Escape: 'Esc', Up: '↑', Down: '↓', Left: '←', Right: '→' };

const split = (acc: string): { mods: string[]; key: string } => {
  const parts = acc.split('+');
  const key = parts.pop() ?? '';
  return { mods: parts, key };
};

/** ⌃⌘ combinations have no Linux/Windows counterpart (Cmd would be the Super key): they become Ctrl+Shift there. */
export function platformAccelerator(accelerator: string, platform: string): string {
  if (platform === 'darwin') return accelerator;
  const { mods, key } = split(accelerator);
  const hasCmd = mods.some((m) => m === 'Cmd' || m === 'Command');
  const hasCtrl = mods.some((m) => m === 'Ctrl' || m === 'Control');
  if (!(hasCmd && hasCtrl)) return accelerator;
  const rest = mods.filter((m) => m !== 'Cmd' && m !== 'Command' && m !== 'Shift');
  return [...rest, 'Shift', key].join('+');
}

/**
 * Keycaps for an accelerator: macOS symbols in ⌃⌥⇧⌘ order, elsewhere spelled-out modifiers. A modifier on its own
 * ('Alt': hold ⌥ while dropping to link) is its own keycap.
 */
export function acceleratorKeys(accelerator: string, platform: string): string[] {
  const { mods, key } = split(platformAccelerator(accelerator, platform));
  if (platform === 'darwin') {
    const symbols = mods.map((m) => MAC_SYMBOL[m] ?? m).sort((a, b) => MAC_ORDER.indexOf(a) - MAC_ORDER.indexOf(b));
    return [...symbols, MAC_KEY[key] ?? MAC_SYMBOL[key] ?? (key.length === 1 ? key.toUpperCase() : key)];
  }
  const names = mods.map((m) => OTHER_NAME[m] ?? m).sort((a, b) => OTHER_ORDER.indexOf(a) - OTHER_ORDER.indexOf(b));
  return [...names, OTHER_KEY[key] ?? OTHER_NAME[key] ?? (key.length === 1 ? key.toUpperCase() : key)];
}

/** One-line form for menus, tooltips and the palette: "⌥⌘O" on macOS, "Ctrl+Alt+O" elsewhere. */
export function acceleratorLabel(accelerator: string, platform: string): string {
  const keys = acceleratorKeys(accelerator, platform);
  return platform === 'darwin' ? keys.join('') : keys.join('+');
}

export function keySpecKeys(key: KeySpec, platform: string): string[] {
  const name = key.code.startsWith('Key') ? key.code.slice(3) : key.code.startsWith('Digit') ? key.code.slice(5) : key.code;
  return key.shift ? [platform === 'darwin' ? '⇧' : 'Shift', name] : [name];
}
