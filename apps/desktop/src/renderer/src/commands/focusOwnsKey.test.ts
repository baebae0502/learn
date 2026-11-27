import { describe, expect, it } from 'vitest';
import { focusOwnsKey, inOpenPopup } from './focusOwnsKey';

/** The few members of an element focusOwnsKey reads (the unit tests run without a DOM). */
interface FakeEl {
  tagName: string;
  attrs: Record<string, string>;
  parentElement: FakeEl | null;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
}
const el = (tagName: string, attrs: Record<string, string> = {}, parent: FakeEl | null = null): FakeEl => ({
  tagName: tagName.toUpperCase(),
  attrs,
  parentElement: parent,
  getAttribute: (n) => attrs[n] ?? null,
  hasAttribute: (n) => n in attrs,
});
const owns = (target: FakeEl | null, code: string) => focusOwnsKey(target as unknown as EventTarget | null, code);

describe('focusOwnsKey (the focused control keeps its own keys, M8a spec 6.3)', () => {
  it('a button owns Space and Enter; the stage (a tabindex div) owns nothing', () => {
    expect(owns(el('button'), 'Space')).toBe(true);
    expect(owns(el('button'), 'Enter')).toBe(true);
    expect(owns(el('div', { tabindex: '0', role: 'region' }), 'Space')).toBe(false);
    expect(owns(el('div', { tabindex: '0' }), 'ArrowLeft')).toBe(false);
  });
  it('a link and the button-like roles own Space and Enter', () => {
    expect(owns(el('a', { href: '/x' }), 'Space')).toBe(true);
    expect(owns(el('a'), 'Space')).toBe(false);
    for (const role of ['button', 'link', 'menuitem', 'menuitemradio', 'menuitemcheckbox', 'option', 'tab', 'checkbox', 'radio', 'switch']) {
      expect(owns(el('div', { role }), 'Space'), role).toBe(true);
      expect(owns(el('div', { role }), 'Enter'), role).toBe(true);
    }
    expect(owns(el('div', { role: 'slider' }), 'Space')).toBe(false);
  });
  it('a slider owns the arrows, Home, End and the page keys (a range input too)', () => {
    for (const code of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']) {
      expect(owns(el('div', { role: 'slider' }), code), code).toBe(true);
      expect(owns(el('input', { type: 'range' }), code), code).toBe(true);
    }
    expect(owns(el('input', { type: 'text' }), 'ArrowLeft')).toBe(false);
  });
  it('a tab, a radio, a menu item, a tree item, a row, a cell and a spin button own the arrows', () => {
    for (const role of ['tab', 'radio', 'menuitem', 'menuitemradio', 'menuitemcheckbox', 'treeitem', 'row', 'gridcell', 'spinbutton']) {
      expect(owns(el('div', { role }), 'ArrowLeft'), role).toBe(true);
      expect(owns(el('div', { role }), 'ArrowDown'), role).toBe(true);
    }
  });
  it('an option owns the vertical arrows and the ends, not the horizontal ones', () => {
    expect(owns(el('div', { role: 'option' }), 'ArrowRight')).toBe(false);
    expect(owns(el('div', { role: 'option' }), 'ArrowLeft')).toBe(false);
    for (const code of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageUp', 'PageDown']) expect(owns(el('div', { role: 'option' }), code), code).toBe(true);
  });
  it('Escape belongs to an open menu or dialog around the focus', () => {
    const menu = el('div', { role: 'menu' });
    expect(owns(el('div', { role: 'menuitemradio' }, menu), 'Escape')).toBe(true);
    const dialog = el('div', { role: 'dialog' });
    expect(owns(el('button', {}, el('div', {}, dialog)), 'Escape')).toBe(true);
    expect(owns(el('div', { tabindex: '0' }), 'Escape')).toBe(false);
  });
  it('no focus, a non-element target and other keys own nothing', () => {
    expect(focusOwnsKey(null, 'Space')).toBe(false);
    expect(focusOwnsKey({} as EventTarget, 'Space')).toBe(false);
    expect(owns(el('button'), 'KeyK')).toBe(false);
    expect(owns(el('button'), 'Comma')).toBe(false);
  });
});

describe('inOpenPopup (typeahead of an open menu or list keeps its letters)', () => {
  it('is true inside a react-aria popover and false anywhere else', () => {
    const popover = el('div', { 'data-trigger': 'MenuTrigger' });
    const menu = el('div', { role: 'menu' }, popover);
    expect(inOpenPopup(el('div', { role: 'menuitemradio' }, menu) as unknown as EventTarget)).toBe(true);
    expect(inOpenPopup(el('div', { role: 'option' }, el('div', { role: 'listbox' }, el('div', { 'data-trigger': 'Select' }))) as unknown as EventTarget)).toBe(true);
    expect(inOpenPopup(el('div', { tabindex: '0' }) as unknown as EventTarget)).toBe(false);
    expect(inOpenPopup(el('div', { role: 'listbox' }) as unknown as EventTarget)).toBe(false); // a list in the page (the transcript) is not a pop-up
    expect(inOpenPopup(null)).toBe(false);
  });
});
