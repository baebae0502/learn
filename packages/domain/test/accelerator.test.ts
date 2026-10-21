import { describe, expect, it } from 'vitest';
import { acceleratorKeys, acceleratorLabel, keySpecKeys, platformAccelerator } from '../src/accelerator';

describe('accelerators', () => {
  it('maps ⌃⌘ combinations to Ctrl+Shift off macOS and leaves the rest', () => {
    expect(platformAccelerator('Ctrl+Cmd+S', 'linux')).toBe('Ctrl+Shift+S');
    expect(platformAccelerator('Ctrl+Cmd+S', 'darwin')).toBe('Ctrl+Cmd+S');
    expect(platformAccelerator('Alt+CmdOrCtrl+O', 'win32')).toBe('Alt+CmdOrCtrl+O');
  });
  it('draws macOS keycaps in ⌃⌥⇧⌘ order with Apple key symbols', () => {
    expect(acceleratorKeys('Alt+CmdOrCtrl+O', 'darwin')).toEqual(['⌥', '⌘', 'O']);
    expect(acceleratorKeys('Ctrl+Cmd+S', 'darwin')).toEqual(['⌃', '⌘', 'S']);
    expect(acceleratorKeys('Shift+CmdOrCtrl+R', 'darwin')).toEqual(['⇧', '⌘', 'R']);
    expect(acceleratorKeys('CmdOrCtrl+Plus', 'darwin')).toEqual(['⌘', '+']);
    expect(acceleratorKeys('CmdOrCtrl+-', 'darwin')).toEqual(['⌘', '−']);
    expect(acceleratorKeys('CmdOrCtrl+,', 'darwin')).toEqual(['⌘', ',']);
    expect(acceleratorKeys('CmdOrCtrl+Backspace', 'darwin')).toEqual(['⌘', '⌫']);
    expect(acceleratorKeys('Ctrl+Tab', 'darwin')).toEqual(['⌃', '⇥']);
    expect(acceleratorLabel('Alt+CmdOrCtrl+O', 'darwin')).toBe('⌥⌘O');
  });
  it('spells modifiers out on Linux and Windows', () => {
    expect(acceleratorKeys('Alt+CmdOrCtrl+O', 'linux')).toEqual(['Ctrl', 'Alt', 'O']);
    expect(acceleratorKeys('Ctrl+Cmd+S', 'linux')).toEqual(['Ctrl', 'Shift', 'S']);
    expect(acceleratorKeys('CmdOrCtrl+Plus', 'win32')).toEqual(['Ctrl', '+']);
    expect(acceleratorKeys('CmdOrCtrl+-', 'linux')).toEqual(['Ctrl', '-']);
    expect(acceleratorLabel('Alt+CmdOrCtrl+O', 'linux')).toBe('Ctrl+Alt+O');
  });
  it('draws single-key shortcuts from the physical key code', () => {
    expect(keySpecKeys({ code: 'F6' }, 'darwin')).toEqual(['F6']);
    expect(keySpecKeys({ code: 'F6', shift: true }, 'darwin')).toEqual(['⇧', 'F6']);
    expect(keySpecKeys({ code: 'KeyJ' }, 'linux')).toEqual(['J']);
    expect(keySpecKeys({ code: 'Digit1', shift: true }, 'linux')).toEqual(['Shift', '1']);
  });
});
