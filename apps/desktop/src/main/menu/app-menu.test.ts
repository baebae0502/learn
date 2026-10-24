import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { COMMANDS, acceleratorLabel, availableMenuCommands, commandById, platformAccelerator, type CommandContextState, type CommandId, type CommandSpec } from '@learn/domain';
import { FULL_SCREEN, applyFullScreenItem, applyMenuEnabled, applyMenuLabels, buildAppMenu, menuItemIds, menuLabelState, menuLabelsChanged } from './app-menu';

interface Shape {
  label?: string;
  role?: string;
  accelerator?: string;
  id?: string;
  type?: string;
  submenu?: Shape[];
}

const shape = (items: MenuItemConstructorOptions[]): Shape[] =>
  items.map((i) => {
    const s: Shape = {};
    if (i.type === 'separator') return { type: 'separator' };
    if (i.id) s.id = i.id;
    if (i.label) s.label = i.label;
    if (i.role) s.role = i.role;
    if (i.accelerator) s.accelerator = String(i.accelerator);
    if (Array.isArray(i.submenu)) s.submenu = shape(i.submenu);
    return s;
  });

const walk = (items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] =>
  items.flatMap((i) => [i, ...(Array.isArray(i.submenu) ? walk(i.submenu) : [])]);

const ALL = new Set(COMMANDS.map((c) => c.id));
const build = (
  platform: NodeJS.Platform,
  isDev = false,
  onCommand = vi.fn(),
  enabled: ReadonlySet<CommandId> = ALL,
  commands: readonly CommandSpec[] = COMMANDS,
) => buildAppMenu({ isDev, platform, commands, enabled, onCommand });

const SEP = { type: 'separator' };
/** ⌘, (S-2): the macOS app menu after Learn에 관하여; at the end of 파일 elsewhere. */
const SETTINGS: Shape = { id: 'app.settings', label: '설정…', accelerator: 'CmdOrCtrl+,' };

const FILE = (platform: NodeJS.Platform): Shape => ({
  id: 'menu.file', label: '파일', submenu: [
    { id: 'file.importManaged', label: '파일 가져오기…', accelerator: 'CmdOrCtrl+O' },
    { id: 'file.importLinked', label: '외부 파일 연결…', accelerator: 'Alt+CmdOrCtrl+O' },
    SEP,
    // The selected item's commands (design-spec 7.4 ⇧⌘R); the gap at order 2 is left for the copy export.
    { id: 'item.showInFolder', label: platform === 'darwin' ? 'Finder에서 보기' : '폴더에서 보기', accelerator: 'Shift+CmdOrCtrl+R' },
    { id: 'item.openExternally', label: '기본 앱으로 열기' },
    SEP,
    ...(platform === 'darwin' ? [] : [SETTINGS, SEP]),
    // Apple Korean on macOS (the menu bar title is 윈도우); 창 elsewhere.
    { label: platform === 'darwin' ? '윈도우 닫기' : '창 닫기', role: 'close', accelerator: 'CmdOrCtrl+W' },
  ],
});
const EDIT: Shape = {
  id: 'menu.edit', label: '편집', submenu: [
    { label: '실행 취소', role: 'undo' },
    { label: '실행 복귀', role: 'redo' },
    SEP,
    { label: '오려두기', role: 'cut' },
    { label: '복사하기', role: 'copy' },
    { label: '붙여넣기', role: 'paste' },
    { label: '모두 선택', role: 'selectAll' },
    SEP,
    { id: 'library.find', label: '빠른 검색', accelerator: 'CmdOrCtrl+F' },
  ],
};
const VIEW = (platform: NodeJS.Platform): Shape => ({
  id: 'menu.view', label: '보기', submenu: [
    { id: 'app.palette', label: '명령 팔레트…', accelerator: 'CmdOrCtrl+K' },
    SEP,
    { id: 'view.toggleSidebar', label: '사이드바 보기/가리기', accelerator: platformAccelerator('Ctrl+Cmd+S', platform) },
    SEP,
    // ⌘+ / ⌘− / ⌘0; #1 is ⌘+'s hidden ⌘= twin (shape() does not carry `visible`).
    { id: 'view.textBigger', label: '글자 크게', accelerator: 'CmdOrCtrl+Plus' },
    { id: 'view.textBigger#1', label: '글자 크게', accelerator: 'CmdOrCtrl+=' },
    { id: 'view.textSmaller', label: '글자 작게', accelerator: 'CmdOrCtrl+-' },
    { id: 'view.textReset', label: '기본 글자 크기', accelerator: 'CmdOrCtrl+0' },
    SEP,
    // macOS: our item names what it will do (Apple Korean); elsewhere the neutral role item.
    platform === 'darwin' ? { id: 'menu.view.fullScreen', label: '전체 화면 시작', accelerator: 'Ctrl+Cmd+F' } : { label: '전체 화면', role: 'togglefullscreen' },
  ],
});
const GO: Shape = {
  id: 'menu.go', label: '이동', submenu: [{ id: 'nav.back', label: '라이브러리로 돌아가기', accelerator: 'CmdOrCtrl+1' }],
};
const HELP = (platform: NodeJS.Platform): Shape => ({
  id: 'menu.help', label: '도움말', role: 'help', submenu: [
    { id: 'app.shortcuts', label: '단축키 도움말', accelerator: 'CmdOrCtrl+/' },
    ...(platform === 'darwin' ? [] : [SEP, { label: 'Learn 정보', role: 'about' }]),
  ],
});

