import type { BaseWindow, MenuItemConstructorOptions, PopupOptions } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { COMMANDS, type CommandSpec } from '@learn/domain';

const popups: Array<{ template: MenuItemConstructorOptions[]; options: PopupOptions }> = [];

vi.mock('electron', () => ({
  Menu: {
    buildFromTemplate: (template: MenuItemConstructorOptions[]) => ({
      popup: (options: PopupOptions) => popups.push({ template, options }),
    }),
  },
}));

const { itemContextEntries, popupCommandMenu } = await import('./context-menu');

type Target = Parameters<typeof itemContextEntries>[1][number];
const target = (storageMode: 'managed' | 'linked', availability: 'available' | 'missing'): Target => ({
  id: crypto.randomUUID(), storageMode, availability,
});
const enabled = (targets: Target[]) => Object.fromEntries(itemContextEntries(COMMANDS, targets).map((e) => [e.id, e.enabled]));
const win = {} as BaseWindow;
/** Electron calls click(menuItem, window, event); the menuItem carries the template's `enabled`. */
const click = (t: MenuItemConstructorOptions) => t.click!({ enabled: t.enabled ?? true } as never, undefined, {} as never);

beforeEach(() => {
  popups.length = 0;
});

describe('item context menu entries', () => {
  it('lists only item-context commands flagged for the context menu, in registry order', () => {
    const entries = itemContextEntries(COMMANDS, [target('managed', 'available')]);
    expect(entries.map((e) => [e.id, e.label])).toEqual([
      ['item.open', '열기'],
      ['item.relink', '다시 연결…'],
    ]);
    const extra: CommandSpec[] = [...COMMANDS, { id: 'nav.back', label: 'x', contexts: ['item'] }];
    expect(itemContextEntries(extra, []).map((e) => e.id)).toEqual(['item.open', 'item.relink']);
  });

  it('열기 needs exactly one target', () => {
    expect(enabled([target('managed', 'available')])['item.open']).toBe(true);
    expect(enabled([target('linked', 'missing')])['item.open']).toBe(true);
    expect(enabled([target('managed', 'available'), target('managed', 'available')])['item.open']).toBe(false);
    expect(enabled([])['item.open']).toBe(false);
  });

  it('다시 연결… only for a single linked item whose file is missing', () => {
    expect(enabled([target('linked', 'missing')])['item.relink']).toBe(true);
    expect(enabled([target('linked', 'available')])['item.relink']).toBe(false);
    expect(enabled([target('managed', 'missing')])['item.relink']).toBe(false);
    expect(enabled([target('managed', 'available')])['item.relink']).toBe(false);
    expect(enabled([target('linked', 'missing'), target('linked', 'missing')])['item.relink']).toBe(false);
  });
});

describe('popupCommandMenu', () => {
  const entries = itemContextEntries(COMMANDS, [target('managed', 'available')]);

  it('pops up at the given point in the given window, with ids, labels and enabled flags', () => {
    void popupCommandMenu(entries, { window: win, x: 10.6, y: 20.2 });
    expect(popups).toHaveLength(1);
    const { template, options } = popups[0]!;
    expect(options).toMatchObject({ window: win, x: 11, y: 20 });
    expect(template.map((t) => ({ id: t.id, label: t.label, enabled: t.enabled }))).toEqual([
      { id: 'item.open', label: '열기', enabled: true },
      { id: 'item.relink', label: '다시 연결…', enabled: false },
    ]);
  });

  it('resolves the clicked command id (click before or after the close callback)', async () => {
    const a = popupCommandMenu(entries, { window: win, x: 0, y: 0 });
    click(popups[0]!.template[0]!);
    popups[0]!.options.callback!();
    await expect(a).resolves.toBe('item.open');

    const b = popupCommandMenu(entries, { window: win, x: 0, y: 0 });
    popups[1]!.options.callback!();
    click(popups[1]!.template[0]!);
    await expect(b).resolves.toBe('item.open');
  });

  it('resolves via an item click alone (a stubbed popup never calls the callback)', async () => {
    const p = popupCommandMenu(entries, { window: win, x: 0, y: 0 });
    click(popups[0]!.template[0]!);
    await expect(p).resolves.toBe('item.open');
  });

  it('resolves null when the menu closes without a pick, or a disabled item is clicked', async () => {
    const dismissed = popupCommandMenu(entries, { window: win, x: 0, y: 0 });
    popups[0]!.options.callback!();
    await expect(dismissed).resolves.toBeNull();

    const disabled = popupCommandMenu(entries, { window: win, x: 0, y: 0 });
    click(popups[1]!.template[1]!);
    await expect(disabled).resolves.toBeNull();
  });
});
