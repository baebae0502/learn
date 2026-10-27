import { isComposingKey } from './ime';

/** A DOM keyboard event, or a React one (whose `isComposing` lives on its native event). */
type KeyLike = Pick<KeyboardEvent, 'key' | 'code' | 'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey' | 'keyCode'> & {
  isComposing?: boolean;
  nativeEvent?: { isComposing: boolean };
};

/**
 * ⇧F10 and the menu key (Linux and Windows keyboards): open the context menu of the focused element (spec 9.1). Nothing
 * during a Korean composition and nothing with ⌘ ⌃ ⌥ held; F10 alone is not it. VoiceOver's VO-⇧-M comes as a
 * `contextmenu` event of its own.
 */
export function isContextMenuKey(e: KeyLike): boolean {
  if (isComposingKey(e)) return false;
  if (e.altKey || e.ctrlKey || e.metaKey) return false;
  if (e.key === 'ContextMenu' || e.code === 'ContextMenu') return true;
  return e.key === 'F10' && e.shiftKey;
}

/**
 * Where a menu opened by the keyboard goes: under the element, a little in from its left edge, kept inside the window (a
 * row scrolled out of view still opens its menu at the edge). Window coordinates, like a click's `clientX/Y`.
 */
export function menuPointFor(
  el: { getBoundingClientRect(): { left: number; bottom: number; width: number } },
  viewport: { height: number } = { height: innerHeight },
): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + Math.min(r.width / 2, 48)), y: Math.round(Math.max(0, Math.min(r.bottom, viewport.height - 1))) };
}

/** A `contextmenu` this soon after the menu our own key opened is the system's echo of the same key (Windows sends it on key-up). */
export const KEY_MENU_ECHO_MS = 500;

/** Whether a `contextmenu` at `now` echoes the menu our key opened at `openedAt` (null: our key opened none). Times from performance.now(). */
export function isKeyMenuEcho(now: number, openedAt: number | null): boolean {
  return openedAt !== null && now - openedAt < KEY_MENU_ECHO_MS;
}
