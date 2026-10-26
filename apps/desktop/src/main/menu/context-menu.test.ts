import type { BaseWindow, MenuItemConstructorOptions, PopupOptions } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { COMMANDS, NO_LIBRARY_VIEW, type CommandContextState, type CommandTargetInfo } from '@learn/domain';
import { FUTURE_COMMANDS, FUTURE_SUBMENUS, LIBRARY } from './testing';

const popups: Array<{ template: MenuItemConstructorOptions[]; options: PopupOptions }> = [];

vi.mock('electron', () => ({
  Menu: {
    buildFromTemplate: (template: MenuItemConstructorOptions[]) => ({
      popup: (options: PopupOptions) => popups.push({ template, options }),
    }),
  },
  nativeImage: { createFromBuffer: (_png: Buffer, opts: { scaleFactor: number }) => ({ scale: opts.scaleFactor }) },
}));

const { contextMenuEntries, kindHasMenu, popupCommandMenu } = await import('./context-menu');

const LIB: CommandContextState = { view: 'library', blocked: false, textSize: 13, libraryCount: 0, selectionCount: 0, selectionAvailable: 0, selectionRelinkable: 0, ...NO_LIBRARY_VIEW };
const target = (storageMode: 'managed' | 'linked', availability: 'available' | 'missing'): CommandTargetInfo => ({ kind: 'item', storageMode, availability });
const ids = (entries: ReturnType<typeof contextMenuEntries>) => entries.map((e) => (e === 'separator' ? '-' : e.id));
const win = {} as BaseWindow;
/** Electron calls click(menuItem, window, event); the menuItem carries the template's `enabled`. */
const click = (t: MenuItemConstructorOptions) => t.click!({ enabled: t.enabled ?? true } as never, undefined, {} as never);

beforeEach(() => {
  popups.length = 0;
});

