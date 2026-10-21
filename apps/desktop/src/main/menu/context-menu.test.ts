import type { BaseWindow, MenuItemConstructorOptions, PopupOptions } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { COMMANDS, type CommandContextState, type CommandTargetInfo } from '@learn/domain';

const popups: Array<{ template: MenuItemConstructorOptions[]; options: PopupOptions }> = [];

vi.mock('electron', () => ({
  Menu: {
    buildFromTemplate: (template: MenuItemConstructorOptions[]) => ({
      popup: (options: PopupOptions) => popups.push({ template, options }),
    }),
  },
}));

const { contextMenuEntries, popupCommandMenu } = await import('./context-menu');

const LIB: CommandContextState = { view: 'library', blocked: false };
const target = (storageMode: 'managed' | 'linked', availability: 'available' | 'missing'): CommandTargetInfo => ({ storageMode, availability });
const ids = (entries: ReturnType<typeof contextMenuEntries>) => entries.map((e) => (e === 'separator' ? '-' : e.id));
const win = {} as BaseWindow;
/** Electron calls click(menuItem, window, event); the menuItem carries the template's `enabled`. */
const click = (t: MenuItemConstructorOptions) => t.click!({ enabled: t.enabled ?? true } as never, undefined, {} as never);

beforeEach(() => {
  popups.length = 0;
});

describe('context menu entries (registry + isCommandAvailable)', () => {
  it('an available file: 열기, then Finder에서 보기; a missing linked file: 다시 연결… first (기본 앱으로 열기 never, C-1)', () => {
    expect(ids(contextMenuEntries('item', COMMANDS, LIB, [target('managed', 'available')], 'darwin'))).toEqual(['item.open', '-', 'item.showInFolder']);
    const missing = contextMenuEntries('item', COMMANDS, LIB, [target('linked', 'missing')], 'darwin');
    expect(ids(missing)).toEqual(['item.relink', '-', 'item.open', '-', 'item.showInFolder']);
    expect(missing.at(-1)).toEqual({ id: 'item.showInFolder', label: 'Finder에서 보기', enabled: false }); // no file to reveal
  });
  it('disables (not hides) the other commands that cannot run, and everything while blocked', () => {
    const disabled = [{ id: 'item.open', label: '열기', enabled: false }, 'separator', { id: 'item.showInFolder', label: 'Finder에서 보기', enabled: false }];
    const two = contextMenuEntries('item', COMMANDS, LIB, [target('managed', 'available'), target('managed', 'available')], 'darwin');
    expect(two).toEqual(disabled);
    expect(contextMenuEntries('item', COMMANDS, { ...LIB, blocked: true }, [target('linked', 'missing')], 'darwin')).toEqual(disabled);
  });
  it('names the file manager off macOS (labelOff)', () => {
    expect(contextMenuEntries('item', COMMANDS, LIB, [target('managed', 'available')], 'linux').at(-1)).toEqual({ id: 'item.showInFolder', label: '폴더에서 보기', enabled: true });
  });
  it('kinds without commands yet (collection, tag, column) give no entries', () => {
    for (const kind of ['collection', 'tag', 'column'] as const) expect(contextMenuEntries(kind, COMMANDS, LIB, [], 'darwin')).toEqual([]);
  });
});

describe('popupCommandMenu', () => {
  // Hand-written entries: the popup mechanics do not depend on what the registry holds.
  const entries = [
    { id: 'item.open', label: '열기', enabled: true },
    'separator',
    { id: 'item.relink', label: '다시 연결…', enabled: false },
  ] as const;

  it('pops up at the given point in the given window, with ids, labels, enabled flags and separators', () => {
    void popupCommandMenu(entries, { window: win, x: 10.6, y: 20.2 });
    expect(popups).toHaveLength(1);
    const { template, options } = popups[0]!;
    expect(options).toMatchObject({ window: win, x: 11, y: 20 });
    expect(template.map((t) => (t.type === 'separator' ? 'separator' : { id: t.id, label: t.label, enabled: t.enabled }))).toEqual([
      { id: 'item.open', label: '열기', enabled: true },
      'separator',
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
    click(popups[1]!.template[2]!); // index 1 is the separator
    await expect(disabled).resolves.toBeNull();
  });
});