describe('buildAppMenu', () => {
  it('macOS: Learn app menu + 파일/편집/보기/이동/윈도우/도움말, Korean labels', () => {
    expect(shape(build('darwin'))).toEqual([
      {
        id: 'menu.app', label: 'Learn', submenu: [
          { label: 'Learn에 관하여', role: 'about' },
          SEP,
          SETTINGS,
          SEP,
          { label: '서비스', role: 'services' },
          SEP,
          { label: 'Learn 가리기', role: 'hide' },
          { label: '기타 가리기', role: 'hideOthers' },
          { label: '모두 보기', role: 'unhide' },
          SEP,
          { label: 'Learn 종료', role: 'quit' },
        ],
      },
      FILE('darwin'),
      EDIT,
      VIEW('darwin'),
      GO,
      {
        id: 'menu.window', label: '윈도우', role: 'windowMenu', submenu: [
          { label: '최소화', role: 'minimize' },
          { label: '확대/축소', role: 'zoom' },
          SEP,
          { label: '모두 앞으로 가져오기', role: 'front' },
        ],
      },
      HELP('darwin'),
    ]);
  });

  it('Linux/Windows: same menus without the macOS app menu', () => {
    for (const platform of ['linux', 'win32'] as const) {
      expect(shape(build(platform))).toEqual([
        FILE(platform),
        EDIT,
        VIEW(platform),
        GO,
        { id: 'menu.window', label: '윈도우', role: 'windowMenu', submenu: [{ label: '최소화', role: 'minimize' }] },
        HELP(platform),
      ]);
    }
  });

  it('Linux and Windows get Learn 정보 at the end of 도움말', () => {
    for (const platform of ['linux', 'win32'] as const) {
      expect(shape(build(platform)).find((m) => m.id === 'menu.help')!.submenu!.map((s) => s.label ?? s.type), platform).toEqual(['단축키 도움말', 'separator', 'Learn 정보']);
    }
    expect(shape(build('darwin')).find((m) => m.id === 'menu.help')!.submenu!.map((s) => s.label ?? s.type)).toEqual(['단축키 도움말']);
  });

  it('never offers Reload / Force Reload; DevTools only in a dev build', () => {
    for (const platform of ['darwin', 'linux', 'win32'] as const) {
      for (const isDev of [false, true]) {
        const roles = walk(build(platform, isDev)).map((i) => String(i.role ?? '').toLowerCase());
        expect(roles).not.toContain('reload');
        expect(roles).not.toContain('forcereload');
        expect(roles.includes('toggledevtools')).toBe(isDev);
      }
    }
    const view = build('darwin', true).find((m) => m.id === 'menu.view')!;
    expect(shape(view.submenu as MenuItemConstructorOptions[])).toEqual([...VIEW('darwin').submenu!, SEP, { label: '개발자 도구', role: 'toggleDevTools' }]);
  });

  it('every label is Korean except the app name', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      for (const item of walk(build(platform, true))) {
        if (item.type === 'separator' || item.label === 'Learn') continue;
        expect(item.label, JSON.stringify(item)).toMatch(/[가-힣]/);
      }
    }
  });

  it('places each registry command with a menu exactly once, with its label and accelerator', () => {
    const items = walk(build('darwin'));
    for (const c of COMMANDS) {
      const found = items.filter((i) => i.id === c.id);
      expect(found, c.id).toHaveLength(c.menu ? 1 : 0);
      if (found[0]) {
        expect(found[0].label).toBe(c.label);
        expect(found[0].accelerator).toBe(c.accelerator);
      }
    }
  });

  it('a registry item click dispatches its command id (and nothing else)', () => {
    const onCommand = vi.fn();
    const items = walk(build('linux', false, onCommand));
    const back = items.find((i) => i.id === 'nav.back')!;
    back.click!({} as never, undefined, {} as never);
    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(onCommand).toHaveBeenCalledWith('nav.back');
    // Role items act natively; they never route through the registry.
    expect(items.filter((i) => i.role).every((i) => i.click === undefined)).toBe(true);
  });

  it('orders registry items by group then order, with separators between groups and after built-ins', () => {
    const commands: CommandSpec[] = [
      { id: 'nav.back', label: '셋', menu: { menu: 'go', group: 2, order: 1 }, contexts: ['viewer'] },
      { id: 'file.importLinked', label: '둘', menu: { menu: 'go', group: 1, order: 2 }, contexts: ['library'] },
      { id: 'file.importManaged', label: '하나', menu: { menu: 'go', group: 1, order: 1 }, contexts: ['library'] },
      { id: 'item.open', label: '편집 명령', menu: { menu: 'edit', group: 1, order: 1 }, contexts: ['library'] },
    ];
    const menu = buildAppMenu({ isDev: false, platform: 'linux', commands, enabled: new Set(commands.map((c) => c.id)), onCommand: vi.fn() });
    const go = shape(menu.find((m) => m.id === 'menu.go')!.submenu as MenuItemConstructorOptions[]);
    expect(go.map((i) => i.label ?? i.type)).toEqual(['하나', '둘', 'separator', '셋']);
    const edit = shape(menu.find((m) => m.id === 'menu.edit')!.submenu as MenuItemConstructorOptions[]);
    expect(edit.slice(-2).map((i) => i.label ?? i.type)).toEqual(['separator', '편집 명령']);
    // No registry items → the file menu has no leading separator.
    const file = shape(menu.find((m) => m.id === 'menu.file')!.submenu as MenuItemConstructorOptions[]);
    expect(file).toEqual([{ label: '창 닫기', role: 'close', accelerator: 'CmdOrCtrl+W' }]);
  });
});

