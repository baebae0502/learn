import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { COMMANDS, commandById, type CommandId, type CommandSpec } from '@learn/domain';
import { buildAppMenu } from './app-menu';

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

const FILE: Shape = {
  id: 'menu.file', label: '파일', submenu: [
    { id: 'file.importManaged', label: '파일 가져오기…', accelerator: 'CmdOrCtrl+O' },
    { id: 'file.importLinked', label: '외부 파일 연결…', accelerator: 'Alt+CmdOrCtrl+O' },
    SEP,
    { label: '창 닫기', role: 'close', accelerator: 'CmdOrCtrl+W' },
  ],
};
const EDIT: Shape = {
  id: 'menu.edit', label: '편집', submenu: [
    { label: '실행 취소', role: 'undo' },
    { label: '실행 복귀', role: 'redo' },
    SEP,
    { label: '오려두기', role: 'cut' },
    { label: '복사하기', role: 'copy' },
    { label: '붙여넣기', role: 'paste' },
    { label: '모두 선택', role: 'selectAll' },
  ],
};
const VIEW: Shape = { id: 'menu.view', label: '보기', submenu: [{ label: '전체 화면', role: 'togglefullscreen' }] };
const GO: Shape = {
  id: 'menu.go', label: '이동', submenu: [{ id: 'nav.back', label: '라이브러리로 돌아가기', accelerator: 'CmdOrCtrl+1' }],
};

describe('buildAppMenu', () => {
  it('macOS: Learn app menu + 파일/편집/보기/이동/윈도우, Korean labels', () => {
    expect(shape(build('darwin'))).toEqual([
      {
        id: 'menu.app', label: 'Learn', submenu: [
          { label: 'Learn 정보', role: 'about' },
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
      FILE,
      EDIT,
      VIEW,
      GO,
      {
        id: 'menu.window', label: '윈도우', role: 'windowMenu', submenu: [
          { label: '최소화', role: 'minimize' },
          { label: '확대/축소', role: 'zoom' },
          SEP,
          { label: '모두 앞으로 가져오기', role: 'front' },
        ],
      },
    ]);
  });

  it('Linux/Windows: same menus without the macOS app menu', () => {
    for (const platform of ['linux', 'win32'] as const) {
      expect(shape(build(platform))).toEqual([
        FILE,
        EDIT,
        VIEW,
        GO,
        { id: 'menu.window', label: '윈도우', role: 'windowMenu', submenu: [{ label: '최소화', role: 'minimize' }] },
      ]);
    }
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
    expect(shape(view.submenu as MenuItemConstructorOptions[])).toEqual([
      { label: '전체 화면', role: 'togglefullscreen' },
      SEP,
      { label: '개발자 도구', role: 'toggleDevTools' },
    ]);
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
  it('puts "app" commands in the macOS app menu, at the end of 파일 elsewhere', () => {
    const extra: CommandSpec = { id: 'nav.back', label: '설정…', accelerator: 'CmdOrCtrl+,', menu: { menu: 'app', group: 2, order: 1 }, contexts: ['app'] };
    expect(shape(build('darwin', false, vi.fn(), ALL, [extra]))[0]!.submenu!.map((s) => s.label ?? s.type)).toEqual([
      'Learn 정보', 'separator', '설정…', 'separator', '서비스', 'separator', 'Learn 가리기', '기타 가리기', '모두 보기', 'separator', 'Learn 종료',
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
    expect(item(linux, 'file.importLinked#1')).toMatchObject({ visible: false, accelerator: 'CmdOrCtrl+=', label: '크게' });
  });
  it('leaves out top-level menus with nothing in them', () => {
    // A fixed command list: later tasks add 도움말 commands without touching this test.
    expect(shape(build('darwin', false, vi.fn(), ALL, [commandById('nav.back')])).map((m) => m.label)).toEqual(['Learn', '파일', '편집', '보기', '이동', '윈도우']);
    expect(shape(build('darwin', false, vi.fn(), ALL, [])).map((m) => m.label)).toEqual(['Learn', '파일', '편집', '보기', '윈도우']);
  });
});
