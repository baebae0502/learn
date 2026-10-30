import { describe, expect, it } from 'vitest';
import { treeKeyAction, type TreeKeyInput, type TreeKeyRow } from './treeKeys';

const OPEN: TreeKeyRow = { key: 'bio', collection: true, expanded: true, hasChildren: true, firstChild: 'c6', parent: null };
const CLOSED: TreeKeyRow = { ...OPEN, expanded: false };
const LEAF: TreeKeyRow = { key: 'lab', collection: true, expanded: false, hasChildren: false, firstChild: null, parent: 'c6' };
const CHILD: TreeKeyRow = { key: 'c6', collection: true, expanded: false, hasChildren: true, firstChild: 'lab', parent: 'bio' };
const ALL: TreeKeyRow = { key: 'scope:all', collection: false, expanded: false, hasChildren: false, firstChild: null, parent: null };
const press = (key: string, over: Partial<TreeKeyInput> = {}) =>
  treeKeyAction({ key, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, composing: false, target: 'row', contextMenuKey: false, reader: false, row: OPEN, ...over });
const NONE = { do: 'none' };

describe('the name field inside a row (spec 3.4: IME-safe)', () => {
  const field = (key: string, over: Partial<TreeKeyInput> = {}) => press(key, { target: 'rename', row: null, ...over });
  it('↩ finishes the edit and esc drops it', () => {
    expect(field('Enter')).toEqual({ do: 'commit' });
    expect(field('Escape')).toEqual({ do: 'cancel' });
  });
  it('during a composition ↩ and esc are the IME\'s: nothing finishes', () => {
    expect(field('Enter', { composing: true })).toEqual({ do: 'swallow' });
    expect(field('Escape', { composing: true })).toEqual({ do: 'swallow' });
  });
  it('every other key stays in the field: the row\'s own handling (arrows, Home/End, Space) must never see it', () => {
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowDown', 'Home', 'End', ' ', 'a', '가', 'Backspace', 'Tab']) expect(field(key), key).toEqual({ do: 'swallow' });
  });
});

describe('a collection row', () => {
  it('↩ renames it; on a special view it does nothing', () => {
    expect(press('Enter')).toEqual({ do: 'rename', key: 'bio' });
    expect(press('Enter', { row: ALL })).toEqual(NONE);
  });
  it('→ on an open row goes to its first child — named by the model, not by the next row in the DOM', () => {
    expect(press('ArrowRight')).toEqual({ do: 'goto', key: 'c6' });
    expect(press('ArrowRight', { row: CLOSED })).toEqual(NONE); // RAC opens it
    expect(press('ArrowRight', { row: LEAF })).toEqual(NONE);
    expect(press('ArrowRight', { row: ALL })).toEqual(NONE);
  });
  it('← on a closed row or a leaf goes to the parent; on an open row RAC folds it; a top-level row has no parent', () => {
    expect(press('ArrowLeft', { row: LEAF })).toEqual({ do: 'goto', key: 'c6' });
    expect(press('ArrowLeft', { row: CHILD })).toEqual({ do: 'goto', key: 'bio' }); // closed, with children
    expect(press('ArrowLeft', { row: { ...CHILD, expanded: true } })).toEqual(NONE);
    expect(press('ArrowLeft', { row: CLOSED })).toEqual(NONE); // no parent
    expect(press('ArrowLeft', { row: ALL })).toEqual(NONE);
  });
  it('typing is not type-ahead (design-spec 7.1): letters, digits, Hangul and the IME\'s Process key are held back; Space, arrows, Home/End are not', () => {
    for (const key of ['a', 'Z', '3', '과', '.', 'Process']) expect(press(key), key).toEqual({ do: 'block' });
    expect(press('가', { composing: true })).toEqual({ do: 'block' });
    for (const key of [' ', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageDown', 'Tab']) expect(press(key), key).toEqual(NONE);
  });
  it('keys with ⌘ ⌃ ⌥ or ⇧ are RAC\'s or the menu\'s', () => {
    for (const over of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }, { shiftKey: true }]) {
      expect(press('Enter', over), JSON.stringify(over)).toEqual(NONE);
      expect(press('ArrowRight', over), JSON.stringify(over)).toEqual(NONE);
      expect(press('a', over), JSON.stringify(over)).toEqual(NONE);
    }
  });
  it('⇧F10 or the menu key opens a collection\'s menu and nothing for a special view', () => {
    expect(press('F10', { shiftKey: true, contextMenuKey: true })).toEqual({ do: 'menu', key: 'bio' });
    expect(press('ContextMenu', { contextMenuKey: true, row: LEAF })).toEqual({ do: 'menu', key: 'lab' });
    expect(press('F10', { shiftKey: true, contextMenuKey: true, row: ALL })).toEqual({ do: 'ignoreMenu' });
  });
  it('a key that is not on a row (a button inside it, the heading) is not ours', () => {
    expect(press('Enter', { target: 'other', row: null })).toEqual(NONE);
    expect(press('a', { target: 'other', row: null })).toEqual(NONE);
  });
  it('in the reader the sidebar is a way back: ↩ and the arrows are RAC\'s (press, move), typing is still held back', () => {
    expect(press('Enter', { reader: true })).toEqual(NONE);
    expect(press('ArrowRight', { reader: true })).toEqual(NONE);
    expect(press('ArrowLeft', { reader: true, row: LEAF })).toEqual(NONE);
    expect(press('a', { reader: true })).toEqual({ do: 'block' });
    expect(press('F10', { shiftKey: true, contextMenuKey: true, reader: true })).toEqual({ do: 'menu', key: 'bio' });
  });
});
