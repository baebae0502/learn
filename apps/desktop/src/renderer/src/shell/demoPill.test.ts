import { describe, expect, it } from 'vitest';
import { acceleratorLabel } from '@learn/domain';
import { commandPill, keyPill, shortcutPill } from './demoPill';

const key = (k: string, mods: Partial<Record<'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey' | 'isComposing' | 'repeat', boolean>> = {}) => ({
  key: k, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, isComposing: false, repeat: false, ...mods,
});

describe('demo pills', () => {
  it('show a menu command with its shortcut in the platform glyphs and its menu label', () => {
    expect(commandPill('app.palette', 'darwin')).toEqual({ keys: ['⌘', 'K'], label: '명령 팔레트…' });
    expect(commandPill('app.palette', 'linux')).toEqual({ keys: ['Ctrl', 'K'], label: '명령 팔레트…' });
    expect(commandPill('file.importLinked', 'darwin')).toEqual({ keys: ['⌥', '⌘', 'O'], label: '외부 파일 연결…' });
    // The same glyphs the menus and tooltips use (acceleratorLabel joins these keys).
    expect(commandPill('view.toggleSidebar', 'darwin')!.keys.join('')).toBe(acceleratorLabel('Ctrl+Cmd+S', 'darwin'));
    expect(commandPill('view.toggleSidebar', 'linux')!.keys.join('+')).toBe(acceleratorLabel('Ctrl+Cmd+S', 'linux'));
  });
  it('name a toggle by what it did: the state before the command ran', () => {
    expect(commandPill('view.toggleSidebar', 'darwin', 'shown')!.label).toBe('사이드바 가리기');
    expect(commandPill('view.toggleSidebar', 'darwin', 'hidden')!.label).toBe('사이드바 보기');
  });
  it('show nothing for a command without a shortcut', () => {
    expect(commandPill('item.open', 'darwin')).toBeNull();
    expect(commandPill('view.nextPane', 'darwin')).toBeNull(); // F6 is a key, shown by keyPill
  });
  it('show a main-run menu item from the accelerator and label main sent', () => {
    expect(shortcutPill({ accelerator: 'Ctrl+Cmd+F', label: '전체 화면 시작' }, 'darwin')).toEqual({ keys: ['⌃', '⌘', 'F'], label: '전체 화면 시작' });
    expect(shortcutPill({ accelerator: 'CmdOrCtrl+,', label: '설정…' }, 'linux')).toEqual({ keys: ['Ctrl', ','], label: '설정…' });
  });
  it('show the window keys the menu does not own, with ⇧ when held', () => {
    expect(keyPill(key('F6'), 'darwin')).toEqual({ keys: ['F6'], label: '' });
    expect(keyPill(key('F6', { shiftKey: true }), 'darwin')).toEqual({ keys: ['⇧', 'F6'], label: '' });
    expect(keyPill(key('F6', { shiftKey: true }), 'linux')).toEqual({ keys: ['Shift', 'F6'], label: '' });
    expect(keyPill(key('Enter'), 'darwin')!.keys).toEqual(['↩']);
    expect(keyPill(key('Enter'), 'linux')!.keys).toEqual(['Enter']);
    expect(keyPill(key('Escape'), 'darwin')!.keys).toEqual(['esc']);
    expect(keyPill(key('Escape'), 'linux')!.keys).toEqual(['Esc']);
    expect(keyPill(key('Tab'), 'darwin')!.keys).toEqual(['⇥']);
    expect(keyPill(key('ArrowDown'), 'darwin')!.keys).toEqual(['↓']);
  });
  it('show no letters, no menu chords, no IME composition and no key repeat', () => {
    expect(keyPill(key('a'), 'darwin')).toBeNull();
    expect(keyPill(key('ㅅ'), 'darwin')).toBeNull();
    expect(keyPill(key('Enter', { metaKey: true }), 'darwin')).toBeNull();
    expect(keyPill(key('Enter', { isComposing: true }), 'darwin')).toBeNull();
    expect(keyPill(key('ArrowDown', { repeat: true }), 'darwin')).toBeNull();
  });
});
