import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { COMMANDS, NO_LIBRARY_VIEW, TRASH_TARGET, type CommandContextState } from '@learn/domain';
import { applyMenuLabels, buildAppMenu, menuLabelState, menuLabelsChanged } from './app-menu';
import { columnMenuEntries } from './column-menu';
import { contextMenuEntries } from './context-entries';

vi.mock('electron', () => ({
  nativeImage: { createFromBuffer: (_png: Buffer, opts: { scaleFactor: number }) => ({ scale: opts.scaleFactor }) },
  Menu: { buildFromTemplate: () => ({}) },
}));

const LIB: CommandContextState = { view: 'library', blocked: false, textSize: 13, libraryCount: 9, selectionCount: 1, selectionAvailable: 1, selectionRelinkable: 0, ...NO_LIBRARY_VIEW };
const fileMenu = (labels = {}, onCommand: (...a: unknown[]) => void = () => {}) =>
  buildAppMenu({ isDev: false, platform: 'darwin', commands: COMMANDS, enabled: new Set(['item.trash', 'trash.empty']), onCommand, labels }).find((m) => m.id === 'menu.file')!.submenu as MenuItemConstructorOptions[];

describe('파일 menu (spec 11.2) and ⌘⌫ named by the view (P-11)', () => {
  it('ends with 휴지통 비우기… · 휴지통으로 이동 ⌘⌫ in a group of their own, before 창 닫기', () => {
    const items = fileMenu();
    expect(items.slice(-5).map((i) => (i.type === 'separator' ? '-' : (i.id ?? i.role)))).toEqual(['-', 'trash.empty', 'item.trash', '-', 'close']);
    expect(items.find((i) => i.id === 'item.trash')).toMatchObject({ label: '휴지통으로 이동', accelerator: 'CmdOrCtrl+Backspace' });
    expect(items.find((i) => i.id === 'trash.empty')).toMatchObject({ label: '휴지통 비우기…', accelerator: 'Shift+CmdOrCtrl+Backspace' });
  });
  it('is 영구 삭제… in the trash view: when the menu is built and when a report changes the view', () => {
    expect(fileMenu({ scope: 'trash' }).find((i) => i.id === 'item.trash')?.label).toBe('영구 삭제…');
    const live: Record<string, { label?: string }> = { 'item.trash': { label: '휴지통으로 이동' } };
    const lookup = { getMenuItemById: (id: string) => live[id] ?? null };
    expect(menuLabelsChanged(menuLabelState(LIB), menuLabelState({ ...LIB, scope: 'trash' }))).toBe(true);
    expect(menuLabelsChanged(menuLabelState(LIB), menuLabelState({ ...LIB, selectionCount: 3 }))).toBe(false);
    applyMenuLabels(lookup, 'darwin', menuLabelState({ ...LIB, scope: 'trash' }));
    expect(live['item.trash']!.label).toBe('영구 삭제…');
    applyMenuLabels(lookup, 'darwin', menuLabelState(LIB));
    expect(live['item.trash']!.label).toBe('휴지통으로 이동');
  });
  it('tells a key press from a click (Q-6e: the page lets a text field keep ⌘⌫)', () => {
    const calls: unknown[][] = [];
    const item = fileMenu({}, (...a) => calls.push(a)).find((i) => i.id === 'item.trash')!;
    item.click!({} as never, undefined, { triggeredByAccelerator: true } as never);
    item.click!({} as never, undefined, { triggeredByAccelerator: false } as never);
    (item.click as unknown as () => void)();
    expect(calls).toEqual([['item.trash', undefined, true], ['item.trash'], ['item.trash']]);
  });
});

describe('context menus named by the reported view (P-11)', () => {
  it('a trash row: 복원 · — · 영구 삭제…; an item row ends with 휴지통으로 이동', () => {
    const trash = { ...LIB, scope: 'trash' as const, trashCount: 2 };
    expect(contextMenuEntries('trash', COMMANDS, trash, [TRASH_TARGET], 'darwin')).toEqual([
      { id: 'item.restore', label: '복원', enabled: true }, 'separator', { id: 'item.trash', label: '영구 삭제…', enabled: true },
    ]);
    const item = contextMenuEntries('item', COMMANDS, LIB, [{ kind: 'item', storageMode: 'managed', availability: 'available' }], 'darwin', { organize: null });
    expect(item.slice(-2)).toEqual(['separator', { id: 'item.trash', label: '휴지통으로 이동', enabled: true }]);
  });
});

describe('the column menu (spec 4.3)', () => {
  it('lists 삭제한 날짜 only where a view forces it (the trash), checked and fixed', () => {
    expect(columnMenuEntries(['title'], '열 구성 되돌리기').some((e) => e !== 'separator' && e.kind === 'column' && e.id === 'deletedAt')).toBe(false);
    expect(columnMenuEntries(['title'], '열 구성 되돌리기', ['deletedAt'])).toContainEqual({ kind: 'column', id: 'deletedAt', label: '삭제한 날짜', checked: true, enabled: false });
  });
});
