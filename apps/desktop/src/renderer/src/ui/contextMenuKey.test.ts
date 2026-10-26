import { describe, expect, it } from 'vitest';
import { KEY_MENU_ECHO_MS, isContextMenuKey, isKeyMenuEcho, menuPointFor } from './contextMenuKey';

const key = (over: Partial<Parameters<typeof isContextMenuKey>[0]>): Parameters<typeof isContextMenuKey>[0] => ({
  key: '', code: '', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, isComposing: false, keyCode: 0, ...over,
});

describe('the keys that open a context menu (spec 9.1)', () => {
  it('⇧F10 and the menu key', () => {
    expect(isContextMenuKey(key({ key: 'F10', code: 'F10', shiftKey: true }))).toBe(true);
    expect(isContextMenuKey(key({ key: 'ContextMenu', code: 'ContextMenu' }))).toBe(true);
    expect(isContextMenuKey(key({ code: 'ContextMenu' }))).toBe(true); // a layout that names the key only by position
    expect(isContextMenuKey(key({ key: 'ContextMenu', shiftKey: true }))).toBe(true);
  });
  it('also takes a React keyboard event, whose composition flag is on its native event', () => {
    const react = (composing: boolean) => ({ key: 'F10', code: 'F10', shiftKey: true, altKey: false, ctrlKey: false, metaKey: false, keyCode: 121, nativeEvent: { isComposing: composing } });
    expect(isContextMenuKey(react(false))).toBe(true);
    expect(isContextMenuKey(react(true))).toBe(false);
  });
  it('not F10 alone (the menu bar\'s on some systems), not with another chord held, not while composing', () => {
    expect(isContextMenuKey(key({ key: 'F10', code: 'F10' }))).toBe(false);
    expect(isContextMenuKey(key({ key: 'F9', shiftKey: true }))).toBe(false);
    for (const held of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }] as const) {
      expect(isContextMenuKey(key({ key: 'F10', shiftKey: true, ...held })), JSON.stringify(held)).toBe(false);
      expect(isContextMenuKey(key({ key: 'ContextMenu', ...held })), JSON.stringify(held)).toBe(false);
    }
    expect(isContextMenuKey(key({ key: 'F10', shiftKey: true, isComposing: true }))).toBe(false);
    expect(isContextMenuKey(key({ key: 'F10', shiftKey: true, keyCode: 229 }))).toBe(false);
  });
});

describe('where the menu opens for a focused element', () => {
  const at = (left: number, bottom: number, width: number) => ({ getBoundingClientRect: () => ({ left, bottom, width }) });
  it('under the element, a little in from its left edge (half a narrow one)', () => {
    expect(menuPointFor(at(100, 300, 900), { height: 800 })).toEqual({ x: 148, y: 300 });
    expect(menuPointFor(at(100, 300, 40), { height: 800 })).toEqual({ x: 120, y: 300 });
    expect(menuPointFor(at(100.4, 300.4, 900), { height: 800 })).toEqual({ x: 148, y: 300 });
  });
  it('stays inside the window: a row scrolled below or above it is pulled to the edge', () => {
    expect(menuPointFor(at(0, 2000, 400), { height: 800 })).toEqual({ x: 48, y: 799 });
    expect(menuPointFor(at(0, -20, 400), { height: 800 })).toEqual({ x: 48, y: 0 });
  });
});

describe('the echo of a menu key (Windows sends contextmenu on key-up)', () => {
  it('is a contextmenu inside the window after our own menu opened, and only there', () => {
    expect(KEY_MENU_ECHO_MS).toBe(500);
    expect(isKeyMenuEcho(1000 + KEY_MENU_ECHO_MS - 1, 1000)).toBe(true);
    expect(isKeyMenuEcho(1000, 1000)).toBe(true);
    expect(isKeyMenuEcho(1000 + KEY_MENU_ECHO_MS, 1000)).toBe(false);
    expect(isKeyMenuEcho(1000 + KEY_MENU_ECHO_MS + 1, 1000)).toBe(false);
  });
  it('is never one when our key opened no menu', () => {
    expect(isKeyMenuEcho(5, null)).toBe(false);
  });
});