describe('menu state and placement (M3)', () => {
  const item = (menu: MenuItemConstructorOptions[], id: string) => walk(menu).find((i) => i.id === id);

  it('enables only the commands available in the reported context', () => {
    const menu = build('darwin', false, vi.fn(), new Set<CommandId>(['file.importManaged']));
    expect(item(menu, 'file.importManaged')?.enabled).toBe(true);
    expect(item(menu, 'file.importLinked')?.enabled).toBe(false);
    expect(item(menu, 'nav.back')?.enabled).toBe(false);
  });
  it('keeps the main-owned 설정… enabled with nothing else available (before the first report, the fatal screen)', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      const menu = build(platform, false, vi.fn(), new Set());
      expect(item(menu, 'app.settings')?.enabled, platform).toBe(true);
      expect(item(menu, 'file.importManaged')?.enabled, platform).toBe(false);
      expect(item(menu, 'view.textBigger#1')?.enabled, platform).toBe(false);
    }
  });
  it('puts "app" commands in the macOS app menu, at the end of 파일 elsewhere', () => {
    const extra: CommandSpec = { id: 'nav.back', label: '설정…', accelerator: 'CmdOrCtrl+,', menu: { menu: 'app', group: 2, order: 1 }, contexts: ['app'] };
    expect(shape(build('darwin', false, vi.fn(), ALL, [extra]))[0]!.submenu!.map((s) => s.label ?? s.type)).toEqual([
      'Learn에 관하여', 'separator', '설정…', 'separator', '서비스', 'separator', 'Learn 가리기', '기타 가리기', '모두 보기', 'separator', 'Learn 종료',
    ]);
    expect(shape(build('linux', false, vi.fn(), ALL, [extra])).find((m) => m.id === 'menu.file')!.submenu!.map((s) => s.label ?? s.type)).toEqual(['설정…', 'separator', '창 닫기']);
  });
  it('maps ⌃⌘ for Linux, uses the platform label, and gives ⌘+ a hidden ⌘= twin', () => {
    const cmds: CommandSpec[] = [
      { id: 'file.importManaged', label: 'Finder에서 보기', labelOff: '파일 관리자에서 보기', accelerator: 'Ctrl+Cmd+S', menu: { menu: 'view', group: 1, order: 1 }, contexts: ['app'] },
      { id: 'file.importLinked', label: '크게', accelerator: 'CmdOrCtrl+Plus', menu: { menu: 'view', group: 2, order: 1 }, contexts: ['app'] },
    ];
    const linux = build('linux', false, vi.fn(), ALL, cmds);
    expect(item(linux, 'file.importManaged')).toMatchObject({ accelerator: 'Ctrl+Shift+S', label: '파일 관리자에서 보기' });
    expect(item(build('darwin', false, vi.fn(), ALL, cmds), 'file.importManaged')).toMatchObject({ accelerator: 'Ctrl+Cmd+S', label: 'Finder에서 보기' });
    expect(item(linux, 'file.importLinked#1')).toMatchObject({ visible: false, accelerator: 'CmdOrCtrl+=', label: '크게', enabled: true });
    // The twin follows its command's availability (⌘= must not run a command ⌘+ cannot).
    expect(item(build('linux', false, vi.fn(), new Set<CommandId>(), cmds), 'file.importLinked#1')?.enabled).toBe(false);
  });
  it('leaves out top-level menus with nothing in them', () => {
    // A fixed command list: later tasks add 도움말 commands without touching this test.
    expect(shape(build('darwin', false, vi.fn(), ALL, [commandById('nav.back')])).map((m) => m.label)).toEqual(['Learn', '파일', '편집', '보기', '이동', '윈도우']);
    expect(shape(build('darwin', false, vi.fn(), ALL, [])).map((m) => m.label)).toEqual(['Learn', '파일', '편집', '보기', '윈도우']);
  });
});

