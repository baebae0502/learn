import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { registerWindowKind, windowKindOf } from './window-kinds';

/** A webContents stand-in: its id, and the 'destroyed' event Electron emits when it goes. */
const contents = (id: number) => Object.assign(new EventEmitter(), { id });

describe('window kinds', () => {
  it('answers the kind main registered for a webContents, and nothing for any other id', () => {
    registerWindowKind(contents(101), 'main');
    registerWindowKind(contents(102), 'sheet');
    registerWindowKind(contents(103), 'settings');
    expect([windowKindOf(101), windowKindOf(102), windowKindOf(103)]).toEqual(['main', 'sheet', 'settings']);
    expect(windowKindOf(104)).toBeUndefined(); // a page main did not create (a test's probe window, a stranger)
    expect(windowKindOf(undefined)).toBeUndefined();
  });

  it('forgets a webContents once it is destroyed', () => {
    const c = contents(201);
    registerWindowKind(c, 'settings');
    c.emit('destroyed');
    expect(windowKindOf(201)).toBeUndefined();
  });

  it('keeps one kind per webContents: the same kind again is a no-op, a different one is refused', () => {
    const c = contents(301);
    registerWindowKind(c, 'main');
    registerWindowKind(c, 'main');
    expect(c.listenerCount('destroyed')).toBe(1);
    expect(() => registerWindowKind(c, 'sheet')).toThrow(/301/);
    expect(windowKindOf(301)).toBe('main');
  });
});
