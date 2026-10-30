import { describe, expect, it } from 'vitest';
import { chipKeyAction } from './chipKeys';

const key = (k: string, over: Partial<Parameters<typeof chipKeyAction>[0]> = {}) => ({ key: k, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, ...over });

describe('the keys of a tag chip (spec 4.3, design-spec 6 태그 칩)', () => {
  it('a filter chip: ←→ Home End move the one stop, ↩ renames, Space is left to the button (it toggles the filter), ⌫ does nothing', () => {
    expect(chipKeyAction(key('ArrowLeft'), 'filter')).toEqual({ kind: 'move', to: 'previous' });
    expect(chipKeyAction(key('ArrowRight'), 'filter')).toEqual({ kind: 'move', to: 'next' });
    expect(chipKeyAction(key('Home'), 'filter')).toEqual({ kind: 'move', to: 'first' });
    expect(chipKeyAction(key('End'), 'filter')).toEqual({ kind: 'move', to: 'last' });
    expect(chipKeyAction(key('Enter'), 'filter')).toEqual({ kind: 'rename' });
    expect(chipKeyAction(key(' '), 'filter')).toBeNull();
    expect(chipKeyAction(key('Backspace'), 'filter')).toBeNull();
    expect(chipKeyAction(key('Delete'), 'filter')).toBeNull();
  });
  it('an assigned chip: the same moves, ⌫ and Delete take the tag off, ↩ does nothing (it has no name field)', () => {
    expect(chipKeyAction(key('ArrowRight'), 'assigned')).toEqual({ kind: 'move', to: 'next' });
    expect(chipKeyAction(key('Backspace'), 'assigned')).toEqual({ kind: 'remove' });
    expect(chipKeyAction(key('Delete'), 'assigned')).toEqual({ kind: 'remove' });
    expect(chipKeyAction(key('Enter'), 'assigned')).toBeNull();
  });
  it('nothing with ⌘ ⌃ ⌥ held, and ⇧ turns the plain keys into other commands', () => {
    for (const k of ['ArrowRight', 'Home', 'Enter', 'Backspace']) {
      for (const mod of ['metaKey', 'ctrlKey', 'altKey', 'shiftKey'] as const) {
        expect(chipKeyAction(key(k, { [mod]: true }), 'filter'), `${k} ${mod}`).toBeNull();
        expect(chipKeyAction(key(k, { [mod]: true }), 'assigned'), `${k} ${mod}`).toBeNull();
      }
    }
  });
});