describe('state labels (design-spec 7.4: the menu names what ⌃⌘S does now)', () => {
  const sidebarItem = (menu: MenuItemConstructorOptions[]) => walk(menu).find((i) => i.id === 'view.toggleSidebar')!;
  it('builds with the reported sidebar state, and the neutral name before the first report', () => {
    for (const platform of ['darwin', 'linux', 'win32'] as const) {
      const shown = buildAppMenu({ isDev: false, platform, commands: COMMANDS, enabled: ALL, onCommand: vi.fn(), labels: { sidebar: 'shown' } });
      const hidden = buildAppMenu({ isDev: false, platform, commands: COMMANDS, enabled: ALL, onCommand: vi.fn(), labels: { sidebar: 'hidden' } });
      expect(sidebarItem(shown).label, platform).toBe('사이드바 가리기');
      expect(sidebarItem(hidden).label, platform).toBe('사이드바 보기');
      expect(sidebarItem(build(platform)).label, platform).toBe('사이드바 보기/가리기');
    }
  });
  it('relabels in place: same id, accelerator and enabled state; other items untouched', () => {
    const template = buildAppMenu({ isDev: false, platform: 'darwin', commands: COMMANDS, enabled: ALL, onCommand: vi.fn(), labels: { sidebar: 'shown' } });
    const byId = new Map(walk(template).flatMap((i) => (i.id ? [[i.id, i] as const] : [])));
    const before = walk(template).map((i) => ({ id: i.id, label: i.label, accelerator: i.accelerator, enabled: i.enabled }));
    applyMenuLabels({ getMenuItemById: (id) => byId.get(id) ?? null }, 'darwin', { sidebar: 'hidden' });
    const after = walk(template).map((i) => ({ id: i.id, label: i.label, accelerator: i.accelerator, enabled: i.enabled }));
    expect(after).toEqual(before.map((i) => (i.id === 'view.toggleSidebar' ? { ...i, label: '사이드바 보기' } : i)));
    applyMenuLabels({ getMenuItemById: (id) => byId.get(id) ?? null }, 'darwin', { sidebar: 'shown' });
    expect(sidebarItem(template)).toMatchObject({ id: 'view.toggleSidebar', label: '사이드바 가리기', accelerator: 'Ctrl+Cmd+S' });
  });
});

