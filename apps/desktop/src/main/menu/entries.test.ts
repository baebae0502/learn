import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import type { CommandId } from '@learn/domain';
import { entriesToTemplate, entryItemId, isSubmenu, type MenuEntries } from './entries';

const id = (s: string) => s as CommandId;
/** Electron calls click(menuItem, window, event); the menuItem carries the template's `enabled`. */
const click = (t: MenuItemConstructorOptions) => t.click!({ enabled: t.enabled ?? true } as never, undefined, {} as never);

const ENTRIES: MenuEntries = [
  { id: id('library.sortBy'), label: '연도', enabled: true, args: { column: 'year' }, type: 'radio', checked: true },
  { id: id('library.sortBy'), label: '오름차순', enabled: false, args: { direction: 'asc' }, type: 'radio', checked: false },
  'separator',
  { id: 'submenu.colorTags', label: '색 태그', enabled: true, submenu: [{ id: id('tag.color1'), label: '중요', enabled: true, hint: '1', type: 'checkbox', checked: true }] },
  { label: '분자생물학', enabled: true, submenu: [{ id: id('collection.addItems'), label: '분자생물학', enabled: true, args: { collectionId: 'c1' } }] },
  { id: id('tag.setColor'), label: '3 초록', enabled: true, args: { position: 3 }, dot: '#5fb236' },
  { id: id('item.open'), label: '열기', enabled: true },
];

describe('menu entries as a native template', () => {
  it('names a row by its command and its value, and keeps only what the row carries', () => {
    const t = entriesToTemplate(ENTRIES, vi.fn(), { dotIcon: (hex) => `icon:${hex}` as never });
    expect(t).toEqual([
      { id: 'library.sortBy?column=year', label: '연도', enabled: true, type: 'radio', checked: true, click: expect.any(Function) },
      { id: 'library.sortBy?direction=asc', label: '오름차순', enabled: false, type: 'radio', checked: false, click: expect.any(Function) },
      { type: 'separator' },
      // A shortcut only shown: the renderer's key map owns the key, a registered accelerator would take it from a text field.
      {
        id: 'submenu.colorTags', label: '색 태그', enabled: true,
        submenu: [{ id: 'tag.color1', label: '중요', enabled: true, type: 'checkbox', checked: true, accelerator: '1', registerAccelerator: false, click: expect.any(Function) }],
      },
      { label: '분자생물학', enabled: true, submenu: [{ id: 'collection.addItems?collectionId=c1', label: '분자생물학', enabled: true, click: expect.any(Function) }] },
      { id: 'tag.setColor?position=3', label: '3 초록', enabled: true, icon: 'icon:#5fb236', click: expect.any(Function) },
      { id: 'item.open', label: '열기', enabled: true, click: expect.any(Function) },
    ]);
  });
  it('draws no icon when none can be made (the template stays free of the Electron runtime)', () => {
    expect(entriesToTemplate([ENTRIES[5]!], vi.fn())[0]).not.toHaveProperty('icon');
  });
  it('a click answers the command, with its value only when the row has one; a disabled row answers null', () => {
    const pick = vi.fn();
    const t = entriesToTemplate(ENTRIES, pick);
    click(t[0]!);
    click(t[6]!);
    click((t[3]!.submenu as MenuItemConstructorOptions[])[0]!);
    click((t[4]!.submenu as MenuItemConstructorOptions[])[0]!);
    click(t[1]!); // enabled: false
    expect(pick.mock.calls).toEqual([
      [{ commandId: 'library.sortBy', args: { column: 'year' } }],
      [{ commandId: 'item.open' }],
      [{ commandId: 'tag.color1' }],
      [{ commandId: 'collection.addItems', args: { collectionId: 'c1' } }],
      [null],
    ]);
    expect(pick.mock.calls[1]![0]).not.toHaveProperty('args');
  });
  const colorRow = (opts: Parameters<typeof entriesToTemplate>[2], pick = vi.fn()) =>
    (entriesToTemplate(ENTRIES, pick, opts)[3]!.submenu as MenuItemConstructorOptions[])[0]!;
  it('the menu bar on darwin carries no key for a hint row (macOS would make it a key equivalent that swallows the digit); elsewhere it is display only', () => {
    const mac = colorRow({ surface: 'menubar', platform: 'darwin' });
    expect(mac).not.toHaveProperty('accelerator');
    expect(mac).not.toHaveProperty('registerAccelerator');
    expect(colorRow({ surface: 'menubar', platform: 'linux' })).toMatchObject({ accelerator: '1', registerAccelerator: false });
    expect(colorRow({ surface: 'menubar', platform: 'win32' })).toMatchObject({ accelerator: '1', registerAccelerator: false });
  });
  it('a popup keeps the shown digit on every platform', () => {
    expect(colorRow({ surface: 'popup', platform: 'darwin' })).toMatchObject({ accelerator: '1', registerAccelerator: false });
    expect(colorRow({ surface: 'popup', platform: 'linux' })).toMatchObject({ accelerator: '1', registerAccelerator: false });
  });
  it('a menu-bar hint row ignores a pick the system made with its key (the renderer\'s key map owns the digit), and still answers the mouse', () => {
    const pick = vi.fn();
    const row = colorRow({ surface: 'menubar', platform: 'linux' }, pick);
    const press = (event: object) => row.click!({ enabled: true } as never, undefined, event as never);
    press({ triggeredByAccelerator: true });
    expect(pick.mock.calls).toEqual([[null]]);
    press({ triggeredByAccelerator: false });
    press({});
    expect(pick.mock.calls.slice(1)).toEqual([[{ commandId: 'tag.color1' }], [{ commandId: 'tag.color1' }]]);
    // A row without a hint has no key of its own to ignore.
    const plain = entriesToTemplate([ENTRIES[6]!], pick, { surface: 'menubar', platform: 'linux' })[0]!;
    plain.click!({ enabled: true } as never, undefined, { triggeredByAccelerator: true } as never);
    expect(pick.mock.calls.at(-1)).toEqual([{ commandId: 'item.open' }]);
  });
  it('a popup is modal while open, so a pick made with the digit is a real pick and runs', () => {
    const pick = vi.fn();
    colorRow({ surface: 'popup', platform: 'darwin' }, pick).click!({ enabled: true } as never, undefined, { triggeredByAccelerator: true } as never);
    expect(pick.mock.calls).toEqual([[{ commandId: 'tag.color1' }]]);
  });
  it('tells a submenu from a command, and names a row the way menuItemId does', () => {
    expect(isSubmenu(ENTRIES[3] as never)).toBe(true);
    expect(isSubmenu(ENTRIES[0] as never)).toBe(false);
    expect(entryItemId({ id: id('library.sortBy'), label: '연도', enabled: true, args: { direction: 'asc', column: 'year' } })).toBe('library.sortBy?column=year&direction=asc');
  });
});
