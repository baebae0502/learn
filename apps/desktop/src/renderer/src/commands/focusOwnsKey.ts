/*
 * The renderer keymap sits in the window's capture phase, ahead of the element that has the focus, so a key a focused control
 * uses itself would be taken before the control sees it. A command's key spec marked `yields` gives way when this says the
 * focus owns the key: Space on a button presses it, the arrows on a slider move it, esc inside a menu closes the menu.
 */

/** The part of an element this reads; the unit tests give it without a DOM. */
interface Focused {
  tagName: string;
  parentElement: Focused | null;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
}

const isElement = (t: EventTarget | null): t is EventTarget & Focused => t !== null && typeof (t as Partial<Focused>).getAttribute === 'function';

const PRESS_ROLES: ReadonlySet<string> = new Set(['button', 'link', 'menuitem', 'menuitemradio', 'menuitemcheckbox', 'option', 'tab', 'checkbox', 'radio', 'switch']);
const ARROW_ROLES: ReadonlySet<string> = new Set(['slider', 'tab', 'radio', 'menuitem', 'menuitemradio', 'menuitemcheckbox', 'treeitem', 'row', 'gridcell', 'spinbutton']);
const PRESS_KEYS: ReadonlySet<string> = new Set(['Space', 'Enter']);
const MOVE_KEYS: ReadonlySet<string> = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);
/** A list box moves along its list only: left and right are not its keys. */
const LIST_KEYS: ReadonlySet<string> = new Set(['ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

export function focusOwnsKey(target: EventTarget | null, code: string): boolean {
  if (!isElement(target)) return false;
  const role = target.getAttribute('role') ?? '';
  const tag = target.tagName.toLowerCase();
  if (PRESS_KEYS.has(code)) return tag === 'button' || (tag === 'a' && target.hasAttribute('href')) || PRESS_ROLES.has(role);
  if (MOVE_KEYS.has(code)) {
    if (role === 'option') return LIST_KEYS.has(code);
    return ARROW_ROLES.has(role) || (tag === 'input' && target.getAttribute('type') === 'range');
  }
  if (code === 'Escape') {
    for (let el: Focused | null = target; el; el = el.parentElement) {
      const r = el.getAttribute('role');
      if (r === 'menu' || r === 'dialog') return true;
    }
  }
  return false;
}

/**
 * The focus is inside an open menu or list pop-up (react-aria marks its popover with `data-trigger`): the letters there are the list's
 * own typeahead, so the registry's single-letter keys stay out of it.
 */
export function inOpenPopup(target: EventTarget | null): boolean {
  if (!isElement(target)) return false;
  for (let el: Focused | null = target; el; el = el.parentElement) if (el.hasAttribute('data-trigger')) return true;
  return false;
}