describe('both panes\' state labels and the menu bar\'s item commands (P-2, P-3)', () => {
  const byIdOf = (template: MenuItemConstructorOptions[]) => new Map(walk(template).flatMap((i) => (i.id ? [[i.id, i] as const] : [])));
  /** The item panel's toggle as the item panel will add it, under a stand-in id. */
  const panel: CommandSpec = {
    id: 'nav.back', label: '항목 패널 보기/가리기', stateLabels: { inspector: { shown: '항목 패널 가리기', hidden: '항목 패널 보기' } },
    menu: { menu: 'view', group: 2, order: 2 }, contexts: ['library'],
  };
  const toggles: CommandSpec[] = [commandById('view.toggleSidebar'), panel];
  const base: CommandContextState = {
    view: 'library', blocked: false, textSize: 13, sidebar: 'shown', inspector: 'shown', libraryCount: 0, selectionCount: 0, selectionAvailable: 0, selectionRelinkable: 0,
  };
  const next = (over: Partial<CommandContextState>): CommandContextState => ({ ...base, ...over });

  it('keeps the pane states a report names, and only those', () => {
    expect(menuLabelState(base)).toEqual({ sidebar: 'shown', inspector: 'shown' });
    expect(menuLabelState(next({ inspector: undefined }))).toEqual({ sidebar: 'shown' }); // the reader has no item panel
    expect(menuLabelState(next({ sidebar: undefined, inspector: undefined }))).toEqual({}); // the fatal screen
  });
  it('relabels when the sidebar or the item panel changed, never for a change of counts', () => {
    expect(menuLabelsChanged(base, next({ sidebar: 'hidden' }))).toBe(true);
    expect(menuLabelsChanged(base, next({ inspector: 'hidden' }))).toBe(true);
    expect(menuLabelsChanged(base, next({ inspector: undefined }))).toBe(true);
    expect(menuLabelsChanged(base, next({ libraryCount: 4, selectionCount: 2, selectionAvailable: 2, selectionRelinkable: 0 }))).toBe(false);
    expect(menuLabelsChanged(base, next({ view: 'viewer', blocked: true, textSize: 15 }))).toBe(false);
  });
  it('builds and relabels each toggle from its own pane state, in place', () => {
    const template = buildAppMenu({ isDev: false, platform: 'darwin', commands: toggles, enabled: ALL, onCommand: vi.fn(), labels: { sidebar: 'shown', inspector: 'hidden' } });
    const byId = byIdOf(template);
    const lookup = { getMenuItemById: (id: string) => byId.get(id) ?? null };
    expect(byId.get('view.toggleSidebar')?.label).toBe('사이드바 가리기');
    expect(byId.get('nav.back')?.label).toBe('항목 패널 보기');
    applyMenuLabels(lookup, 'darwin', { sidebar: 'shown', inspector: 'shown' }, toggles);
    expect(byId.get('view.toggleSidebar')?.label).toBe('사이드바 가리기');
    expect(byId.get('nav.back')?.label).toBe('항목 패널 가리기');
    applyMenuLabels(lookup, 'darwin', { sidebar: 'hidden' }, toggles);
    expect(byId.get('view.toggleSidebar')?.label).toBe('사이드바 보기');
    expect(byId.get('nav.back')?.label).toBe('항목 패널 보기/가리기'); // no state: the neutral name
  });
  it('enables a menu-bar item command from the reported selection, in place, never in the reader (P-2, spec 6)', () => {
    // No item command has a menu placement yet (the 파일 menu's item commands come later): a variant of the registry stands in.
    const placed: CommandSpec[] = [{ ...commandById('item.showInFolder'), menu: { menu: 'file', group: 2, order: 1 } }];
    const selecting = (selectionCount: number, selectionAvailable: number, view: CommandContextState['view'] = 'library') =>
      next({ view, libraryCount: 9, selectionCount, selectionAvailable });
    const template = build('darwin', false, vi.fn(), new Set(availableMenuCommands(base, placed)), placed);
    const byId = byIdOf(template);
    const lookup = { getMenuItemById: (id: string) => byId.get(id) ?? null };
    expect(byId.get('item.showInFolder')).toMatchObject({ label: 'Finder에서 보기', enabled: false });
    applyMenuEnabled(lookup, new Set(availableMenuCommands(selecting(1, 1), placed)), placed);
    expect(byId.get('item.showInFolder')?.enabled).toBe(true);
    for (const off of [selecting(2, 2), selecting(1, 0), selecting(1, 1, 'viewer')]) {
      applyMenuEnabled(lookup, new Set(availableMenuCommands(off, placed)), placed);
      expect(byId.get('item.showInFolder')?.enabled, JSON.stringify(off)).toBe(false);
    }
  });
});