describe('context menu entries (registry + isCommandAvailable)', () => {
  it('an available file: 열기, then Finder에서 보기 and 사본 내보내기…; a missing linked file: 다시 연결… first (기본 앱으로 열기 never)', () => {
    expect(ids(contextMenuEntries('item', COMMANDS, LIB, [target('managed', 'available')], 'darwin'))).toEqual(['item.open', '-', 'item.showInFolder', 'item.exportCopy']);
    const missing = contextMenuEntries('item', COMMANDS, LIB, [target('linked', 'missing')], 'darwin');
    expect(ids(missing)).toEqual(['item.relink', '-', 'item.open', '-', 'item.showInFolder', 'item.exportCopy']);
    // No file to reveal or copy.
    expect(missing.slice(-2)).toEqual([
      { id: 'item.showInFolder', label: 'Finder에서 보기', enabled: false },
      { id: 'item.exportCopy', label: '사본 내보내기…', enabled: false },
    ]);
  });
  it('disables (not hides) the other commands that cannot run, and everything while blocked', () => {
    const disabled = [{ id: 'item.open', label: '열기', enabled: false }, 'separator', { id: 'item.showInFolder', label: 'Finder에서 보기', enabled: false }, { id: 'item.exportCopy', label: '사본 내보내기…', enabled: false }];
    const two = contextMenuEntries('item', COMMANDS, LIB, [target('managed', 'available'), target('managed', 'available')], 'darwin');
    expect(two).toEqual(disabled);
    expect(contextMenuEntries('item', COMMANDS, { ...LIB, blocked: true }, [target('linked', 'missing')], 'darwin')).toEqual(disabled);
  });
  it('names the file manager off macOS (labelOff)', () => {
    expect(contextMenuEntries('item', COMMANDS, LIB, [target('managed', 'available')], 'linux').at(-2)).toEqual({ id: 'item.showInFolder', label: '폴더에서 보기', enabled: true });
  });
  it('kinds without commands yet (tag, column) give no entries and say so', () => {
    for (const kind of ['tag', 'column'] as const) {
      expect(contextMenuEntries(kind, COMMANDS, LIB, [], 'darwin')).toEqual([]);
      expect(kindHasMenu(kind, COMMANDS), kind).toBe(false);
    }
    expect(kindHasMenu('item', COMMANDS)).toBe(true);
    expect(kindHasMenu('collection', COMMANDS)).toBe(true);
    expect(kindHasMenu('collection', FUTURE_COMMANDS, FUTURE_SUBMENUS)).toBe(true); // a kind a command or a group lists is a menu
    expect(kindHasMenu('tag', FUTURE_COMMANDS, FUTURE_SUBMENUS)).toBe(true);
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
    await expect(a).resolves.toEqual({ commandId: 'item.open' });

    const b = popupCommandMenu(entries, { window: win, x: 0, y: 0 });
    popups[1]!.options.callback!();
    click(popups[1]!.template[0]!);
    await expect(b).resolves.toEqual({ commandId: 'item.open' });
  });

  it('resolves via an item click alone (a stubbed popup never calls the callback)', async () => {
    const p = popupCommandMenu(entries, { window: win, x: 0, y: 0 });
    click(popups[0]!.template[0]!);
    await expect(p).resolves.toEqual({ commandId: 'item.open' });
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

describe('submenus, marks and values in a context menu (spec 9.1, 9.2)', () => {
  const ONE: CommandContextState = { ...LIB, libraryCount: 9, selectionCount: 1, selectionAvailable: 1 };
  const available = [target('managed', 'available')];
  const item = (itemIds: readonly string[], over: Partial<CommandContextState> = {}, targets: CommandTargetInfo[] = available, organize: typeof LIBRARY | null = LIBRARY) =>
    contextMenuEntries('item', FUTURE_COMMANDS, { ...ONE, ...over }, targets, 'darwin', { organize, itemIds, submenus: FUTURE_SUBMENUS });
  /** A menu as readable lines: "라벨 [단축키] ✓(체크) ✗(꺼짐)", a submenu as { 라벨: [...] }. */
  type Line = string | { [label: string]: Line[] };
  const lines = (entries: ReturnType<typeof item>): Line[] =>
    entries.map((e): Line => {
      if (e === 'separator') return '-';
      if ('submenu' in e) return { [`${e.label}${e.enabled ? '' : ' ✗'}`]: lines(e.submenu) };
      return `${e.label}${e.hint ? ` [${e.hint}]` : ''}${e.checked ? ' ✓' : ''}${e.enabled ? '' : ' ✗'}`;
    });
  const NEW = '새\u00a0컬렉션';

  it('the item menu: 열기, the file commands, then 컬렉션에 추가 ▸ and 색 태그 ▸ in the group after them (spec 9.2)', () => {
    expect(lines(item(['i1']))).toEqual([
      '열기', '-', 'Finder에서 보기', '사본 내보내기…', '-',
      { '컬렉션에 추가': [NEW, '-', { 분자생물학: ['분자생물학 ✓ ✗', '-', '2장', '10장', '유전학'] }, '시험 ✓ ✗'] },
      { '색 태그': ['시험 범위 [1] ✓', '중요 [3] ✓'] },
    ]);
  });
  it('the marks follow the whole selection: a collection or tag some of the items lack is not marked, one that all have is', () => {
    expect(lines(item(['i1', 'i2'], { selectionCount: 2, selectionAvailable: 2 }, [...available, ...available])).slice(-2)).toEqual([
      { '컬렉션에 추가': [NEW, '-', { 분자생물학: ['분자생물학 ✓ ✗', '-', '2장', '10장', '유전학'] }, '시험'] },
      { '색 태그': ['시험 범위 [1]', '중요 [3] ✓'] },
    ]);
  });
  it('a submenu is greyed with its command (a blocked window), and a group with no colour tag is left out with its separator', () => {
    const blocked = lines(item(['i1'], { blocked: true }));
    expect(blocked.at(-2)).toEqual({ '컬렉션에 추가 ✗': [`${NEW} ✗`, '-', { '분자생물학 ✗': ['분자생물학 ✓ ✗', '-', '2장 ✗', '10장 ✗', '유전학 ✗'] }, '시험 ✓ ✗'] });
    expect(blocked.at(-1)).toEqual({ '색 태그 ✗': ['시험 범위 [1] ✓ ✗', '중요 [3] ✓ ✗'] });
    expect(lines(item(['i1'], {}, available, { ...LIBRARY, tags: [] }))).toEqual([
      '열기', '-', 'Finder에서 보기', '사본 내보내기…', '-',
      { '컬렉션에 추가': [NEW, '-', { 분자생물학: ['분자생물학 ✓ ✗', '-', '2장', '10장', '유전학'] }, '시험 ✓ ✗'] },
    ]);
  });
  it('a library that was not read gives no 컬렉션에 추가 ▸ and no 색 태그 ▸, and no stray separator', () => {
    expect(lines(item(['i1'], {}, available, null))).toEqual(['열기', '-', 'Finder에서 보기', '사본 내보내기…']);
  });
  it('a tag menu: 색 지정 ▸ for the one tag, the colours as radios with a dot', () => {
    const entries = contextMenuEntries('tag', FUTURE_COMMANDS, LIB, [{ kind: 'tag', id: 't-key', hasColor: true }], 'darwin', { organize: LIBRARY, tagId: 't-key' });
    expect(entries).toHaveLength(1);
    const [head] = entries as unknown as [{ label: string; enabled: boolean; submenu: Array<{ label: string; type: string; checked: boolean; dot: string }> }];
    expect(head).toMatchObject({ label: '색 지정', enabled: true });
    expect(head.submenu.map((r) => [r.label, r.checked])).toEqual([
      ['1 노랑 — 시험 범위', false], ['2 빨강', false], ['3 초록', true], ['4 파랑', false], ['5 보라', false], ['6 자홍', false], ['7 주황', false], ['8 회색', false],
    ]);
    expect(head.submenu.every((r) => r.type === 'radio' && /^#[0-9a-f]{6}$/.test(r.dot))).toBe(true);
    // No tag target: the tag context is off, and the head is greyed with it.
    expect(contextMenuEntries('tag', FUTURE_COMMANDS, LIB, [], 'darwin', { organize: LIBRARY, tagId: 't-key' })[0]).toMatchObject({ enabled: false });
  });
});

describe('popup: marks, values, submenus and colour dots reach the native template', () => {
  it('builds radios, checkboxes, a display-only shortcut, nested submenus and an icon; the pick carries the row\'s value', async () => {
    const picked = popupCommandMenu(
      [
        { id: 'library.sortBy', label: '연도', enabled: true, args: { column: 'year' }, type: 'radio', checked: true },
        { label: '분자생물학', enabled: true, submenu: [{ id: 'collection.addItems' as never, label: '분자생물학', enabled: true, args: { collectionId: 'c-mb' } }] },
        { id: 'tag.color1' as never, label: '중요', enabled: true, hint: '1', type: 'checkbox', checked: false },
        { id: 'tag.setColor' as never, label: '3 초록', enabled: true, args: { position: 3 }, dot: '#5fb236' },
      ],
      { window: win, x: 1, y: 2 },
    );
    const { template } = popups[0]!;
    expect(template[0]).toMatchObject({ id: 'library.sortBy?column=year', type: 'radio', checked: true });
    expect(template[2]).toMatchObject({ type: 'checkbox', accelerator: '1', registerAccelerator: false });
    expect(template[3]).toMatchObject({ icon: { scale: 2 } });
    click((template[1]!.submenu as MenuItemConstructorOptions[])[0]!);
    await expect(picked).resolves.toEqual({ commandId: 'collection.addItems', args: { collectionId: 'c-mb' } });
  });
});
