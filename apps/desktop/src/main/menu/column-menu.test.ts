import type { BaseWindow, MenuItemConstructorOptions, PopupOptions } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LIBRARY_COLUMNS } from '@learn/domain';

const popups: Array<{ template: MenuItemConstructorOptions[]; options: PopupOptions }> = [];

vi.mock('electron', () => ({
  Menu: {
    buildFromTemplate: (template: MenuItemConstructorOptions[]) => ({
      popup: (options: PopupOptions) => popups.push({ template, options }),
    }),
  },
}));

const { columnMenuEntries, popupColumnMenu } = await import('./column-menu');

const win = {} as BaseWindow;
/** Electron calls click(menuItem, window, event); a checkbox item has already flipped `checked` by then. */
const click = (t: MenuItemConstructorOptions) => t.click!({ enabled: t.enabled ?? true, checked: !t.checked } as never, undefined, {} as never);

beforeEach(() => {
  popups.length = 0;
});

describe('column header menu entries (design-spec 7.3 열 머리, M4 spec 3.2)', () => {
  it('lists every catalogue column, checked when shown, the title checked and fixed, then a separator and the reset', () => {
    const shown = ['title', 'creators', 'size'];
    expect(columnMenuEntries(['title', 'creators', 'size'], '열 구성 되돌리기')).toEqual([
      ...LIBRARY_COLUMNS.map((c) => ({ kind: 'column', id: c.id, label: c.label, checked: shown.includes(c.id), enabled: c.id !== 'title' })),
      'separator',
      { kind: 'reset', label: '열 구성 되돌리기' },
    ]);
  });
  it('keeps the title checked even when the renderer leaves it out', () => {
    expect(columnMenuEntries([], '열 구성 되돌리기')[0]).toEqual({ kind: 'column', id: 'title', label: '제목', checked: true, enabled: false });
  });
  it('draws a column the view forces on checked and fixed, like the title, whatever was reported as shown', () => {
    const entries = columnMenuEntries(['title', 'creators'], '열 구성 되돌리기', ['openedAt']);
    expect(entries.find((e) => e !== 'separator' && e.kind === 'column' && e.id === 'openedAt')).toEqual({ kind: 'column', id: 'openedAt', label: '마지막으로 연 날', checked: true, enabled: false });
    expect(entries.find((e) => e !== 'separator' && e.kind === 'column' && e.id === 'updatedAt')).toMatchObject({ checked: false, enabled: true });
  });
});

describe('popupColumnMenu', () => {
  it('pops up checkbox items with ids at the given point, then a separator and the reset item', () => {
    void popupColumnMenu(columnMenuEntries(['title', 'year'], '열 구성 되돌리기'), { window: win, x: 10.6, y: 20.2 });
    expect(popups).toHaveLength(1);
    const { template, options } = popups[0]!;
    expect(options).toMatchObject({ window: win, x: 11, y: 20 });
    expect(template[0]).toMatchObject({ id: 'column.title', type: 'checkbox', label: '제목', checked: true, enabled: false });
    expect(template[2]).toMatchObject({ id: 'column.year', type: 'checkbox', label: '연도', checked: true, enabled: true });
    expect(template[5]).toMatchObject({ id: 'column.updatedAt', type: 'checkbox', checked: false, enabled: true });
    expect(template.at(-2)).toEqual({ type: 'separator' });
    expect(template.at(-1)).toMatchObject({ id: 'column.reset', label: '열 구성 되돌리기' });
  });
  it('resolves the column to show or hide, the reset, or null when the menu closes without a pick', async () => {
    const entries = columnMenuEntries(['title'], '열 구성 되돌리기');
    const toggled = popupColumnMenu(entries, { window: win, x: 0, y: 0 });
    click(popups[0]!.template[5]!); // 수정일
    popups[0]!.options.callback!();
    await expect(toggled).resolves.toEqual({ toggle: 'updatedAt' });
    const reset = popupColumnMenu(entries, { window: win, x: 0, y: 0 });
    click(popups[1]!.template.at(-1)!);
    await expect(reset).resolves.toEqual({ reset: true });
    const dismissed = popupColumnMenu(entries, { window: win, x: 0, y: 0 });
    popups[2]!.options.callback!();
    await expect(dismissed).resolves.toBeNull();
  });
});