describe('macOS 전체 화면 item (Task 8 R2-1)', () => {
  const view = (fullScreenState = false, onToggleFullScreen = vi.fn()) =>
    buildAppMenu({ isDev: false, platform: 'darwin', commands: COMMANDS, enabled: ALL, onCommand: vi.fn(), fullScreenState, onToggleFullScreen }).find((m) => m.id === 'menu.view')!.submenu as MenuItemConstructorOptions[];
  it('is our own item on ⌃⌘F, no role (AppKit showed a second copy of the role item), named by what it will do', () => {
    const onToggle = vi.fn();
    const item = walk(view(false, onToggle)).find((i) => i.id === FULL_SCREEN.id)!;
    expect(item).toMatchObject({ label: '전체 화면 시작', accelerator: 'Ctrl+Cmd+F' });
    expect(item.role).toBeUndefined();
    item.click!({} as never, undefined, {} as never);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(walk(view(true)).find((i) => i.id === FULL_SCREEN.id)?.label).toBe('전체 화면 종료');
    expect(walk(view()).filter((i) => i.label?.includes('전체 화면'))).toHaveLength(1);
  });
  it('follows the main window in place on macOS only: label by state, disabled without a main window or under a sheet', () => {
    const template = buildAppMenu({ isDev: false, platform: 'darwin', commands: COMMANDS, enabled: ALL, onCommand: vi.fn() });
    const byId = new Map(walk(template).flatMap((i) => (i.id ? [[i.id, i] as const] : [])));
    const lookup = { getMenuItemById: (id: string) => byId.get(id) ?? null };
    applyFullScreenItem(lookup, 'darwin', { available: true, fullscreen: true });
    expect(byId.get(FULL_SCREEN.id)).toMatchObject({ label: '전체 화면 종료', accelerator: 'Ctrl+Cmd+F', enabled: true });
    // The window closed in full screen and a new one opened: re-derived from the new window, never the old 종료.
    applyFullScreenItem(lookup, 'darwin', { available: true, fullscreen: false });
    expect(byId.get(FULL_SCREEN.id)).toMatchObject({ label: '전체 화면 시작', enabled: true });
    applyFullScreenItem(lookup, 'darwin', { available: false, fullscreen: false }); // a sheet is attached, or no window
    expect(byId.get(FULL_SCREEN.id)?.enabled).toBe(false);
    expect(walk(buildAppMenu({ isDev: false, platform: 'darwin', commands: COMMANDS, enabled: ALL, onCommand: vi.fn(), fullScreenAvailable: false })).find((i) => i.id === FULL_SCREEN.id)?.enabled).toBe(false);
    const asked: string[] = [];
    applyFullScreenItem({ getMenuItemById: (id) => (asked.push(id), null) }, 'linux', { available: true, fullscreen: true });
    expect(asked).toEqual([]);
    for (const platform of ['linux', 'win32'] as const) {
      expect(walk(build(platform)).find((i) => i.label?.includes('전체 화면'))).toMatchObject({ label: '전체 화면', role: 'togglefullscreen' });
    }
  });
});

