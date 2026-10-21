/**
 * How the user last drove this window: 'keyboard' (an unmodified key — Tab, arrows, Enter…), 'pointer' (a mouse or
 * trackpad moved or pressed), or null before either. Shortcut chords (⌘/⌃/⌥ held) do not count: ⌃⌘S is a command,
 * not keyboard navigation. The sidebar's focus rescue only moves the focus (with its ring and tooltip) for a keyboard
 * user (design-spec 6: "키보드 포커스에서는 바로" means focus reached by keyboard navigation).
 */
export type InputKind = 'keyboard' | 'pointer';

const MODIFIERS = new Set(['Alt', 'AltGraph', 'CapsLock', 'Control', 'Fn', 'Meta', 'Shift']);
let last: InputKind | null = null;

/** Whether this key press is keyboard navigation (not a modifier, not a shortcut chord). */
export const isNavigationKey = (e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey'>): boolean =>
  !(e.metaKey || e.ctrlKey || e.altKey || MODIFIERS.has(e.key));

export function noteKey(e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey'>): void {
  if (isNavigationKey(e)) last = 'keyboard';
}

export function notePointer(): void {
  last = 'pointer';
}

export const lastInput = (): InputKind | null => last;

/** Capture-phase listeners on the document, installed once before the first render (main.tsx). */
export function installInputModality(doc: Document): void {
  doc.addEventListener('keydown', noteKey, true);
  for (const type of ['pointerdown', 'pointermove'] as const) doc.addEventListener(type, notePointer, true);
}
