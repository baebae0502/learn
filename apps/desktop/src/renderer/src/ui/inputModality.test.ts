import { describe, expect, it } from 'vitest';
import { isNavigationKey, lastInput, noteKey, notePointer } from './inputModality';
import { setTooltipBlock, tooltipsBlocked } from './tooltipGate';

const key = (key: string, mods: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey', boolean>> = {}) => ({ key, metaKey: false, ctrlKey: false, altKey: false, ...mods });

describe('input modality (focus rings and tooltips after code-moved focus)', () => {
  it('counts navigation keys, not modifiers or shortcut chords', () => {
    for (const k of ['Tab', 'ArrowDown', 'Enter', ' ', 'F6', 'a']) expect(isNavigationKey(key(k)), k).toBe(true);
    for (const k of ['Shift', 'Meta', 'Control', 'Alt']) expect(isNavigationKey(key(k)), k).toBe(false);
    expect(isNavigationKey(key('s', { ctrlKey: true, metaKey: true })), '⌃⌘S').toBe(false);
    expect(isNavigationKey(key('1', { metaKey: true })), '⌘1').toBe(false);
  });
  it('remembers the last kind of input', () => {
    expect(lastInput()).toBeNull();
    noteKey(key('s', { ctrlKey: true, metaKey: true }));
    expect(lastInput()).toBeNull();
    noteKey(key('Tab'));
    expect(lastInput()).toBe('keyboard');
    notePointer();
    expect(lastInput()).toBe('pointer');
  });
  it('tooltips are blocked while any reason holds', () => {
    expect(tooltipsBlocked()).toBe(false);
    setTooltipBlock('inactive', true);
    setTooltipBlock('menu', true);
    setTooltipBlock('inactive', false);
    expect(tooltipsBlocked()).toBe(true);
    setTooltipBlock('menu', false);
    expect(tooltipsBlocked()).toBe(false);
  });
});