describe('in-place enabled toggle (the menu is built once; reports only flip enabled)', () => {
  const cmds: CommandSpec[] = [
    { id: 'file.importManaged', label: '하나', accelerator: 'CmdOrCtrl+O', menu: { menu: 'file', group: 1, order: 1 }, contexts: ['library'] },
    { id: 'file.importLinked', label: '크게', accelerator: 'CmdOrCtrl+Plus', menu: { menu: 'view', group: 1, order: 1 }, contexts: ['library'] },
    { id: 'item.open', label: '열기', contexts: ['item'], contextMenu: { kinds: ['item'], group: 1, order: 1 } },
  ];
  const registryIds = (menu: MenuItemConstructorOptions[]) => walk(menu).flatMap((i) => (i.id && !i.id.startsWith('menu.') ? [i.id] : []));

  it('names a command\'s menu items the way the builder does: its id, then one #n per hidden twin', () => {
    expect(menuItemIds(cmds[0]!)).toEqual(['file.importManaged']);
    expect(menuItemIds(cmds[1]!)).toEqual(['file.importLinked', 'file.importLinked#1']);
    for (const platform of ['darwin', 'linux', 'win32'] as const) {
      expect(registryIds(build(platform, false, vi.fn(), ALL, cmds)).sort(), platform).toEqual(cmds.filter((c) => c.menu).flatMap(menuItemIds).sort());
    }
  });
  it('flips enabled on every item and twin of a built menu', () => {
    const template = build('linux', false, vi.fn(), new Set<CommandId>(), cmds);
    const byId = new Map(walk(template).flatMap((i) => (i.id ? [[i.id, i] as const] : [])));
    const menu = { getMenuItemById: (id: string) => byId.get(id) ?? null };
    const states = () => Object.fromEntries(registryIds(template).map((id) => [id, byId.get(id)!.enabled]));
    expect(states()).toEqual({ 'file.importManaged': false, 'file.importLinked': false, 'file.importLinked#1': false });
    applyMenuEnabled(menu, new Set<CommandId>(['file.importLinked']), cmds);
    expect(states()).toEqual({ 'file.importManaged': false, 'file.importLinked': true, 'file.importLinked#1': true });
    applyMenuEnabled(menu, new Set<CommandId>(['file.importManaged']), cmds);
    expect(states()).toEqual({ 'file.importManaged': true, 'file.importLinked': false, 'file.importLinked#1': false });
  });
  it('toggles to the same state a fresh build would have, for every reportable context', () => {
    for (const enabled of [new Set<CommandId>(), new Set<CommandId>(['file.importManaged', 'file.importLinked']), new Set<CommandId>(['nav.back'])]) {
      const toggled = build('darwin', false, vi.fn(), new Set<CommandId>());
      const byId = new Map(walk(toggled).flatMap((i) => (i.id ? [[i.id, i] as const] : [])));
      applyMenuEnabled({ getMenuItemById: (id) => byId.get(id) ?? null }, enabled);
      expect(walk(toggled).map((i) => i.enabled)).toEqual(walk(build('darwin', false, vi.fn(), enabled)).map((i) => i.enabled));
    }
  });
  it('looks up only commands placed in the menu bar, and skips ids the menu does not have', () => {
    const asked: string[] = [];
    applyMenuEnabled({ getMenuItemById: (id) => (asked.push(id), null) }, ALL, cmds);
    expect(asked).toEqual(['file.importManaged', 'file.importLinked', 'file.importLinked#1']);
  });
});

describe('shortcut collisions per platform (registry items, hidden twins, Electron role defaults)', () => {
  /** Electron 44's default accelerators for the roles this builder uses (menu-item-roles.ts; the live Linux menu agrees). */
  const roleAccelerator = (role: string, platform: NodeJS.Platform): string | null => {
    const mac = platform === 'darwin';
    const win = platform === 'win32';
    const table: Record<string, string | null> = {
      close: 'CommandOrControl+W', undo: 'CommandOrControl+Z', redo: win ? 'Control+Y' : 'Shift+CommandOrControl+Z',
      cut: 'CommandOrControl+X', copy: 'CommandOrControl+C', paste: 'CommandOrControl+V', selectall: 'CommandOrControl+A',
      minimize: 'CommandOrControl+M', hide: 'Command+H', hideothers: 'Command+Alt+H', quit: win ? null : 'CommandOrControl+Q',
      togglefullscreen: mac ? 'Control+Command+F' : 'F11', toggledevtools: mac ? 'Alt+Command+I' : 'Ctrl+Shift+I',
    };
    return table[role.toLowerCase()] ?? null;
  };
  /** Every shortcut in the built menu as the platform shows it (mapped, modifiers sorted), hidden items included. */
  const shortcuts = (platform: NodeJS.Platform, commands: readonly CommandSpec[] = COMMANDS) =>
    walk(build(platform, true, vi.fn(), ALL, commands)).flatMap((i) => {
      const acc = i.accelerator ? String(i.accelerator) : i.role ? roleAccelerator(i.role, platform) : null;
      return acc ? [acceleratorLabel(acc, platform)] : [];
    });
  const clashes = (list: string[]) => [...new Set(list.filter((a, i) => list.indexOf(a) !== i))];
  const PLATFORMS = ['darwin', 'linux', 'win32'] as const;

  it('the shipped menu has none on any platform, and nothing becomes the Super key off macOS', () => {
    for (const platform of PLATFORMS) {
      const list = shortcuts(platform);
      expect(list.length, platform).toBeGreaterThanOrEqual(10);
      expect(clashes(list), platform).toEqual([]);
      if (platform !== 'darwin') expect(list.filter((a) => a.includes('Super')), platform).toEqual([]);
    }
  });
  it('catches a clash with a hidden twin and with a role default (the check can fail)', () => {
    const zoom: CommandSpec = { id: 'file.importManaged', label: '크게', accelerator: 'CmdOrCtrl+Plus', menu: { menu: 'view', group: 1, order: 1 }, contexts: ['app'] };
    const equals: CommandSpec = { id: 'file.importLinked', label: '같음', accelerator: 'CmdOrCtrl+=', menu: { menu: 'view', group: 1, order: 2 }, contexts: ['app'] };
    expect(clashes(shortcuts('darwin', [zoom, equals]))).toEqual(['⌘=']);
    const focus: CommandSpec = { id: 'nav.back', label: '집중', accelerator: 'Ctrl+Cmd+F', menu: { menu: 'view', group: 1, order: 1 }, contexts: ['app'] };
    expect(clashes(shortcuts('darwin', [focus]))).toEqual(['⌃⌘F']); // 전체 화면's ⌃⌘F on macOS
    expect(clashes(shortcuts('linux', [focus]))).toEqual([]); // Ctrl+Shift+F against F11
    const closeTab: CommandSpec = { ...focus, accelerator: 'CmdOrCtrl+W' };
    for (const platform of PLATFORMS) expect(clashes(shortcuts(platform, [closeTab])), platform).toHaveLength(1);
  });
});
